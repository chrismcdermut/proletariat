import { expect } from 'chai'
import Database from 'better-sqlite3'
import { OrchestrateEngine } from '../../src/lib/orchestrate/engine.js'
import { OrchestratePoller } from '../../src/lib/orchestrate/poller.js'
import { ensureHooksTable } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { resetEventBus } from '../../src/lib/events/event-bus.js'
import type { OrchestrateActionResult, OrchestrateEventContext } from '../../src/lib/orchestrate/types.js'

/**
 * Daemon integration tests for supervised mode (PRLT-1223).
 *
 * Tests cover:
 * - Supervised mode poll cycles produce 0 container spawns
 * - LLM-mode hooks correctly block spawn-agent on on_ticket_ready
 * - Full engine + poller integration with mode-aware execution
 */

function createTestDb(): Database.Database {
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

  // Create minimal tables for polling
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
      last_heartbeat TEXT,
      role TEXT NOT NULL DEFAULT 'worker'
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0
    )
  `)

  // Insert statuses
  db.prepare("INSERT INTO pmo_workflow_statuses (id, name, category) VALUES ('status-ready', 'Ready', 'unstarted')").run()
  db.prepare("INSERT INTO pmo_workflow_statuses (id, name, category) VALUES ('status-ip', 'In Progress', 'started')").run()

  return db
}

function insertSupervisedHooks(db: Database.Database): void {
  // Insert hooks matching the supervised preset: safe=auto (Tier 1), destructive=llm (Tier 2)
  const hooks = [
    { name: 'sup:on_ticket_ready:spawn-agent', event: 'on_ticket_ready', action: 'spawn-agent', mode: 'llm' },
    { name: 'sup:on_agent_died:respawn', event: 'on_agent_died', action: 'respawn', mode: 'llm' },
    { name: 'sup:on_agent_died:notify', event: 'on_agent_died', action: 'notify', mode: 'auto' },
    { name: 'sup:on_ci_green:merge-pr', event: 'on_ci_green', action: 'merge-pr', mode: 'llm' },
    { name: 'sup:on_agent_completed:cleanup', event: 'on_agent_completed', action: 'cleanup-container', mode: 'auto' },
    { name: 'sup:on_agent_idle:health-check', event: 'on_agent_idle', action: 'health-check', mode: 'auto' },
    { name: 'sup:on_ci_failed:notify', event: 'on_ci_failed', action: 'notify', mode: 'auto' },
    { name: 'sup:on_ci_failed:spawn-fix', event: 'on_ci_failed', action: 'spawn-fix-agent', mode: 'llm' },
    { name: 'sup:on_agent_completed:gc-sweep', event: 'on_agent_completed', action: 'gc-sweep', mode: 'auto' },
  ]

  for (const hook of hooks) {
    db.prepare(`
      INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source)
      VALUES (?, ?, ?, 'shell', ?, 1, ?, 0, 'preset')
    `).run(`hook-${hook.name}`, hook.name, hook.event, hook.action, hook.mode)
  }
}

describe('Orchestrate Daemon — Supervised Mode (PRLT-1223)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    resetEventBus()
  })

  afterEach(() => {
    resetEventBus()
    db.close()
  })

  // ===========================================================================
  // Supervised Poll Cycles
  // ===========================================================================

  describe('supervised mode poll cycles', () => {
    it('should spawn 0 containers across 3 poll cycles in supervised mode', async () => {
      insertSupervisedHooks(db)

      // Add some ready tickets that would normally trigger spawn-agent
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-1', 'Ready ticket 1', 'status-ready', NULL)").run()
      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-2', 'Ready ticket 2', 'status-ready', NULL)").run()

      const executedActions: OrchestrateActionResult[] = []
      const engine = new OrchestrateEngine({
        db,
        log: () => {},
      })

      // Intercept fireEvent to track what's executed
      const origFireEvent = engine.fireEvent.bind(engine)
      engine.fireEvent = async (event: string, ctx: OrchestrateEventContext) => {
        const results = await origFireEvent(event, ctx)
        executedActions.push(...results)
        return results
      }

      const poller = new OrchestratePoller({ engine, db, log: () => {} })

      // Run 3 poll cycles
      await poller.poll()
      await poller.poll()
      await poller.poll()

      // spawn-agent should be in llm mode, so no actual spawns without LLM approval
      const spawnResults = executedActions.filter(r => r.action === 'spawn-agent')
      const executedSpawns = spawnResults.filter(r => r.success && !r.skipped && !r.awaitingLlmDecision)
      expect(executedSpawns).to.have.length(0, 'No containers should be spawned in supervised mode without LLM approval')

      // But spawn-agent should be queued for LLM decision
      const queuedSpawns = spawnResults.filter(r => r.awaitingLlmDecision)
      expect(queuedSpawns.length).to.be.greaterThan(0, 'spawn-agent hooks should be queued for LLM decision')
    })

    it('pending confirmations should accumulate without executing', async () => {
      insertSupervisedHooks(db)

      db.prepare("INSERT INTO pmo_tickets (id, title, status_id, assignee) VALUES ('TKT-1', 'Ready', 'status-ready', NULL)").run()

      const engine = new OrchestrateEngine({ db, log: () => {} })

      // Manually fire on_ticket_ready — spawn-agent should be queued
      const results = await engine.fireEvent('on_ticket_ready', {
        event: 'on_ticket_ready',
        ticket: 'TKT-1',
      })

      const spawns = results.filter(r => r.action === 'spawn-agent')
      expect(spawns).to.have.length(1)
      expect(spawns[0].awaitingLlmDecision).to.be.true

      // Pending LLM decisions should have the queued action
      const pending = engine.getPendingLlmDecisions()
      expect(pending).to.have.length(1)
      expect(pending[0].action).to.equal('spawn-agent')
      expect(pending[0].event).to.equal('on_ticket_ready')
    })
  })

  // ===========================================================================
  // Confirm Mode Skip Behavior
  // ===========================================================================

  describe('llm mode skip behavior', () => {
    it('on_ticket_ready should queue spawn-agent in llm mode (not execute)', async () => {
      insertSupervisedHooks(db)

      const engine = new OrchestrateEngine({ db, log: () => {} })
      const results = await engine.fireEvent('on_ticket_ready', {
        event: 'on_ticket_ready',
        ticket: 'TKT-42',
      })

      expect(results).to.have.length(1)
      expect(results[0].action).to.equal('spawn-agent')
      expect(results[0].awaitingLlmDecision).to.be.true
      expect(results[0].skipped).to.be.undefined
    })

    it('on_ticket_ready should skip spawn-agent when onLlmDecision returns deny', async () => {
      insertSupervisedHooks(db)

      const engine = new OrchestrateEngine({
        db,
        log: () => {},
        onLlmDecision: async () => 'deny', // always deny
      })

      const results = await engine.fireEvent('on_ticket_ready', {
        event: 'on_ticket_ready',
        ticket: 'TKT-42',
      })

      expect(results).to.have.length(1)
      expect(results[0].action).to.equal('spawn-agent')
      expect(results[0].skipped).to.be.true
    })

    it('auto-mode hooks should still execute in supervised mode', async () => {
      insertSupervisedHooks(db)

      const engine = new OrchestrateEngine({ db, log: () => {} })

      // on_agent_died has: notify (auto) + respawn (llm)
      const results = await engine.fireEvent('on_agent_died', {
        event: 'on_agent_died',
        ticket: 'TKT-1',
        agent: 'agent-1',
      })

      expect(results).to.have.length(2)

      // notify (auto) should execute
      const notifyResult = results.find(r => r.action === 'notify')
      expect(notifyResult).to.exist
      expect(notifyResult!.success).to.be.true
      expect(notifyResult!.awaitingLlmDecision).to.be.undefined

      // respawn (llm) should be queued for LLM decision
      const respawnResult = results.find(r => r.action === 'respawn')
      expect(respawnResult).to.exist
      expect(respawnResult!.awaitingLlmDecision).to.be.true
    })

    it('denying all LLM decisions results in zero external actions', async () => {
      insertSupervisedHooks(db)

      const engine = new OrchestrateEngine({
        db,
        log: () => {},
        onLlmDecision: async () => 'deny',
      })

      // Fire multiple events with destructive actions
      await engine.fireEvent('on_ticket_ready', { event: 'on_ticket_ready', ticket: 'TKT-1' })
      await engine.fireEvent('on_agent_died', { event: 'on_agent_died', ticket: 'TKT-2', agent: 'a-2' })
      await engine.fireEvent('on_ci_green', { event: 'on_ci_green', ticket: 'TKT-3', pr: 10 })

      // No pending LLM decisions (all were denied immediately by onLlmDecision)
      expect(engine.getPendingLlmDecisions()).to.have.length(0)
    })
  })
})
