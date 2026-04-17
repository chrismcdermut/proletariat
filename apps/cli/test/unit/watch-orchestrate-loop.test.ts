/**
 * Unit tests for the watch → orchestrate → ship integration loop (PRLT-1333).
 *
 * These tests validate the individual components and their contracts:
 * - SimplePoller state diffing produces correct change summaries
 * - OrchestrateEngine fires hooks with correct tier routing
 * - Poke message format matches what the orchestrator can parse
 * - The merge-pr action constructs the correct CLI command
 * - Error paths don't crash the loop
 */

import { expect } from 'chai'
import Database from 'better-sqlite3'
import { SimplePoller } from '../../src/lib/orchestrate/simple-poller.js'
import { OrchestrateEngine } from '../../src/lib/orchestrate/engine.js'
import { ensureHooksTable } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { resetEventBus } from '../../src/lib/events/event-bus.js'
import {
  setChainExecutorForTesting,
  executeBuiltinAction,
} from '../../src/lib/orchestrate/actions.js'
import type { ChainExecutor } from '../../src/lib/orchestrate/prompt-chain.js'

// =============================================================================
// Helpers
// =============================================================================

function createMockDb(options?: {
  readyTickets?: Array<{ id: string; title: string }>
  agents?: Array<{
    id: string
    ticket_id: string
    agent_name: string
    status: string
    lifecycle_state: string | null
    container_id: string | null
  }>
}) {
  const data = {
    readyTickets: options?.readyTickets ?? [],
    agents: options?.agents ?? [],
  }

  return {
    _data: data,
    prepare: (sql: string) => ({
      all: (..._args: unknown[]) => {
        if (sql.includes('pmo_tickets') && (sql.includes('ws.name') || sql.includes('unstarted'))) {
          return data.readyTickets
        }
        if (sql.includes('agent_work')) {
          return data.agents
        }
        return []
      },
      get: () => undefined,
    }),
    close: () => {},
  }
}

function createTestPoller(db: ReturnType<typeof createMockDb>) {
  return new SimplePoller({
    db: db as any,
    log: () => {},
    cwd: '/nonexistent-test-dir',
  })
}

function createEngineDb(): Database.Database {
  const db = new Database(':memory:')
  ensureHooksTable(db)

  try {
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'confirm', 'notify', 'llm', 'human', 'off'))")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN project_id TEXT")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN source TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('yaml', 'cli', 'preset'))")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN config TEXT")
    db.exec("CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_priority ON pmo_work_hooks(event, priority)")
  } catch {
    // Columns may already exist
  }

  db.exec(`CREATE TABLE IF NOT EXISTS pmo_workflow_statuses (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL)`)
  db.exec(`CREATE TABLE IF NOT EXISTS pmo_tickets (id TEXT PRIMARY KEY, title TEXT NOT NULL, status_id TEXT NOT NULL, assignee TEXT)`)
  db.exec(`CREATE TABLE IF NOT EXISTS agent_work (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, agent_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'starting', lifecycle_state TEXT, container_id TEXT, last_heartbeat TEXT)`)
  db.exec(`CREATE TABLE IF NOT EXISTS pmo_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, is_archived INTEGER NOT NULL DEFAULT 0)`)

  return db
}

// =============================================================================
// Tests
// =============================================================================

