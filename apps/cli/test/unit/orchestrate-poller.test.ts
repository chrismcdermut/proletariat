import { expect } from 'chai'
import { OrchestratePoller } from '../../src/lib/orchestrate/poller.js'
import { OrchestrateEngine } from '../../src/lib/orchestrate/engine.js'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { ensureHooksTable } from '../../src/lib/work-lifecycle/hooks/storage.js'
import type { OrchestrateEventContext } from '../../src/lib/orchestrate/types.js'

/**
 * Unit tests for OrchestratePoller.
 *
 * Tests cover:
 * - Ticket polling (on_ticket_ready)
 * - Agent lifecycle polling (on_agent_died, on_agent_completed, on_agent_idle)
 * - Deduplication (same ticket not fired twice)
 * - Graceful error handling
 */

function createTestDb(): SqliteDatabase {
  const db = new SqliteDatabase(':memory:')
  ensureHooksTable(db)

  // Add orchestrate columns
  try {
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto'")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN project_id TEXT")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN source TEXT NOT NULL DEFAULT 'cli'")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN config TEXT")
  } catch {
    // May already exist
  }

  // Create minimal ticket and status tables for polling
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_workflow_statuses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status_id TEXT NOT NULL,
      assignee TEXT,
      FOREIGN KEY (status_id) REFERENCES pmo_workflow_statuses(id)
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_work (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'starting',
      lifecycle_state TEXT,
      container_id TEXT,
      last_heartbeat TEXT
    )
  `)

  // Insert a "todo" status
  db.prepare("INSERT INTO pmo_workflow_statuses (id, name, category) VALUES ('status-ready', 'Ready', 'todo')").run()
  db.prepare("INSERT INTO pmo_workflow_statuses (id, name, category) VALUES ('status-ip', 'In Progress', 'started')").run()

  return db
}

describe('OrchestratePoller', () => {
  let db: SqliteDatabase
  let engine: OrchestrateEngine
  let firedEvents: Array<{ event: string; ctx: OrchestrateEventContext }>

  beforeEach(() => {
    db = createTestDb()
    firedEvents = []

    // Create engine that records fired events
    engine = new OrchestrateEngine({
      db,
      log: () => {},
    })

    // Monkey-patch fireEvent to record calls without executing hooks
    const origFireEvent = engine.fireEvent.bind(engine)
    engine.fireEvent = async (event: string, ctx: OrchestrateEventContext) => {
      firedEvents.push({ event, ctx })
      return []
    }
  })

  afterEach(() => {
    db.close()
  })

  // ===========================================================================
  // Ticket Polling
  // ===========================================================================

  describe('ticket polling', () => {
    it('should fire on_ticket_ready for unassigned todo tickets', async () => {
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-1', 'Test ticket', 'status-ready', NULL)").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll()

      const readyEvents = firedEvents.filter(e => e.event === 'on_ticket_ready')
      expect(readyEvents).to.have.length(1)
      expect(readyEvents[0].ctx.ticket).to.equal('TKT-1')
    })

    it('should not fire for assigned tickets', async () => {
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-2', 'Assigned', 'status-ready', 'agent-1')").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll()

      const readyEvents = firedEvents.filter(e => e.event === 'on_ticket_ready')
      expect(readyEvents).to.be.empty
    })

    it('should not fire for tickets with active agents', async () => {
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-3', 'Active', 'status-ready', NULL)").run()
      db.prepare("INSERT INTO agent_work (id, ticket_id, agent_name, status) VALUES ('aw-1', 'TKT-3', 'agent-1', 'running')").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll()

      const readyEvents = firedEvents.filter(e => e.event === 'on_ticket_ready')
      expect(readyEvents).to.be.empty
    })

    it('should not fire the same ticket twice (deduplication)', async () => {
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-4', 'Dedup', 'status-ready', NULL)").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll()
      await poller.poll()

      const readyEvents = firedEvents.filter(e => e.event === 'on_ticket_ready')
      expect(readyEvents).to.have.length(1)
    })

    it('should not fire for non-todo tickets', async () => {
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-5', 'In Progress', 'status-ip', NULL)").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll()

      const readyEvents = firedEvents.filter(e => e.event === 'on_ticket_ready')
      expect(readyEvents).to.be.empty
    })
  })

  // ===========================================================================
  // Agent Lifecycle Polling
  // ===========================================================================

  describe('agent lifecycle polling', () => {
    it('should fire on_agent_died when lifecycle_state transitions to died', async () => {
      db.prepare("INSERT INTO agent_work (id, ticket_id, agent_name, status, lifecycle_state) VALUES ('aw-1', 'TKT-1', 'agent-1', 'running', 'healthy')").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      // First poll: observe initial state
      await poller.poll()
      expect(firedEvents.filter(e => e.event === 'on_agent_died')).to.be.empty

      // Update to died state
      db.prepare("UPDATE agent_work SET lifecycle_state = 'died', status = 'error' WHERE id = 'aw-1'").run()
      await poller.poll()

      const diedEvents = firedEvents.filter(e => e.event === 'on_agent_died')
      expect(diedEvents).to.have.length(1)
      expect(diedEvents[0].ctx.agent).to.equal('agent-1')
    })

    it('should fire on_agent_completed when lifecycle_state transitions to completed', async () => {
      db.prepare("INSERT INTO agent_work (id, ticket_id, agent_name, status, lifecycle_state) VALUES ('aw-2', 'TKT-2', 'agent-2', 'running', 'healthy')").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll() // observe initial

      db.prepare("UPDATE agent_work SET lifecycle_state = 'completed' WHERE id = 'aw-2'").run()
      await poller.poll()

      const completedEvents = firedEvents.filter(e => e.event === 'on_agent_completed')
      expect(completedEvents).to.have.length(1)
      expect(completedEvents[0].ctx.ticket).to.equal('TKT-2')
    })

    it('should not fire on first observation (no transition)', async () => {
      db.prepare("INSERT INTO agent_work (id, ticket_id, agent_name, status, lifecycle_state) VALUES ('aw-3', 'TKT-3', 'agent-3', 'error', 'died')").run()

      const poller = new OrchestratePoller({ engine, db, log: () => {} })
      await poller.poll()

      // Should not fire because this is the first observation, not a transition
      expect(firedEvents.filter(e => e.event === 'on_agent_died')).to.be.empty
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('should not throw on polling errors', async () => {
      // Close the db to force errors, then create a new poller
      const badDb = new SqliteDatabase(':memory:')
      // Don't create tables — queries will fail
      const badEngine = new OrchestrateEngine({ db: badDb, log: () => {} })
      const poller = new OrchestratePoller({ engine: badEngine, db: badDb, log: () => {} })

      // Should not throw
      await poller.poll()
      badDb.close()
    })
  })
})
