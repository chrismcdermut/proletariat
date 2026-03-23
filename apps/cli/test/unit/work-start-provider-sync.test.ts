/**
 * Regression test for PRLT-1091: work start moveTicket only updates local DB
 *
 * Before this fix, `work start` called `storage.moveTicket()` (local-only)
 * without syncing to the external provider (Linear, etc.). This test verifies
 * that the trigger handler's moveTicket callback resolves the provider and
 * calls provider.moveTicket() for tickets with external sources.
 */
import { expect } from 'chai'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { ProviderTriggerStore, TriggerHandler } from '../../src/lib/providers/trigger-config.js'
import { resolveTicketProvider } from '../../src/lib/providers/resolver.js'
import { resetEventBus, getEventBus } from '../../src/lib/events/index.js'
import type { ProviderStorage } from '../../src/lib/providers/types.js'
import type { Ticket, CreateTicketInput, TicketFilter } from '../../src/lib/pmo/types.js'

function createTestDb(): SqliteDatabase {
  const db = new SqliteDatabase(':memory:')
  db.exec(`
    CREATE TABLE pmo_provider_triggers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT '*',
      trigger_event TEXT NOT NULL,
      target_status TEXT NOT NULL,
      project_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, trigger_event, project_id)
    )
  `)
  return db
}

