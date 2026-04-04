import { expect } from 'chai'
import { OrchestrateEngine } from '../../src/lib/orchestrate/engine.js'
import Database from 'better-sqlite3'
import { ensureHooksTable } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { resetEventBus } from '../../src/lib/events/event-bus.js'
import type { OrchestrateActionResult } from '../../src/lib/orchestrate/types.js'

/**
 * Unit tests for the OrchestrateEngine.
 *
 * Tests cover:
 * - Event handling and hook execution (delegated to HookManager)
 * - Mode-aware behavior (auto, confirm, notify, off)
 * - Pending confirmation queue
 * - Shell fallback execution
 * - Error handling
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
  return db
}

function insertHook(db: Database.Database, opts: {
  name: string
  event: string
  action: string
  mode?: string
  priority?: number
  config?: string
  enabled?: number
}): string {
  const id = `hook-${Math.random().toString(36).slice(2, 8)}`
  db.prepare(`
    INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, enabled, mode, priority, source, config)
    VALUES (?, ?, ?, 'shell', ?, ?, ?, ?, 'cli', ?)
  `).run(id, opts.name, opts.event, opts.action, opts.enabled ?? 1, opts.mode ?? 'auto', opts.priority ?? 0, opts.config ?? null)
  return id
}

describe('OrchestrateEngine', () => {
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
  // Basic Event Handling
  // ===========================================================================

  describe('fireEvent', () => {
    it('should return empty results when no hooks match', async () => {
      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(results).to.be.an('array').that.is.empty
    })

    it('should execute matching hooks and return results', async () => {
      insertHook(db, { name: 'notify-ci', event: 'on_ci_green', action: 'notify', mode: 'auto' })
      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green', pr: 123 })

      expect(results).to.have.length(1)
      expect(results[0].action).to.equal('notify')
      expect(results[0].success).to.be.true
    })

    it('should execute hooks in priority order', async () => {
      const executed: string[] = []
      insertHook(db, { name: 'low-priority', event: 'on_ci_green', action: 'notify', mode: 'auto', priority: 10 })
      insertHook(db, { name: 'high-priority', event: 'on_ci_green', action: 'notify', mode: 'auto', priority: 1 })

      const engine = new OrchestrateEngine({
        db,
        log: (msg) => {
          const match = msg.match(/(\w+-priority) →/)
          if (match) executed.push(match[1])
        },
      })

      await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(executed[0]).to.equal('high-priority')
      expect(executed[1]).to.equal('low-priority')
    })

    it('should not execute disabled hooks', async () => {
      insertHook(db, { name: 'disabled-hook', event: 'on_ci_green', action: 'notify', mode: 'auto', enabled: 0 })
      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(results).to.be.empty
    })
  })

  // ===========================================================================
  // Mode Behavior
  // ===========================================================================

  describe('modes', () => {
    it('should skip hooks with mode=off', async () => {
      insertHook(db, { name: 'off-hook', event: 'on_ci_green', action: 'notify', mode: 'off' })
      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].skipped).to.be.true
    })

    it('should execute auto hooks immediately', async () => {
      insertHook(db, { name: 'auto-hook', event: 'on_ci_green', action: 'notify', mode: 'auto' })
      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(results[0].skipped).to.be.undefined
      expect(results[0].awaitingConfirmation).to.be.undefined
    })

    it('should queue confirm hooks without onConfirm callback', async () => {
      insertHook(db, { name: 'confirm-hook', event: 'on_ci_green', action: 'notify', mode: 'confirm' })
      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].awaitingConfirmation).to.be.true
      expect(engine.getPendingConfirmations()).to.have.length(1)
    })

    it('should call onConfirm callback for confirm mode hooks', async () => {
      insertHook(db, { name: 'confirm-hook', event: 'on_ci_green', action: 'notify', mode: 'confirm' })

      let confirmCalled = false
      const engine = new OrchestrateEngine({
        db,
        onConfirm: async (hookName, event, action) => {
          confirmCalled = true
          expect(hookName).to.equal('confirm-hook')
          expect(event).to.equal('on_ci_green')
          return true
        },
      })

      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(confirmCalled).to.be.true
      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(results[0].awaitingConfirmation).to.be.undefined
    })

    it('should skip confirm hook when onConfirm returns false', async () => {
      insertHook(db, { name: 'denied-hook', event: 'on_ci_green', action: 'notify', mode: 'confirm' })

      const engine = new OrchestrateEngine({
        db,
        onConfirm: async () => false,
      })

      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(results).to.have.length(1)
      expect(results[0].skipped).to.be.true
    })

    it('should call onNotify callback for notify mode hooks', async () => {
      insertHook(db, { name: 'notify-hook', event: 'on_ci_green', action: 'notify', mode: 'notify' })

      let notifyCalled = false
      const engine = new OrchestrateEngine({
        db,
        onNotify: (hookName, event, action, result) => {
          notifyCalled = true
          expect(hookName).to.equal('notify-hook')
          expect(event).to.equal('on_ci_green')
          expect(action).to.equal('notify')
          expect(result.success).to.be.true
        },
      })

      await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(notifyCalled).to.be.true
    })
  })

  // ===========================================================================
  // Pending Confirmations
  // ===========================================================================

  describe('pendingConfirmations', () => {
    it('should approve a pending confirmation and execute it', async () => {
      insertHook(db, { name: 'confirm-hook', event: 'on_ci_green', action: 'notify', mode: 'confirm' })
      const engine = new OrchestrateEngine({ db })
      await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(engine.getPendingConfirmations()).to.have.length(1)

      const result = await engine.approveConfirmation(0)
      expect(result).to.not.be.null
      expect(result!.success).to.be.true
      expect(engine.getPendingConfirmations()).to.be.empty
    })

    it('should deny a pending confirmation and remove it', async () => {
      insertHook(db, { name: 'confirm-hook', event: 'on_ci_green', action: 'notify', mode: 'confirm' })
      const engine = new OrchestrateEngine({ db })
      await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      const denied = engine.denyConfirmation(0)
      expect(denied).to.be.true
      expect(engine.getPendingConfirmations()).to.be.empty
    })

    it('should return null for out-of-range approval index', async () => {
      const engine = new OrchestrateEngine({ db })
      const result = await engine.approveConfirmation(99)
      expect(result).to.be.null
    })

    it('should return false for out-of-range denial index', () => {
      const engine = new OrchestrateEngine({ db })
      const result = engine.denyConfirmation(99)
      expect(result).to.be.false
    })
  })

  // ===========================================================================
  // Shell Fallback
  // ===========================================================================

  describe('shell fallback', () => {
    it('should execute unknown actions as shell commands', async () => {
      insertHook(db, { name: 'shell-hook', event: 'on_ci_green', action: 'echo hello', mode: 'auto' })
      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(results[0].action).to.equal('echo hello')
    })

    it('should return failure for failed shell commands', async () => {
      insertHook(db, { name: 'fail-hook', event: 'on_ci_green', action: 'exit 1', mode: 'auto' })
      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.false
      expect(results[0].error).to.be.a('string')
    })
  })

  // ===========================================================================
  // Start/Stop
  // ===========================================================================

  describe('start/stop', () => {
    it('should be idempotent on multiple starts', () => {
      const engine = new OrchestrateEngine({ db })
      engine.start()
      engine.start() // should not throw
      engine.stop()
    })

    it('should clear pending confirmations on stop', async () => {
      insertHook(db, { name: 'confirm-hook', event: 'on_ci_green', action: 'notify', mode: 'confirm' })
      const engine = new OrchestrateEngine({ db })
      await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(engine.getPendingConfirmations()).to.have.length(1)

      engine.stop()
      expect(engine.getPendingConfirmations()).to.be.empty
    })
  })

  // ===========================================================================
  // Context Building
  // ===========================================================================

  describe('context building', () => {
    it('should pass context fields through to actions', async () => {
      insertHook(db, { name: 'ctx-hook', event: 'on_ci_green', action: 'notify', mode: 'auto' })
      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', {
        event: 'on_ci_green',
        ticket: 'TKT-100',
        pr: 456,
        branch: 'feat/test',
      })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
    })
  })

  // ===========================================================================
  // Delegation to HookManager (PRLT-1219)
  // ===========================================================================

  describe('delegation', () => {
    it('should use a single execution path via HookManager', async () => {
      // Verify that OrchestrateEngine delegates to HookManager
      // by checking that mode-aware execution works identically
      insertHook(db, { name: 'auto-hook', event: 'on_ci_green', action: 'notify', mode: 'auto' })
      insertHook(db, { name: 'off-hook', event: 'on_ci_green', action: 'notify', mode: 'off' })

      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(2)
      // auto hook executes
      expect(results[0].success).to.be.true
      expect(results[0].skipped).to.be.undefined
      // off hook is skipped
      expect(results[1].skipped).to.be.true
    })
  })

  // ===========================================================================
  // Hook Deduplication (PRLT-1223)
  // ===========================================================================

  describe('hook deduplication', () => {
    it('should not execute the same hook twice for a single event fire', async () => {
      // Insert a single hook — it should execute exactly once per fireEvent call
      insertHook(db, { name: 'dedup-hook', event: 'on_ci_green', action: 'notify', mode: 'auto' })

      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].action).to.equal('notify')
    })

    it('should execute each distinct hook once when multiple hooks match', async () => {
      insertHook(db, { name: 'hook-a', event: 'on_ci_green', action: 'notify', mode: 'auto', priority: 1 })
      insertHook(db, { name: 'hook-b', event: 'on_ci_green', action: 'notify', mode: 'auto', priority: 2 })

      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      // Each distinct hook fires exactly once
      expect(results).to.have.length(2)
    })

    it('should not accumulate state across separate event fires', async () => {
      insertHook(db, { name: 'repeatable-hook', event: 'on_ci_green', action: 'notify', mode: 'auto' })

      const engine = new OrchestrateEngine({ db })

      // Fire the same event twice — each fire should return fresh results
      const results1 = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })
      const results2 = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results1).to.have.length(1)
      expect(results2).to.have.length(1)
    })

    it('confirm-mode hooks should not execute without approval even on repeated fires', async () => {
      insertHook(db, { name: 'confirm-dedup', event: 'on_ticket_ready', action: 'spawn-agent', mode: 'confirm' })

      const engine = new OrchestrateEngine({ db })

      // Fire event multiple times — confirm hook should queue each time but never execute
      const results1 = await engine.fireEvent('on_ticket_ready', { event: 'on_ticket_ready', ticket: 'TKT-1' })
      const results2 = await engine.fireEvent('on_ticket_ready', { event: 'on_ticket_ready', ticket: 'TKT-1' })

      // Both fires return awaitingConfirmation
      expect(results1).to.have.length(1)
      expect(results1[0].awaitingConfirmation).to.be.true
      expect(results2).to.have.length(1)
      expect(results2[0].awaitingConfirmation).to.be.true

      // Pending queue has both
      expect(engine.getPendingConfirmations()).to.have.length(2)
    })
  })

  // ===========================================================================
  // Supervised Mode Integration (PRLT-1223)
  // ===========================================================================

  describe('supervised mode integration', () => {
    it('should execute auto hooks and queue llm hooks for the same event', async () => {
      // Simulate supervised preset: safe action (auto) + destructive action (llm)
      insertHook(db, { name: 'safe-notify', event: 'on_agent_died', action: 'notify', mode: 'auto', priority: 1 })
      insertHook(db, { name: 'dangerous-respawn', event: 'on_agent_died', action: 'respawn', mode: 'llm', priority: 2 })

      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_agent_died', {
        event: 'on_agent_died',
        ticket: 'TKT-1',
        agent: 'agent-1',
      })

      expect(results).to.have.length(2)
      // First hook (auto notify) executes immediately
      expect(results[0].action).to.equal('notify')
      expect(results[0].success).to.be.true
      expect(results[0].skipped).to.be.undefined
      // Second hook (llm respawn) is queued for LLM decision
      expect(results[1].awaitingLlmDecision).to.be.true
      expect(engine.getPendingLlmDecisions()).to.have.length(1)
    })

    it('off-mode hooks should never execute regardless of event count', async () => {
      insertHook(db, { name: 'disabled-hook', event: 'on_ci_green', action: 'notify', mode: 'off' })

      const engine = new OrchestrateEngine({ db })
      const results1 = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })
      const results2 = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })
      const results3 = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      // All three fires should skip the off-mode hook
      for (const results of [results1, results2, results3]) {
        expect(results).to.have.length(1)
        expect(results[0].skipped).to.be.true
      }
    })
  })
})
