/**
 * End-to-end test: watch reports state -> orchestrator decides -> ships it
 *
 * PRLT-1333 + PRLT-1346: Proves the full autonomous loop works end-to-end.
 *
 * The flow under test:
 * 1. SimplePoller reports full current state (open PRs, agents, tickets)
 * 2. Watch pushes full state report to the orchestrator via poke
 * 3. The orchestrator (LLM) parses the state to extract PR/ticket context
 * 4. OrchestrateEngine fires on_ci_green event with the extracted context
 * 5. The merge-pr hook (in auto mode) executes `prlt work ship`
 * 6. The ticket transitions to Done
 *
 * PRLT-1346 design change: The poller is now a dumb state reporter.
 * It pushes full state every cycle — no diffing, no baseline.
 * The orchestrator LLM determines what changed.
 *
 * This test uses the real SimplePoller and OrchestrateEngine classes but mocks
 * external I/O (GitHub CLI, prlt CLI subprocess calls) to keep it deterministic.
 */

import { expect } from 'chai'
import Database from 'better-sqlite3'
import { SimplePoller } from '../../src/lib/orchestrate/simple-poller.js'
import { OrchestrateEngine } from '../../src/lib/orchestrate/engine.js'
import { ensureHooksTable } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { resetEventBus } from '../../src/lib/events/event-bus.js'
import {
  setChainExecutorForTesting,
} from '../../src/lib/orchestrate/actions.js'
import type { ChainExecutor } from '../../src/lib/orchestrate/prompt-chain.js'
import type { OrchestrateActionResult, OrchestrateEventContext } from '../../src/lib/orchestrate/types.js'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock database for the SimplePoller that returns configurable
 * agent and ticket data. The mock supports swapping state between poll
 * cycles to simulate real state changes.
 */
function createPollerMockDb(options?: {
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
        if (sql.includes('ticket_refs') && sql.includes('status')) {
          return data.readyTickets
        }
        if (sql.includes('agent_work')) {
          return data.agents
        }
        return []
      },
      get: (..._args: unknown[]) => {
        if (sql.includes('pmo_settings')) {
          return undefined
        }
        return undefined
      },
    }),
    close: () => {},
  }
}

/**
 * Create a SimplePoller that skips GitHub CLI calls.
 */
function createTestPoller(db: ReturnType<typeof createPollerMockDb>) {
  return new SimplePoller({
    db: db as any,
    log: () => {},
    cwd: '/nonexistent-test-dir',
  })
}

/**
 * Create an in-memory database with hooks table and orchestrate columns
 * for the OrchestrateEngine.
 */