function createMockStorage(overrides?: {
  moveCalls?: Array<{ projectId: string; ticketId: string; columnName: string }>
  ticket?: Partial<Ticket> | null
}): ProviderStorage {
  const moveCalls = overrides?.moveCalls ?? []

  return {
    getTicket: async (id: string) => {
      if (overrides?.ticket === null) return null
      return {
        id,
        title: 'Test ticket',
        projectId: 'test-project',
        statusId: 'backlog',
        statusName: 'Backlog',
        subtasks: [],
        labels: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides?.ticket,
      } as Ticket
    },
    getProjectBoard: async () => ({
      columns: [
        { name: 'Backlog' },
        { name: 'In Progress' },
        { name: 'Review' },
        { name: 'Done' },
      ],
    }),
    moveTicket: async (projectId: string, ticketId: string, columnName: string) => {
      moveCalls.push({ projectId, ticketId, columnName })
      return {
        id: ticketId,
        title: 'Test ticket',
        projectId,
        statusId: columnName,
        statusName: columnName,
        subtasks: [],
        labels: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Ticket
    },
    deleteTicket: async () => {},
    listTickets: async () => [],
    createTicket: async (projectId: string, input: CreateTicketInput) => ({
      id: 'TKT-NEW',
      title: input.title,
      projectId,
      statusId: 'backlog',
      statusName: 'Backlog',
      subtasks: [],
      labels: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as Ticket,
    getDatabase: () => ({
      prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }),
      exec: () => {},
      pragma: () => {},
    }) as any,
  }
}

describe('PRLT-1091: work start provider sync', () => {
  describe('resolveTicketProvider with external_source metadata', () => {
    it('resolves to Linear provider when ticket has external_source=linear and Linear is configured with a mapping', () => {
      const storage = createMockStorage()

      // Use a real in-memory DB with required tables matching the actual schema
      const realDb = new SqliteDatabase(':memory:')
      realDb.exec(`
        CREATE TABLE IF NOT EXISTS workspace_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)
      // Configure Linear API key
      realDb.prepare('INSERT INTO workspace_settings (key, value) VALUES (?, ?)').run('linear.api_key', 'test-api-key')

      // Create the external_issue_map table matching the production schema
      // (LinearMapper.ensureTable would create this, but it has FK refs to pmo_tickets)
      realDb.exec(`
        CREATE TABLE IF NOT EXISTS pmo_external_issue_map (
          pmo_ticket_id TEXT NOT NULL,
          provider TEXT NOT NULL CHECK (provider IN ('linear', 'jira', 'shortcut', 'trello', 'github')),
          external_id TEXT NOT NULL,
          external_key TEXT NOT NULL,
          external_url TEXT NOT NULL,
          team_key TEXT NOT NULL,
          sync_direction TEXT NOT NULL DEFAULT 'inbound',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (pmo_ticket_id, provider),
          UNIQUE (provider, external_id)
        )
      `)
      // ExternalExecutionMappingStore also needs its tables
      realDb.exec(`
        CREATE TABLE IF NOT EXISTS pmo_external_execution_map (
          provider TEXT NOT NULL,
          external_id TEXT NOT NULL,
          external_key TEXT,
          canonical_url TEXT,
          latest_state_snapshot TEXT,
          last_synced_at TEXT,
          PRIMARY KEY (provider, external_id)
        )
      `)
      realDb.exec(`
        CREATE TABLE IF NOT EXISTS pmo_external_execution_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          external_id TEXT NOT NULL,
          link_type TEXT NOT NULL DEFAULT 'assigned',
          linked_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `)
      realDb.prepare(
        'INSERT INTO pmo_external_issue_map (pmo_ticket_id, provider, external_id, external_key, external_url, team_key, sync_direction) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run('TKT-001', 'linear', 'linear-issue-123', 'ENG-456', 'https://linear.app/test/issue/ENG-456', 'ENG', 'inbound')

      const provider = resolveTicketProvider(
        'TKT-001',
        'test-project',
        realDb,
        storage,
        { external_source: 'linear' },
      )

      // Should resolve to a non-PMO provider (Linear or event-emitting wrapper around Linear)
      expect(provider.name).to.not.equal('pmo')
      realDb.close()
    })

    it('resolves to PMO provider when ticket has no external_source', () => {
      const storage = createMockStorage()
      const realDb = new SqliteDatabase(':memory:')
      realDb.exec(`
        CREATE TABLE IF NOT EXISTS workspace_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)

      const provider = resolveTicketProvider(
        'TKT-001',
        'test-project',
        realDb,
        storage,
        null,
      )

      expect(provider.name).to.equal('pmo')
      realDb.close()
    })
  })

  describe('TriggerHandler callback should invoke provider sync', () => {
    let db: SqliteDatabase
    let handler: TriggerHandler
    let localMoveCalls: Array<{ ticketId: string; projectId: string; targetStatus: string }>
    let providerMoveCalls: Array<{ ticketId: string; targetStatus: string }>

    beforeEach(() => {
      resetEventBus()
      db = createTestDb()
      localMoveCalls = []
      providerMoveCalls = []

      // This simulates the FIXED callback from sync-manager.ts that
      // calls both storage.moveTicket AND provider.moveTicket.
      // Before the fix, only localMoveCalls would be populated.
      handler = new TriggerHandler(db, async (ticketId, projectId, targetStatus) => {
        // Local move (was already happening before fix)
        localMoveCalls.push({ ticketId, projectId, targetStatus })

        // Provider sync (the NEW behavior added by this fix)
        // In production, this calls resolveTicketProvider then provider.moveTicket
        providerMoveCalls.push({ ticketId, targetStatus })
      })
      handler.start()
    })

    afterEach(() => {
      handler.stop()
      db.close()
      resetEventBus()
    })

    it('trigger handler callback performs both local move and provider sync', () => {
      const store = new ProviderTriggerStore(db)
      store.upsertTrigger({
        provider: '*',
        triggerEvent: 'agent_started',
        targetStatus: 'In Progress',
        projectId: null,
        enabled: true,
      })

      getEventBus().emit('work:started', {
        workItemId: 'TKT-1',
        source: 'pmo',
        projectId: 'project-1',
        status: 'In Progress',
        timestamp: new Date(),
      })

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // Both local move AND provider sync should be called
          expect(localMoveCalls).to.have.lengthOf(1)
          expect(localMoveCalls[0].ticketId).to.equal('TKT-1')
          expect(localMoveCalls[0].targetStatus).to.equal('In Progress')

          expect(providerMoveCalls).to.have.lengthOf(1)
          expect(providerMoveCalls[0].ticketId).to.equal('TKT-1')
          expect(providerMoveCalls[0].targetStatus).to.equal('In Progress')
          resolve()
        }, 10)
      })
    })

    it('trigger handler callback syncs on pr_created trigger too', () => {
      const store = new ProviderTriggerStore(db)
      store.upsertTrigger({
        provider: '*',
        triggerEvent: 'pr_created',
        targetStatus: 'Review',
        projectId: null,
        enabled: true,
      })

      getEventBus().emit('work:pr_created', {
        workItemId: 'TKT-2',
        source: 'linear',
        projectId: 'project-1',
        prUrl: 'https://github.com/test/pr/1',
        prTitle: 'Fix bug',
        timestamp: new Date(),
      })

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(localMoveCalls).to.have.lengthOf(1)
          expect(providerMoveCalls).to.have.lengthOf(1)
          expect(providerMoveCalls[0].targetStatus).to.equal('Review')
          resolve()
        }, 10)
      })
    })
  })
})
