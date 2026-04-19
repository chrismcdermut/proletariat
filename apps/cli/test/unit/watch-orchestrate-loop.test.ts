/**
 * Unit tests for the watch -> orchestrate -> ship integration loop (PRLT-1333).
 *
 * These tests validate the individual components and their contracts:
 * - SimplePoller state reporting produces correct state summaries
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
    session_id?: string | null
    environment?: string | null
  }>
}) {
  const data = {
    readyTickets: options?.readyTickets ?? [],
    agents: (options?.agents ?? []).map(a => ({
      ...a,
      session_id: a.session_id ?? null,
      environment: a.environment ?? 'host',
    })),
  }

  return {
    _data: data,
    prepare: (sql: string) => ({
      all: (..._args: unknown[]) => {
        if (sql.includes('ticket_refs') && sql.includes('status')) {
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

  db.exec(`CREATE TABLE IF NOT EXISTS ticket_refs (id TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'pmo', external_id TEXT, external_key TEXT, external_url TEXT, title TEXT NOT NULL, description TEXT, status TEXT, priority TEXT, category TEXT, assignee TEXT, project_id TEXT, cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`)
  db.exec(`CREATE TABLE IF NOT EXISTS agent_work (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, agent_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'starting', lifecycle_state TEXT, container_id TEXT, last_heartbeat TEXT)`)
  db.exec(`CREATE TABLE IF NOT EXISTS pmo_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, is_archived INTEGER NOT NULL DEFAULT 0)`)

  return db
}

// =============================================================================
// Tests
// =============================================================================

describe('Watch -> Orchestrate Loop -- Unit Tests (PRLT-1333)', () => {
  // ===========================================================================
  // SimplePoller State Reporting
  // ===========================================================================

  describe('SimplePoller state reporting for loop integration', () => {
    it('should report agent state across its lifecycle: starting -> running -> completed', async () => {
      const db = createMockDb({
        agents: [{
          id: 'exec-1', ticket_id: 'PRLT-100', agent_name: 'loop-agent',
          status: 'starting', lifecycle_state: null, container_id: null,
        }],
      })
      const poller = createTestPoller(db)

      // Starting state (no tmux -> UNKNOWN health state)
      const r1 = await poller.poll()
      const a1 = r1.items.find(i => i.category === 'agents')!
      expect(a1.summary).to.include('loop-agent')
      expect(a1.healthState).to.equal('UNKNOWN')

      // Running state (still no tmux -> UNKNOWN)
      db._data.agents = [{
        id: 'exec-1', ticket_id: 'PRLT-100', agent_name: 'loop-agent',
        status: 'running', lifecycle_state: null, container_id: null,
        session_id: null, environment: 'host',
      }]
      const r2 = await poller.poll()
      const a2 = r2.items.find(i => i.category === 'agents')!
      expect(a2.healthState).to.equal('UNKNOWN')

      // Completed state -> DONE
      db._data.agents = [{
        id: 'exec-1', ticket_id: 'PRLT-100', agent_name: 'loop-agent',
        status: 'completed', lifecycle_state: 'completed', container_id: null,
        session_id: null, environment: 'host',
      }]
      const r3 = await poller.poll()
      const a3 = r3.items.find(i => i.category === 'agents')!
      expect(a3.healthState).to.equal('DONE')
      expect(a3.summary).to.include('DONE')
    })

    it('should report full state on every poll — no empty baseline', async () => {
      const db = createMockDb({
        agents: [
          { id: 'a', ticket_id: 'T-1', agent_name: 'ag1', status: 'running', lifecycle_state: null, container_id: null },
          { id: 'b', ticket_id: 'T-2', agent_name: 'ag2', status: 'completed', lifecycle_state: 'completed', container_id: null },
        ],
        readyTickets: [{ id: 'T-3', title: 'Ready one' }],
      })
      const poller = createTestPoller(db)

      const result = await poller.poll()
      expect(result.items.length).to.be.greaterThan(0)
      expect(result.message).to.not.be.null
    })

    it('should format poke message with section headers', async () => {
      const db = createMockDb({
        agents: [{ id: 'a', ticket_id: 'T-1', agent_name: 'ag1', status: 'completed', lifecycle_state: 'completed', container_id: null }],
        readyTickets: [{ id: 'T-5', title: 'New ticket' }],
      })
      const poller = createTestPoller(db)

      const result = await poller.poll()
      expect(result.message).to.include('Ready tickets')
      expect(result.message).to.include('Active agents')
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
    it('agent state items should include agent name and ticket ID', async () => {
      const db = createMockDb({
        agents: [{
          id: 'e1', ticket_id: 'PRLT-42', agent_name: 'swift-knuth',
          status: 'completed', lifecycle_state: 'completed', container_id: null,
        }],
      })
      const poller = createTestPoller(db)

      const result = await poller.poll()

      // Items contain per-agent details; message summarizes by health state (PRLT-1348)
      const agentItems = result.items.filter(i => i.category === 'agents')
      expect(agentItems).to.have.length(1)
      expect(agentItems[0].summary).to.include('swift-knuth')
      expect(agentItems[0].summary).to.include('PRLT-42')
      expect(agentItems[0].healthState).to.equal('DONE')
      // Message shows summary counts
      expect(result.message).to.include('Active agents (1):')
      expect(result.message).to.include('1 done')
    })

    it('board state message should include ticket ID and title', async () => {
      const db = createMockDb({
        readyTickets: [{ id: 'PRLT-99', title: 'Add dark mode support' }],
      })
      const poller = createTestPoller(db)

      const result = await poller.poll()

      expect(result.message).to.include('PRLT-99')
      expect(result.message).to.include('Add dark mode support')
      expect(result.message).to.include('ready')
    })

    it('combined state should be formatted with section headers and summary', async () => {
      const db = createMockDb({
        readyTickets: [{ id: 'T-NEW', title: 'Fresh ticket' }],
        agents: [
          { id: 'a1', ticket_id: 'T-1', agent_name: 'agent-alpha', status: 'completed', lifecycle_state: 'completed', container_id: null },
        ],
      })
      const poller = createTestPoller(db)

      const result = await poller.poll()

      // Should have section headers
      expect(result.message).to.include('Ready tickets')
      expect(result.message).to.include('Active agents')

      // Board items are still bulleted; agents are summarized (PRLT-1348)
      const bullets = result.message!.split('\n').filter(l => l.startsWith('- '))
      expect(bullets.length).to.be.at.least(1) // 1 board ticket bullet
      // Agents section shows summary, not individual bullets for done/idle
      expect(result.message).to.include('1 done')
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

      // Second event succeeds -- engine didn't crash
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
      expect(result.items).to.have.length(0)
      // Always returns a formatted message, even when empty (PRLT-1347)
      expect(result.message).to.be.a('string')
      expect(result.message).to.include('none')
    })
  })

  // ===========================================================================
  // PRLT-1347: No baseline/diff — poke sent on first cycle
  // ===========================================================================

  describe('PRLT-1347: no baseline/diff, poke on first cycle', () => {
    it('should produce a pokeable message on the very first poll — no baseline needed', async () => {
      // Simulates 1 open PR reported by the poller. In production the PR comes
      // from GitHub; here we use an agent entry as a proxy for "state exists."
      const db = createMockDb({
        agents: [{
          id: 'exec-pr', ticket_id: 'PRLT-500', agent_name: 'pr-agent',
          status: 'running', lifecycle_state: null, container_id: null,
        }],
      })
      const poller = createTestPoller(db)

      // First poll — previously this was swallowed as a "baseline" and the
      // second poll (with identical state) produced an empty diff = no poke.
      const result = await poller.poll()

      // message must be non-null so the watch command pokes immediately
      expect(result.message).to.be.a('string')
      expect(result.message!.length).to.be.greaterThan(0)
      expect(result.items).to.have.length(1)
      expect(result.items[0].summary).to.include('PRLT-500')
    })

    it('should always produce a non-null message, even with zero items', async () => {
      const db = createMockDb()
      const poller = createTestPoller(db)

      const result = await poller.poll()

      // The watch command now pokes unconditionally — message must never be null
      expect(result.message).to.be.a('string')
      expect(result.message).to.include('GitHub PRs: none')
      expect(result.message).to.include('Ready tickets: none')
      expect(result.message).to.include('Active agents: none')
    })

    it('should produce identical messages on consecutive polls — stateless, no diff', async () => {
      const db = createMockDb({
        readyTickets: [{ id: 'TKT-700', title: 'Stable ticket' }],
        agents: [{
          id: 'exec-1', ticket_id: 'TKT-700', agent_name: 'stable-agent',
          status: 'running', lifecycle_state: null, container_id: null,
        }],
      })
      const poller = createTestPoller(db)

      const r1 = await poller.poll()
      const r2 = await poller.poll()
      const r3 = await poller.poll()

      // All three polls should produce the exact same message — the poller
      // is a stateless pipe, no baseline or diff subtracted
      expect(r1.message).to.equal(r2.message)
      expect(r2.message).to.equal(r3.message)
      expect(r1.items).to.deep.equal(r2.items)
    })

    it('message should be compact — under 31 lines for mobile scrollback', async () => {
      // Simulate a moderately busy workspace: 3 agents + 3 ready tickets
      const db = createMockDb({
        readyTickets: [
          { id: 'TKT-A', title: 'Feature A' },
          { id: 'TKT-B', title: 'Feature B' },
          { id: 'TKT-C', title: 'Feature C' },
        ],
        agents: [
          { id: 'e1', ticket_id: 'TKT-A', agent_name: 'ag-1', status: 'running', lifecycle_state: null, container_id: null },
          { id: 'e2', ticket_id: 'TKT-B', agent_name: 'ag-2', status: 'completed', lifecycle_state: 'completed', container_id: null },
          { id: 'e3', ticket_id: 'TKT-C', agent_name: 'ag-3', status: 'starting', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createTestPoller(db)

      const result = await poller.poll()
      const lineCount = result.message!.split('\n').length

      expect(lineCount).to.be.at.most(31, `Message has ${lineCount} lines, exceeds 31-line mobile scrollback limit`)
    })
  })
})