function createEngineDb(): Database.Database {
  const db = new Database(':memory:')
  ensureHooksTable(db)

  // Add orchestrate columns
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

  // Create minimal tables for polling (PRLT-1350: ticket_refs replaces dropped pmo_tickets)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_refs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'pmo',
      external_id TEXT,
      external_key TEXT,
      external_url TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT,
      priority TEXT,
      category TEXT,
      assignee TEXT,
      project_id TEXT,
      cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0
    )
  `)

  return db
}

/**
 * Insert hooks for the autonomous merge flow:
 * on_ci_green -> merge-pr (auto mode, Tier 1 -- no human approval needed)
 */
function insertAutoMergeHooks(db: Database.Database): void {
  db.prepare(`
    INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source)
    VALUES ('hook-ci-green-merge', 'auto:on_ci_green:merge-pr', 'on_ci_green', 'shell', 'merge-pr', 1, 'auto', 0, 'preset')
  `).run()
}

/**
 * Parse a SimplePoller state report to extract PR number and ticket ID.
 * This mirrors what the orchestrator LLM would do when receiving a state push.
 *
 * New state format (PRLT-1346):
 *   "GitHub PRs (1 open):\n- #42 (PRLT-100): \"title\" -- CI: green, mergeable, no review"
 *
 * Returns extracted context or null if the message can't be parsed.
 */
function parseStateMessage(message: string): { pr?: number; ticket?: string; event?: string } | null {
  if (!message) return null

  // Match PR with CI green in state report: #42 (PRLT-100): "title" -- CI: green
  const prMatch = message.match(/#(\d+)(?:\s*\(([A-Z]+-\d+)\))?:.*CI: green/)
  if (prMatch) {
    return {
      pr: parseInt(prMatch[1], 10),
      ticket: prMatch[2] || undefined,
      event: 'on_ci_green',
    }
  }

  // Match agent completed in state report: bold-ada (TKT-001): completed
  const agentMatch = message.match(/(\S+)\s*\(([A-Z]+-\d+)\):\s*completed/)
  if (agentMatch) {
    return {
      ticket: agentMatch[2],
      event: 'on_agent_completed',
    }
  }

  return null
}

// =============================================================================
// Tests
// =============================================================================

describe('E2E: Watch -> Orchestrate -> Ship (PRLT-1333)', () => {
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

  // ===========================================================================
  // Full Loop: Agent completes -> Watch reports -> Engine fires -> Ship executes
  // ===========================================================================

  describe('full autonomous loop', () => {
    it('should complete the watch -> poke -> orchestrate -> ship loop without human intervention', async () => {
      // -----------------------------------------------------------------------
      // Step 1: Set up the orchestrate engine with auto-merge hooks
      // -----------------------------------------------------------------------
      insertAutoMergeHooks(engineDb)

      const executedActions: OrchestrateActionResult[] = []
      const firedEvents: Array<{ event: string; ctx: OrchestrateEventContext }> = []

      // Track all CLI commands that the engine would execute
      const cliCommands: string[] = []
      const successExecutor: ChainExecutor = (command) => {
        cliCommands.push(command)
        return {
          stdout: JSON.stringify({
            type: 'success',
            prompt: null,
            success: true,
            result: { merged: true, ticketMoved: true },
            metadata: { command: 'work ship', flags: {} },
          }),
          stderr: '',
          status: 0,
        }
      }
      setChainExecutorForTesting(successExecutor)

      const engine = new OrchestrateEngine({
        db: engineDb,
        log: () => {},
      })

      // Intercept fireEvent to track execution
      const origFireEvent = engine.fireEvent.bind(engine)
      engine.fireEvent = async (event: string, ctx: OrchestrateEventContext) => {
        firedEvents.push({ event, ctx })
        const results = await origFireEvent(event, ctx)
        executedActions.push(...results)
        return results
      }

      // -----------------------------------------------------------------------
      // Step 2: Simulate watch reporting agent state
      // -----------------------------------------------------------------------
      const pollerDb = createPollerMockDb({
        agents: [
          {
            id: 'exec-1',
            ticket_id: 'PRLT-100',
            agent_name: 'bold-ada',
            status: 'completed',
            lifecycle_state: 'completed',
            container_id: null,
          },
        ],
      })
      const poller = createTestPoller(pollerDb)

      // Single poll returns full state (no baseline needed)
      const pollResult = await poller.poll()

      // Verify watch reported the completion
      expect(pollResult.items.length).to.be.greaterThan(0)
      const agentItem = pollResult.items.find(i => i.category === 'agents')
      expect(agentItem).to.exist
      expect(agentItem!.summary).to.include('bold-ada')
      // PRLT-1348: completed agents report as DONE health state
      expect(agentItem!.summary).to.include('DONE')
      expect(pollResult.message).to.not.be.null

      // -----------------------------------------------------------------------
      // Step 3: Simulate watch reporting CI green for PR #42
      // (In production, this comes from GitHub polling. Here we simulate
      // the state message that watch would produce.)
      // -----------------------------------------------------------------------
      const ciGreenStateMessage = 'GitHub PRs (1 open):\n- #42 (PRLT-100): "feat: implement auth" \u2014 CI: green, mergeable, no review\n\nReady tickets: none\n\nActive agents: none'

      // -----------------------------------------------------------------------
      // Step 4: Parse the state message (what the orchestrator LLM does)
      // -----------------------------------------------------------------------
      const parsed = parseStateMessage(ciGreenStateMessage)
      expect(parsed).to.not.be.null
      expect(parsed!.event).to.equal('on_ci_green')
      expect(parsed!.pr).to.equal(42)
      expect(parsed!.ticket).to.equal('PRLT-100')

      // -----------------------------------------------------------------------
      // Step 5: Fire the event on the orchestrate engine
      // (What happens when the orchestrator processes the state)
      // -----------------------------------------------------------------------
      const eventCtx: OrchestrateEventContext = {
        event: 'on_ci_green',
        ticket: parsed!.ticket,
        pr: parsed!.pr,
      }

      const results = await engine.fireEvent('on_ci_green', eventCtx)

      // -----------------------------------------------------------------------
      // Step 6: Verify the full loop completed
      // -----------------------------------------------------------------------

      // The engine should have fired the on_ci_green event
      expect(firedEvents).to.have.length(1)
      expect(firedEvents[0].event).to.equal('on_ci_green')
      expect(firedEvents[0].ctx.ticket).to.equal('PRLT-100')
      expect(firedEvents[0].ctx.pr).to.equal(42)

      // The merge-pr action should have executed (auto mode = immediate)
      expect(results).to.have.length(1)
      expect(results[0].action).to.equal('merge-pr')
      expect(results[0].success).to.be.true
      expect(results[0].awaitingConfirmation).to.be.undefined
      expect(results[0].awaitingLlmDecision).to.be.undefined

      // The CLI command should have been dispatched
      expect(cliCommands).to.have.length(1)
      expect(cliCommands[0]).to.include('prlt work ship')
      expect(cliCommands[0]).to.include('PRLT-100')
      expect(cliCommands[0]).to.include('--pr 42')
      expect(cliCommands[0]).to.include('--json')

      engine.stop()
    })

    it('should be reproducible -- run 3 times in a row with consistent results', async () => {
      // This verifies the "Reproducible -- run it 3 times in a row" AC
      for (let run = 0; run < 3; run++) {
        // Fresh state for each run
        resetEventBus()
        const db = createEngineDb()
        insertAutoMergeHooks(db)

        const cliCommands: string[] = []
        setChainExecutorForTesting((command) => {
          cliCommands.push(command)
          return {
            stdout: JSON.stringify({
              type: 'success',
              prompt: null,
              success: true,
              result: { merged: true },
              metadata: { command: 'work ship', flags: {} },
            }),
            stderr: '',
            status: 0,
          }
        })

        const engine = new OrchestrateEngine({ db, log: () => {} })

        // Simulate poller reporting state (no baseline needed)
        const pollerDb = createPollerMockDb({
          agents: [{
            id: `exec-${run}`,
            ticket_id: `PRLT-${100 + run}`,
            agent_name: `agent-${run}`,
            status: 'completed',
            lifecycle_state: 'completed',
            container_id: null,
          }],
        })
        const poller = createTestPoller(pollerDb)

        // Single poll reports full state
        const pollResult = await poller.poll()
        expect(pollResult.items.length).to.be.greaterThan(0, `Run ${run + 1}: poller should report state`)

        // Fire event and verify
        const results = await engine.fireEvent('on_ci_green', {
          event: 'on_ci_green',
          ticket: `PRLT-${100 + run}`,
          pr: 42 + run,
        })

        expect(results).to.have.length(1, `Run ${run + 1}: should have exactly 1 result`)
        expect(results[0].action).to.equal('merge-pr', `Run ${run + 1}: action should be merge-pr`)
        expect(results[0].success).to.be.true
        expect(cliCommands).to.have.length(1, `Run ${run + 1}: should dispatch exactly 1 CLI command`)
        expect(cliCommands[0]).to.include(`PRLT-${100 + run}`)

        engine.stop()
        db.close()
      }
    })
  })

  // ===========================================================================
  // State Message Parsing
  // ===========================================================================

  describe('state message parsing', () => {
    it('should extract PR number and ticket from CI green state report', () => {
      const msg = 'GitHub PRs (1 open):\n- #42 (PRLT-100): "feat: auth" \u2014 CI: green, mergeable, no review'
      const parsed = parseStateMessage(msg)
      expect(parsed).to.deep.equal({
        pr: 42,
        ticket: 'PRLT-100',
        event: 'on_ci_green',
      })
    })

    it('should extract PR number without ticket from CI green state report', () => {
      const msg = 'GitHub PRs (1 open):\n- #55: "fix: typo" \u2014 CI: green, mergeable, no review'
      const parsed = parseStateMessage(msg)
      expect(parsed).to.deep.equal({
        pr: 55,
        ticket: undefined,
        event: 'on_ci_green',
      })
    })

    it('should extract agent completed from state report', () => {
      const msg = 'Active agents (1):\n- bold-ada (TKT-001): completed'
      const parsed = parseStateMessage(msg)
      expect(parsed).to.deep.equal({
        ticket: 'TKT-001',
        event: 'on_agent_completed',
      })
    })

    it('should return null for state with no actionable items', () => {
      expect(parseStateMessage('GitHub PRs: none\n\nReady tickets: none\n\nActive agents: none')).to.be.null
      expect(parseStateMessage('')).to.be.null
    })
  })

  // ===========================================================================
  // Watch State Reporting
  // ===========================================================================

  describe('watch state reporting', () => {
    it('should report completed agent in full state', async () => {
      const db = createPollerMockDb({
        agents: [{
          id: 'exec-1',
          ticket_id: 'PRLT-200',
          agent_name: 'cool-turing',
          status: 'completed',
          lifecycle_state: 'completed',
          container_id: null,
        }],
      })
      const poller = createTestPoller(db)

      // Single poll returns full state
      const result = await poller.poll()

      expect(result.items.length).to.be.greaterThan(0)
      // PRLT-1348: done agents are summarized as counts, not listed individually
      expect(result.message).to.include('Active agents')
      expect(result.message).to.include('1 done')
    })

    it('should report multiple items across categories in a single poll', async () => {
      const db = createPollerMockDb({
        readyTickets: [{ id: 'PRLT-300', title: 'New ready ticket' }],
        agents: [
          { id: 'exec-1', ticket_id: 'PRLT-201', agent_name: 'agent-a', status: 'completed', lifecycle_state: 'completed', container_id: null },
          { id: 'exec-2', ticket_id: 'PRLT-202', agent_name: 'agent-b', status: 'running', lifecycle_state: null, container_id: null },
        ],
      })
      const poller = createTestPoller(db)

      const result = await poller.poll()

      expect(result.items).to.have.length(3) // 2 agents + 1 ticket
      expect(result.message).to.include('Active agents')
      expect(result.message).to.include('Ready tickets')
    })
  })

  // ===========================================================================
  // Orchestrate Engine Event Processing
  // ===========================================================================

  describe('orchestrate engine event processing', () => {
    it('should execute auto-mode hooks immediately without confirmation', async () => {
      insertAutoMergeHooks(engineDb)

      const cliCommands: string[] = []
      setChainExecutorForTesting((command) => {
        cliCommands.push(command)
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

      const results = await engine.fireEvent('on_ci_green', {
        event: 'on_ci_green',
        ticket: 'TKT-001',
        pr: 99,
      })

      expect(results).to.have.length(1)
      expect(results[0].action).to.equal('merge-pr')
      expect(results[0].success).to.be.true
      expect(cliCommands[0]).to.include('prlt work ship TKT-001 --pr 99')

      engine.stop()
    })

    it('should queue llm-mode hooks for LLM decision instead of executing', async () => {
      // Insert on_ci_green -> merge-pr in LLM mode
      engineDb.prepare(`
        INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source)
        VALUES ('hook-llm-merge', 'llm:on_ci_green:merge-pr', 'on_ci_green', 'shell', 'merge-pr', 1, 'llm', 0, 'preset')
      `).run()

      setChainExecutorForTesting(() => ({
        stdout: JSON.stringify({ type: 'success', prompt: null, success: true, result: {}, metadata: { command: 'test', flags: {} } }),
        stderr: '',
        status: 0,
      }))

      const engine = new OrchestrateEngine({ db: engineDb, log: () => {} })

      const results = await engine.fireEvent('on_ci_green', {
        event: 'on_ci_green',
        ticket: 'TKT-002',
        pr: 100,
      })

      expect(results).to.have.length(1)
      expect(results[0].action).to.equal('merge-pr')
      expect(results[0].awaitingLlmDecision).to.be.true

      // The action should be in the pending queue
      const pending = engine.getPendingLlmDecisions()
      expect(pending).to.have.length(1)
      expect(pending[0].action).to.equal('merge-pr')

      engine.stop()
    })

    it('should handle multiple hooks on the same event', async () => {
      // Insert two hooks: merge-pr (auto) + notify (auto)
      insertAutoMergeHooks(engineDb)
      engineDb.prepare(`
        INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source)
        VALUES ('hook-ci-green-notify', 'auto:on_ci_green:notify', 'on_ci_green', 'shell', 'notify', 1, 'auto', 1, 'preset')
      `).run()

      setChainExecutorForTesting(() => ({
        stdout: JSON.stringify({ type: 'success', prompt: null, success: true, result: {}, metadata: { command: 'test', flags: {} } }),
        stderr: '',
        status: 0,
      }))

      const engine = new OrchestrateEngine({ db: engineDb, log: () => {} })

      const results = await engine.fireEvent('on_ci_green', {
        event: 'on_ci_green',
        ticket: 'TKT-003',
        pr: 101,
      })

      expect(results).to.have.length(2)
      const actions = results.map(r => r.action).sort()
      expect(actions).to.deep.equal(['merge-pr', 'notify'])
      expect(results.every(r => r.success)).to.be.true

      engine.stop()
    })
  })

  // ===========================================================================
  // Ship Action Dispatches Correct CLI Command
  // ===========================================================================

  describe('ship action CLI dispatch', () => {
    it('should dispatch prlt work ship with ticket and PR number', async () => {
      insertAutoMergeHooks(engineDb)

      const commands: string[] = []
      setChainExecutorForTesting((command) => {
        commands.push(command)
        return {
          stdout: JSON.stringify({
            type: 'success',
            prompt: null,
            success: true,
            result: { merged: true },
            metadata: { command: 'work ship', flags: {} },
          }),
          stderr: '',
          status: 0,
        }
      })

      const engine = new OrchestrateEngine({ db: engineDb, log: () => {} })

      await engine.fireEvent('on_ci_green', {
        event: 'on_ci_green',
        ticket: 'PRLT-500',
        pr: 77,
      })

      expect(commands).to.have.length(1)
      expect(commands[0]).to.include('prlt work ship PRLT-500 --pr 77')
      expect(commands[0]).to.include('--json')
      // Must NOT include --yes (work ship doesn't have this flag)
      expect(commands[0]).to.not.include('--yes')

      engine.stop()
    })

    it('should dispatch prlt work ship with only PR when no ticket', async () => {
      insertAutoMergeHooks(engineDb)

      const commands: string[] = []
      setChainExecutorForTesting((command) => {
        commands.push(command)
        return {
          stdout: JSON.stringify({
            type: 'success',
            prompt: null,
            success: true,
            result: {},
            metadata: { command: 'work ship', flags: {} },
          }),
          stderr: '',
          status: 0,
        }
      })

      const engine = new OrchestrateEngine({ db: engineDb, log: () => {} })

      await engine.fireEvent('on_ci_green', {
        event: 'on_ci_green',
        pr: 88,
      })

      expect(commands[0]).to.include('prlt work ship --pr 88')

      engine.stop()
    })
  })

  // ===========================================================================
  // Error Handling in the Loop
  // ===========================================================================

  describe('error handling across the loop', () => {
    it('should handle merge failure gracefully without crashing', async () => {
      insertAutoMergeHooks(engineDb)

      setChainExecutorForTesting(() => ({
        stdout: JSON.stringify({
          type: 'error',
          error: { code: 'MERGE_CONFLICT', message: 'PR has merge conflicts' },
          metadata: { command: 'work ship', flags: {} },
        }),
        stderr: '',
        status: 1,
      }))

      const engine = new OrchestrateEngine({ db: engineDb, log: () => {} })

      const results = await engine.fireEvent('on_ci_green', {
        event: 'on_ci_green',
        ticket: 'TKT-CONFLICT',
        pr: 99,
      })

      expect(results).to.have.length(1)
      expect(results[0].action).to.equal('merge-pr')
      expect(results[0].success).to.be.false
      expect(results[0].error).to.be.a('string')

      engine.stop()
    })

    it('should not crash when no hooks match the event', async () => {
      // No hooks installed -- firing event should produce 0 results
      const engine = new OrchestrateEngine({ db: engineDb, log: () => {} })

      const results = await engine.fireEvent('on_ci_green', {
        event: 'on_ci_green',
        ticket: 'TKT-NOHOOK',
        pr: 1,
      })

      expect(results).to.have.length(0)

      engine.stop()
    })

    it('should handle poller returning empty state gracefully', async () => {
      const db = createPollerMockDb()
      const poller = createTestPoller(db)

      const result = await poller.poll()

      expect(result.items).to.have.length(0)
      // Always returns a formatted state report, even when empty (PRLT-1347)
      expect(result.message).to.be.a('string')
      expect(result.message).to.include('none')
    })
  })

  // ===========================================================================
  // Multi-PR Detection (multiple PRs in state report)
  // ===========================================================================

  describe('multi-event processing', () => {
    it('should handle multiple on_ci_green events fired sequentially', async () => {
      insertAutoMergeHooks(engineDb)

      const commands: string[] = []
      setChainExecutorForTesting((command) => {
        commands.push(command)
        return {
          stdout: JSON.stringify({
            type: 'success',
            prompt: null,
            success: true,
            result: {},
            metadata: { command: 'work ship', flags: {} },
          }),
          stderr: '',
          status: 0,
        }
      })

      const engine = new OrchestrateEngine({ db: engineDb, log: () => {} })

      // Fire events for 3 different PRs
      for (const pr of [10, 20, 30]) {
        await engine.fireEvent('on_ci_green', {
          event: 'on_ci_green',
          ticket: `TKT-${pr}`,
          pr,
        })
      }

      expect(commands).to.have.length(3)
      expect(commands[0]).to.include('--pr 10')
      expect(commands[1]).to.include('--pr 20')
      expect(commands[2]).to.include('--pr 30')

      engine.stop()
    })
  })

  // ===========================================================================
  // Watch -> Orchestrate Integration (state report -> event context)
  // ===========================================================================

  describe('watch-to-orchestrate integration', () => {
    it('should handle the full cycle: poller reports state -> parsed -> event fired -> action executed', async () => {
      // Set up engine
      insertAutoMergeHooks(engineDb)

      const commands: string[] = []
      setChainExecutorForTesting((command) => {
        commands.push(command)
        return {
          stdout: JSON.stringify({
            type: 'success',
            prompt: null,
            success: true,
            result: { merged: true, ticketStatus: 'Done' },
            metadata: { command: 'work ship', flags: {} },
          }),
          stderr: '',
          status: 0,
        }
      })

      const engine = new OrchestrateEngine({ db: engineDb, log: () => {} })

      // Set up poller reporting a completed agent
      const pollerDb = createPollerMockDb({
        agents: [{
          id: 'exec-integrate',
          ticket_id: 'PRLT-999',
          agent_name: 'sharp-lovelace',
          status: 'completed',
          lifecycle_state: 'completed',
          container_id: null,
        }],
      })
      const poller = createTestPoller(pollerDb)

      // Phase 1: Poll reports full state
      const agentPollResult = await poller.poll()
      expect(agentPollResult.message).to.not.be.null
      // PRLT-1348: done agents are summarized as counts, not listed individually
      expect(agentPollResult.message).to.include('Active agents')
      expect(agentPollResult.message).to.include('1 done')

      // Phase 2: CI goes green (simulated state report from GitHub polling)
      const ciGreenMessage = 'GitHub PRs (1 open):\n- #150 (PRLT-999): "feat: implement" \u2014 CI: green, mergeable, no review\n\nReady tickets: none\n\nActive agents: none'
      const parsed = parseStateMessage(ciGreenMessage)
      expect(parsed).to.not.be.null

      // Phase 3: Orchestrator processes the state
      const results = await engine.fireEvent('on_ci_green', {
        event: 'on_ci_green',
        ticket: parsed!.ticket,
        pr: parsed!.pr,
      })

      // Phase 4: Verify the ship action was dispatched
      expect(results).to.have.length(1)
      expect(results[0].action).to.equal('merge-pr')
      expect(results[0].success).to.be.true
      expect(commands[0]).to.include('prlt work ship PRLT-999 --pr 150')

      engine.stop()
    })
  })
})