describe('Watch → Orchestrate Loop — Unit Tests (PRLT-1333)', () => {
  // ===========================================================================
  // SimplePoller Change Detection
  // ===========================================================================

  describe('SimplePoller change detection for loop integration', () => {
    it('should produce correct change summary for agent lifecycle: starting → running → completed', async () => {
      const db = createMockDb({
        agents: [{
          id: 'exec-1', ticket_id: 'PRLT-100', agent_name: 'loop-agent',
          status: 'starting', lifecycle_state: null, container_id: null,
        }],
      })
      const poller = createTestPoller(db)

      // Baseline
      await poller.poll()

      // starting → running
      db._data.agents = [{
        id: 'exec-1', ticket_id: 'PRLT-100', agent_name: 'loop-agent',
        status: 'running', lifecycle_state: null, container_id: null,
      }]
      const r1 = await poller.poll()
      expect(r1.changes).to.have.length(1)
      expect(r1.changes[0].summary).to.include('now running')

      // running → completed
      db._data.agents = [{
        id: 'exec-1', ticket_id: 'PRLT-100', agent_name: 'loop-agent',
        status: 'completed', lifecycle_state: 'completed', container_id: null,
      }]
      const r2 = await poller.poll()
      expect(r2.changes).to.have.length(1)
      expect(r2.changes[0].summary).to.include('completed')
    })

    it('should not report changes during the baseline poll', async () => {
      const db = createMockDb({
        agents: [
          { id: 'a', ticket_id: 'T-1', agent_name: 'ag1', status: 'running', lifecycle_state: null, container_id: null },
          { id: 'b', ticket_id: 'T-2', agent_name: 'ag2', status: 'completed', lifecycle_state: 'completed', container_id: null },
        ],
        readyTickets: [{ id: 'T-3', title: 'Ready one' }],
      })
      const poller = createTestPoller(db)

      const baseline = await poller.poll()
      expect(baseline.changes).to.have.length(0)
      expect(baseline.message).to.be.null
    })

    it('should format poke message with section headers', async () => {
      const db = createMockDb({
        agents: [{ id: 'a', ticket_id: 'T-1', agent_name: 'ag1', status: 'running', lifecycle_state: null, container_id: null }],
        readyTickets: [],
      })
      const poller = createTestPoller(db)

      await poller.poll()

      // Agent completes + new ticket appears
      db._data.agents = [{ id: 'a', ticket_id: 'T-1', agent_name: 'ag1', status: 'completed', lifecycle_state: 'completed', container_id: null }]
      db._data.readyTickets = [{ id: 'T-5', title: 'New ticket' }]

      const result = await poller.poll()
      expect(result.message).to.include('Board:')
      expect(result.message).to.include('Agents:')
      expect(result.message).to.include('- ')
    })
  })

  // ===========================================================================
  // OrchestrateEngine Hook Tier Routing
  // ===========================================================================

  describe('OrchestrateEngine hook tier routing', () => {
    let engineDb: Database.Database

    beforeEach(() => {
      resetEventBus()
      engineDb = createEngineDb()
    })

    afterEach(() => {
      resetEventBus()
      setChainExecutorForTesting(null)
      engineDb.close()
    })

    it('auto-mode hook should execute immediately (Tier 1)', async () => {
      engineDb.prepare(`
        INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source)
        VALUES ('h1', 'auto:on_ci_green:merge-pr', 'on_ci_green', 'shell', 'merge-pr', 1, 'auto', 0, 'preset')
      `).run()

      setChainExecutorForTesting(() => ({
        stdout: JSON.stringify({ type: 'success', prompt: null, success: true, result: {}, metadata: { command: 'test', flags: {} } }),
        stderr: '',
        status: 0,
      }))

      const engine = new OrchestrateEngine({ db: engineDb, log: () => {} })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green', ticket: 'T-1', pr: 1 })

      expect(results[0].success).to.be.true
      expect(results[0].awaitingLlmDecision).to.be.undefined
      expect(results[0].awaitingConfirmation).to.be.undefined

      engine.stop()
    })

    it('llm-mode hook should queue for decision (Tier 2)', async () => {
      engineDb.prepare(`
        INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source)
        VALUES ('h1', 'llm:on_ci_green:merge-pr', 'on_ci_green', 'shell', 'merge-pr', 1, 'llm', 0, 'preset')
      `).run()

      const engine = new OrchestrateEngine({ db: engineDb, log: () => {} })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green', ticket: 'T-1', pr: 1 })

      expect(results[0].awaitingLlmDecision).to.be.true
      expect(engine.getPendingLlmDecisions()).to.have.length(1)

      engine.stop()
    })

    it('disabled hooks should not fire', async () => {
      engineDb.prepare(`
        INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source)
        VALUES ('h1', 'auto:on_ci_green:merge-pr', 'on_ci_green', 'shell', 'merge-pr', 0, 'auto', 0, 'preset')
      `).run()

      const engine = new OrchestrateEngine({ db: engineDb, log: () => {} })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green', ticket: 'T-1', pr: 1 })

      expect(results).to.have.length(0)

      engine.stop()
    })
  })

  // ===========================================================================
  // merge-pr Action CLI Command Construction
  // ===========================================================================

  describe('merge-pr action command construction', () => {
    beforeEach(() => {
      setChainExecutorForTesting(null)
    })

    afterEach(() => {
      setChainExecutorForTesting(null)
    })

    it('should include both ticket and PR when both are provided', () => {
      const commands: string[] = []
      setChainExecutorForTesting((cmd) => {
        commands.push(cmd)
        return {
          stdout: JSON.stringify({ type: 'success', prompt: null, success: true, result: {}, metadata: { command: 'test', flags: {} } }),
          stderr: '',
          status: 0,
        }
      })

      executeBuiltinAction('merge-pr', { event: 'on_ci_green', ticket: 'PRLT-42', pr: 100 })

      expect(commands[0]).to.include('prlt work ship PRLT-42 --pr 100')
    })

    it('should include only PR when ticket is absent', () => {
      const commands: string[] = []
      setChainExecutorForTesting((cmd) => {
        commands.push(cmd)
        return {
          stdout: JSON.stringify({ type: 'success', prompt: null, success: true, result: {}, metadata: { command: 'test', flags: {} } }),
          stderr: '',
          status: 0,
        }
      })

      executeBuiltinAction('merge-pr', { event: 'on_ci_green', pr: 200 })

      expect(commands[0]).to.include('prlt work ship --pr 200')
      expect(commands[0]).to.not.include('undefined')
    })

    it('should fail when neither ticket nor PR is provided', () => {
      const result = executeBuiltinAction('merge-pr', { event: 'on_ci_green' })
      expect(result.success).to.be.false
      expect(result.error).to.include('No ticket or PR')
    })
  })

  // ===========================================================================
  // Poke Message Format Contract
  // ===========================================================================

  describe('poke message format contract', () => {
    it('agent completion message should include agent name and ticket ID', async () => {
      const db = createMockDb({
        agents: [{
          id: 'e1', ticket_id: 'PRLT-42', agent_name: 'swift-knuth',
          status: 'running', lifecycle_state: null, container_id: null,
        }],
      })
      const poller = createTestPoller(db)

      await poller.poll()

      db._data.agents = [{
        id: 'e1', ticket_id: 'PRLT-42', agent_name: 'swift-knuth',
        status: 'completed', lifecycle_state: 'completed', container_id: null,
      }]

      const result = await poller.poll()

      // The message should contain identifiable information the orchestrator
      // can use to construct an event context
      expect(result.message).to.include('swift-knuth')
      expect(result.message).to.include('PRLT-42')
      expect(result.message).to.include('completed')
    })

    it('board change message should include ticket ID and title', async () => {
      const db = createMockDb({ readyTickets: [] })
      const poller = createTestPoller(db)

      await poller.poll()

      db._data.readyTickets = [{ id: 'PRLT-99', title: 'Add dark mode support' }]

      const result = await poller.poll()

      expect(result.message).to.include('PRLT-99')
      expect(result.message).to.include('Add dark mode support')
      expect(result.message).to.include('Ready')
    })

    it('multiple changes should be formatted with section headers and bullets', async () => {
      const db = createMockDb({
        readyTickets: [{ id: 'T-OLD', title: 'Will leave' }],
        agents: [
          { id: 'a1', ticket_id: 'T-1', agent_name: 'agent-alpha', status: 'running', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createTestPoller(db)

      await poller.poll()

      // Agent completes, old ticket leaves ready, new ticket arrives
      db._data.agents = [
        { id: 'a1', ticket_id: 'T-1', agent_name: 'agent-alpha', status: 'completed', lifecycle_state: 'completed', container_id: null },
      ]
      db._data.readyTickets = [{ id: 'T-NEW', title: 'Fresh ticket' }]

      const result = await poller.poll()

      // Should have section headers
      expect(result.message).to.include('Board:')
      expect(result.message).to.include('Agents:')

      // Each change should be a bullet
      const bullets = result.message!.split('\n').filter(l => l.startsWith('- '))
      expect(bullets.length).to.be.at.least(3) // 2 board changes + 1 agent change
    })
  })

  // ===========================================================================
  // Error Recovery
  // ===========================================================================

  describe('error recovery', () => {
    let engineDb: Database.Database

    beforeEach(() => {
      resetEventBus()
      engineDb = createEngineDb()
    })

    afterEach(() => {
      resetEventBus()
      setChainExecutorForTesting(null)
      engineDb.close()
    })

    it('should recover from a failed merge and continue processing events', async () => {
      engineDb.prepare(`
        INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source)
        VALUES ('h1', 'auto:on_ci_green:merge-pr', 'on_ci_green', 'shell', 'merge-pr', 1, 'auto', 0, 'preset')
      `).run()

      let callCount = 0
      setChainExecutorForTesting(() => {
        callCount++
        if (callCount === 1) {
          // First call fails
          return {
            stdout: JSON.stringify({
              type: 'error',
              error: { code: 'CONFLICT', message: 'merge conflict' },
              metadata: { command: 'test', flags: {} },
            }),
            stderr: '',
            status: 1,
          }
        }
        // Second call succeeds
        return {
          stdout: JSON.stringify({
            type: 'success',
            prompt: null,
            success: true,
            result: {},
            metadata: { command: 'test', flags: {} },
          }),
          stderr: '',
          status: 0,
        }
      })

      const engine = new OrchestrateEngine({ db: engineDb, log: () => {} })

      // First event fails
      const r1 = await engine.fireEvent('on_ci_green', { event: 'on_ci_green', ticket: 'T-1', pr: 1 })
      expect(r1[0].success).to.be.false

      // Second event succeeds — engine didn't crash
      const r2 = await engine.fireEvent('on_ci_green', { event: 'on_ci_green', ticket: 'T-2', pr: 2 })
      expect(r2[0].success).to.be.true

      engine.stop()
    })

    it('should handle poller DB errors without crashing the poll cycle', async () => {
      const badDb = {
        _data: { readyTickets: [], agents: [] },
        prepare: () => { throw new Error('DB corrupted') },
        close: () => {},
      }
      const poller = createTestPoller(badDb as any)

      // Should not throw
      const result = await poller.poll()
      expect(result.changes).to.have.length(0)
      expect(result.message).to.be.null
    })
  })
})
