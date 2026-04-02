import { expect } from 'chai'
import Database from 'better-sqlite3'
import { HookManager, stopHookManager } from '../../src/lib/work-lifecycle/hooks/manager.js'
import { WorkHookStorage, ensureHooksTable } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { resetEventBus } from '../../src/lib/events/event-bus.js'
import { OrchestrateEngine } from '../../src/lib/orchestrate/engine.js'
import {
  modeToTier,
  isLlmDecisionTimedOut,
  getTimedOutLlmDecisions,
  DEFAULT_LLM_TIMEOUT_MS,
} from '../../src/lib/orchestrate/escalation.js'
import type { PendingLlmDecision } from '../../src/lib/orchestrate/escalation.js'
import type { LlmDecision } from '../../src/lib/work-lifecycle/hooks/types.js'
import { hookModeTiers } from '../../src/lib/database/migrations/0021_hook_mode_tiers.js'
import { orchestrateHooks } from '../../src/lib/database/migrations/0015_orchestrate_hooks.js'

/**
 * Tests for the 3-tier supervision tree (PRLT-1204).
 *
 * Tests cover:
 * - HookMode type includes llm and human
 * - Database migration for new modes
 * - HookManager LLM mode (Tier 2): callback, queue, approve/deny/escalate
 * - HookManager human mode (Tier 3): callback, queue, approve/deny
 * - LLM→human escalation flow
 * - Timeout auto-escalation from LLM to human
 * - OrchestrateEngine integration with new tiers
 * - Escalation pipeline utility functions
 */

// =============================================================================
// Test Helpers
// =============================================================================

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureHooksTable(db)
  orchestrateHooks.up(db)
  hookModeTiers.up(db)
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

// =============================================================================
// Migration Tests
// =============================================================================

describe('PRLT-1204: 3-Tier Supervision Tree', () => {
  describe('migration 0021: hook mode tiers', () => {
    it('should allow inserting hooks with llm mode', () => {
      const db = createTestDb()
      try {
        expect(() => {
          db.prepare(
            "INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, mode) VALUES ('t1', 'llm-hook', 'on_ci_green', 'shell', 'true', 'llm')"
          ).run()
        }).to.not.throw()
      } finally {
        db.close()
      }
    })

    it('should allow inserting hooks with human mode', () => {
      const db = createTestDb()
      try {
        expect(() => {
          db.prepare(
            "INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, mode) VALUES ('t2', 'human-hook', 'on_ci_green', 'shell', 'true', 'human')"
          ).run()
        }).to.not.throw()
      } finally {
        db.close()
      }
    })

    it('should still allow existing modes (auto, confirm, notify, off)', () => {
      const db = createTestDb()
      try {
        for (const mode of ['auto', 'confirm', 'notify', 'off']) {
          expect(() => {
            db.prepare(
              `INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, mode) VALUES ('t-${mode}', '${mode}-hook', 'on_ci_green', 'shell', 'true', '${mode}')`
            ).run()
          }).to.not.throw()
        }
      } finally {
        db.close()
      }
    })

    it('should reject invalid modes', () => {
      const db = createTestDb()
      try {
        expect(() => {
          db.prepare(
            "INSERT INTO pmo_work_hooks (id, name, event, action_type, action_value, mode) VALUES ('t3', 'bad-hook', 'on_ci_green', 'shell', 'true', 'invalid')"
          ).run()
        }).to.throw()
      } finally {
        db.close()
      }
    })

    it('should be idempotent (safe to run twice)', () => {
      const db = new Database(':memory:')
      db.pragma('journal_mode = WAL')
      ensureHooksTable(db)
      orchestrateHooks.up(db)
      hookModeTiers.up(db)
      // Running again should not throw
      expect(() => hookModeTiers.up(db)).to.not.throw()
      db.close()
    })
  })

  // ===========================================================================
  // Escalation Utility Tests
  // ===========================================================================

  describe('escalation utilities', () => {
    describe('modeToTier', () => {
      it('should map auto to auto tier', () => {
        expect(modeToTier('auto')).to.equal('auto')
      })

      it('should map notify to auto tier', () => {
        expect(modeToTier('notify')).to.equal('auto')
      })

      it('should map llm to llm tier', () => {
        expect(modeToTier('llm')).to.equal('llm')
      })

      it('should map confirm to human tier', () => {
        expect(modeToTier('confirm')).to.equal('human')
      })

      it('should map human to human tier', () => {
        expect(modeToTier('human')).to.equal('human')
      })

      it('should map off to auto tier', () => {
        expect(modeToTier('off')).to.equal('auto')
      })
    })

    describe('isLlmDecisionTimedOut', () => {
      it('should return false when not timed out', () => {
        const decision: PendingLlmDecision = {
          hookName: 'test', event: 'on_ci_green', action: 'merge-pr',
          ctx: {}, queuedAt: Date.now(), timeoutMs: 60000,
        }
        expect(isLlmDecisionTimedOut(decision)).to.be.false
      })

      it('should return true when timed out', () => {
        const decision: PendingLlmDecision = {
          hookName: 'test', event: 'on_ci_green', action: 'merge-pr',
          ctx: {}, queuedAt: Date.now() - 120000, timeoutMs: 60000,
        }
        expect(isLlmDecisionTimedOut(decision)).to.be.true
      })

      it('should return true at exactly the timeout boundary', () => {
        const now = Date.now()
        const decision: PendingLlmDecision = {
          hookName: 'test', event: 'on_ci_green', action: 'merge-pr',
          ctx: {}, queuedAt: now - 60000, timeoutMs: 60000,
        }
        expect(isLlmDecisionTimedOut(decision, now)).to.be.true
      })
    })

    describe('getTimedOutLlmDecisions', () => {
      it('should return empty array when no decisions are timed out', () => {
        const now = Date.now()
        const decisions: PendingLlmDecision[] = [
          { hookName: 'a', event: 'e', action: 'x', ctx: {}, queuedAt: now, timeoutMs: 60000 },
        ]
        expect(getTimedOutLlmDecisions(decisions, now)).to.have.length(0)
      })

      it('should return timed-out decisions with llm_timeout reason', () => {
        const now = Date.now()
        const decisions: PendingLlmDecision[] = [
          { hookName: 'fresh', event: 'e', action: 'x', ctx: {}, queuedAt: now, timeoutMs: 60000 },
          { hookName: 'stale', event: 'e', action: 'y', ctx: {}, queuedAt: now - 120000, timeoutMs: 60000 },
        ]
        const timedOut = getTimedOutLlmDecisions(decisions, now)
        expect(timedOut).to.have.length(1)
        expect(timedOut[0].hookName).to.equal('stale')
        expect(timedOut[0].reason).to.equal('llm_timeout')
      })
    })

    describe('DEFAULT_LLM_TIMEOUT_MS', () => {
      it('should be 5 minutes', () => {
        expect(DEFAULT_LLM_TIMEOUT_MS).to.equal(5 * 60 * 1000)
      })
    })
  })

  // ===========================================================================
  // HookManager LLM Mode (Tier 2)
  // ===========================================================================

  describe('HookManager — LLM mode (Tier 2)', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
      resetEventBus()
      stopHookManager()
    })

    afterEach(() => {
      stopHookManager()
      resetEventBus()
      if (db) db.close()
    })

    it('should queue llm hooks without onLlmDecision callback', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'true', mode: 'llm' })

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].awaitingLlmDecision).to.be.true
      expect(results[0].tier).to.equal('llm')
      expect(manager.getPendingLlmDecisions()).to.have.length(1)
    })

    it('should call onLlmDecision callback and execute on approve', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'true', mode: 'llm' })

      let callbackCalled = false
      const manager = new HookManager({
        db,
        onLlmDecision: async (ctx) => {
          callbackCalled = true
          expect(ctx.hookName).to.equal('llm-hook')
          expect(ctx.event).to.equal('on_ci_green')
          return 'approve'
        },
      })

      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(callbackCalled).to.be.true
      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(results[0].awaitingLlmDecision).to.be.undefined
    })

    it('should skip hook when onLlmDecision returns deny', async () => {
      insertHook(db, { name: 'llm-deny', event: 'on_ci_green', action: 'true', mode: 'llm' })

      const manager = new HookManager({
        db,
        onLlmDecision: async () => 'deny',
      })

      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(results).to.have.length(1)
      expect(results[0].skipped).to.be.true
      expect(results[0].tier).to.equal('llm')
    })

    it('should escalate to human when onLlmDecision returns escalate', async () => {
      insertHook(db, { name: 'llm-escalate', event: 'on_ci_green', action: 'true', mode: 'llm' })

      let humanCalled = false
      const manager = new HookManager({
        db,
        onLlmDecision: async () => 'escalate',
        onHumanEscalation: async (ctx, reason) => {
          humanCalled = true
          expect(reason).to.equal('llm_escalate')
          return true
        },
      })

      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(humanCalled).to.be.true
      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(results[0].escalatedToHuman).to.be.true
      expect(results[0].tier).to.equal('human')
    })

    it('should queue for human when LLM escalates and no human callback', async () => {
      insertHook(db, { name: 'llm-escalate-no-human', event: 'on_ci_green', action: 'true', mode: 'llm' })

      const manager = new HookManager({
        db,
        onLlmDecision: async () => 'escalate',
        // No onHumanEscalation callback
      })

      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(results).to.have.length(1)
      expect(results[0].escalatedToHuman).to.be.true
      expect(results[0].awaitingConfirmation).to.be.true
      expect(results[0].tier).to.equal('human')
      expect(manager.getPendingHumanEscalations()).to.have.length(1)
      expect(manager.getPendingHumanEscalations()[0].reason).to.equal('llm_escalate')
    })

    it('should approve pending LLM decision and execute', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'true', mode: 'llm' })

      const manager = new HookManager({ db })
      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(manager.getPendingLlmDecisions()).to.have.length(1)

      const result = await manager.approveLlmDecision(0)
      expect(result).to.not.be.null
      expect(result!.success).to.be.true
      expect(result!.tier).to.equal('llm')
      expect(manager.getPendingLlmDecisions()).to.be.empty
    })

    it('should deny pending LLM decision and remove it', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'true', mode: 'llm' })

      const manager = new HookManager({ db })
      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      const denied = manager.denyLlmDecision(0)
      expect(denied).to.be.true
      expect(manager.getPendingLlmDecisions()).to.be.empty
    })

    it('should escalate pending LLM decision to human queue', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'true', mode: 'llm' })

      const manager = new HookManager({ db })
      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      const escalated = manager.escalateLlmDecision(0)
      expect(escalated).to.be.true
      expect(manager.getPendingLlmDecisions()).to.be.empty
      expect(manager.getPendingHumanEscalations()).to.have.length(1)
      expect(manager.getPendingHumanEscalations()[0].reason).to.equal('llm_escalate')
    })

    it('should return null/false for out-of-range LLM decision indexes', async () => {
      const manager = new HookManager({ db })
      expect(await manager.approveLlmDecision(99)).to.be.null
      expect(manager.denyLlmDecision(99)).to.be.false
      expect(manager.escalateLlmDecision(99)).to.be.false
    })

    it('should clear pending LLM decisions on stop', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'true', mode: 'llm' })

      const manager = new HookManager({ db })
      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(manager.getPendingLlmDecisions()).to.have.length(1)

      manager.stop()
      expect(manager.getPendingLlmDecisions()).to.be.empty
    })
  })

  // ===========================================================================
  // HookManager Human Mode (Tier 3)
  // ===========================================================================

  describe('HookManager — Human mode (Tier 3)', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
      resetEventBus()
      stopHookManager()
    })

    afterEach(() => {
      stopHookManager()
      resetEventBus()
      if (db) db.close()
    })

    it('should queue human hooks without onHumanEscalation callback', async () => {
      insertHook(db, { name: 'human-hook', event: 'on_ci_green', action: 'true', mode: 'human' })

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].awaitingConfirmation).to.be.true
      expect(results[0].tier).to.equal('human')
      expect(manager.getPendingHumanEscalations()).to.have.length(1)
      expect(manager.getPendingHumanEscalations()[0].reason).to.equal('direct')
    })

    it('should call onHumanEscalation callback and execute on approve', async () => {
      insertHook(db, { name: 'human-hook', event: 'on_ci_green', action: 'true', mode: 'human' })

      let callbackCalled = false
      const manager = new HookManager({
        db,
        onHumanEscalation: async (ctx, reason) => {
          callbackCalled = true
          expect(ctx.hookName).to.equal('human-hook')
          expect(reason).to.equal('direct')
          return true
        },
      })

      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(callbackCalled).to.be.true
      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
    })

    it('should skip hook when onHumanEscalation returns false', async () => {
      insertHook(db, { name: 'human-deny', event: 'on_ci_green', action: 'true', mode: 'human' })

      const manager = new HookManager({
        db,
        onHumanEscalation: async () => false,
      })

      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(results).to.have.length(1)
      expect(results[0].skipped).to.be.true
      expect(results[0].tier).to.equal('human')
    })

    it('should approve pending human escalation and execute', async () => {
      insertHook(db, { name: 'human-hook', event: 'on_ci_green', action: 'true', mode: 'human' })

      const manager = new HookManager({ db })
      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(manager.getPendingHumanEscalations()).to.have.length(1)

      const result = await manager.approveHumanEscalation(0)
      expect(result).to.not.be.null
      expect(result!.success).to.be.true
      expect(result!.tier).to.equal('human')
      expect(manager.getPendingHumanEscalations()).to.be.empty
    })

    it('should deny pending human escalation and remove it', async () => {
      insertHook(db, { name: 'human-hook', event: 'on_ci_green', action: 'true', mode: 'human' })

      const manager = new HookManager({ db })
      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      const denied = manager.denyHumanEscalation(0)
      expect(denied).to.be.true
      expect(manager.getPendingHumanEscalations()).to.be.empty
    })

    it('should return null/false for out-of-range human escalation indexes', async () => {
      const manager = new HookManager({ db })
      expect(await manager.approveHumanEscalation(99)).to.be.null
      expect(manager.denyHumanEscalation(99)).to.be.false
    })

    it('should clear pending human escalations on stop', async () => {
      insertHook(db, { name: 'human-hook', event: 'on_ci_green', action: 'true', mode: 'human' })

      const manager = new HookManager({ db })
      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(manager.getPendingHumanEscalations()).to.have.length(1)

      manager.stop()
      expect(manager.getPendingHumanEscalations()).to.be.empty
    })
  })

  // ===========================================================================
  // Timeout Auto-Escalation
  // ===========================================================================

  describe('LLM timeout auto-escalation', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
      resetEventBus()
      stopHookManager()
    })

    afterEach(() => {
      stopHookManager()
      resetEventBus()
      if (db) db.close()
    })

    it('should escalate timed-out LLM decisions to human queue', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'true', mode: 'llm' })

      const manager = new HookManager({ db, llmTimeoutMs: 100 })
      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(manager.getPendingLlmDecisions()).to.have.length(1)

      // Manually set the queuedAt to the past to simulate timeout
      const decisions = (manager as any)._pendingLlmDecisions as PendingLlmDecision[]
      decisions[0].queuedAt = Date.now() - 200

      const escalated = manager.escalateTimedOutLlmDecisions()
      expect(escalated).to.equal(1)
      expect(manager.getPendingLlmDecisions()).to.be.empty
      expect(manager.getPendingHumanEscalations()).to.have.length(1)
      expect(manager.getPendingHumanEscalations()[0].reason).to.equal('llm_timeout')
    })

    it('should not escalate non-timed-out LLM decisions', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'true', mode: 'llm' })

      const manager = new HookManager({ db, llmTimeoutMs: 999999 })
      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      const escalated = manager.escalateTimedOutLlmDecisions()
      expect(escalated).to.equal(0)
      expect(manager.getPendingLlmDecisions()).to.have.length(1)
      expect(manager.getPendingHumanEscalations()).to.be.empty
    })

    it('should handle mixed timed-out and fresh decisions', async () => {
      insertHook(db, { name: 'llm-hook-1', event: 'on_ci_green', action: 'true', mode: 'llm' })
      insertHook(db, { name: 'llm-hook-2', event: 'on_ci_green', action: 'echo ok', mode: 'llm' })

      const manager = new HookManager({ db, llmTimeoutMs: 1000 })
      await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(manager.getPendingLlmDecisions()).to.have.length(2)

      // Expire only the first decision
      const decisions = (manager as any)._pendingLlmDecisions as PendingLlmDecision[]
      decisions[0].queuedAt = Date.now() - 2000

      const escalated = manager.escalateTimedOutLlmDecisions()
      expect(escalated).to.equal(1)
      expect(manager.getPendingLlmDecisions()).to.have.length(1)
      expect(manager.getPendingHumanEscalations()).to.have.length(1)
    })
  })

  // ===========================================================================
  // OrchestrateEngine Integration
  // ===========================================================================

  describe('OrchestrateEngine — 3-tier integration', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
      resetEventBus()
    })

    afterEach(() => {
      resetEventBus()
      db.close()
    })

    it('should queue llm hooks and expose them via getPendingLlmDecisions', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'notify', mode: 'llm' })

      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].awaitingLlmDecision).to.be.true
      expect(results[0].tier).to.equal('llm')
      expect(engine.getPendingLlmDecisions()).to.have.length(1)
    })

    it('should approve LLM decision via engine', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'notify', mode: 'llm' })

      const engine = new OrchestrateEngine({ db })
      await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      const result = await engine.approveLlmDecision(0)
      expect(result).to.not.be.null
      expect(result!.success).to.be.true
      expect(engine.getPendingLlmDecisions()).to.be.empty
    })

    it('should deny LLM decision via engine', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'notify', mode: 'llm' })

      const engine = new OrchestrateEngine({ db })
      await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      const denied = engine.denyLlmDecision(0)
      expect(denied).to.be.true
      expect(engine.getPendingLlmDecisions()).to.be.empty
    })

    it('should escalate LLM decision to human via engine', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'notify', mode: 'llm' })

      const engine = new OrchestrateEngine({ db })
      await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      const escalated = engine.escalateLlmDecision(0)
      expect(escalated).to.be.true
      expect(engine.getPendingLlmDecisions()).to.be.empty
      expect(engine.getPendingHumanEscalations()).to.have.length(1)
    })

    it('should queue human hooks and expose them via getPendingHumanEscalations', async () => {
      insertHook(db, { name: 'human-hook', event: 'on_ci_green', action: 'notify', mode: 'human' })

      const engine = new OrchestrateEngine({ db })
      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].awaitingConfirmation).to.be.true
      expect(results[0].tier).to.equal('human')
      expect(engine.getPendingHumanEscalations()).to.have.length(1)
    })

    it('should approve human escalation via engine', async () => {
      insertHook(db, { name: 'human-hook', event: 'on_ci_green', action: 'notify', mode: 'human' })

      const engine = new OrchestrateEngine({ db })
      await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      const result = await engine.approveHumanEscalation(0)
      expect(result).to.not.be.null
      expect(result!.success).to.be.true
      expect(engine.getPendingHumanEscalations()).to.be.empty
    })

    it('should deny human escalation via engine', async () => {
      insertHook(db, { name: 'human-hook', event: 'on_ci_green', action: 'notify', mode: 'human' })

      const engine = new OrchestrateEngine({ db })
      await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      const denied = engine.denyHumanEscalation(0)
      expect(denied).to.be.true
      expect(engine.getPendingHumanEscalations()).to.be.empty
    })

    it('should escalate timed-out LLM decisions via engine', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'notify', mode: 'llm' })

      const engine = new OrchestrateEngine({ db, llmTimeoutMs: 50 })
      await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      // Manually expire the decision
      const decisions = (engine as any).manager._pendingLlmDecisions as PendingLlmDecision[]
      decisions[0].queuedAt = Date.now() - 100

      const count = engine.escalateTimedOutLlmDecisions()
      expect(count).to.equal(1)
      expect(engine.getPendingLlmDecisions()).to.be.empty
      expect(engine.getPendingHumanEscalations()).to.have.length(1)
    })

    it('should use onLlmDecision callback when provided', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'notify', mode: 'llm' })

      let called = false
      const engine = new OrchestrateEngine({
        db,
        onLlmDecision: async () => {
          called = true
          return 'approve'
        },
      })

      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(called).to.be.true
      expect(results[0].success).to.be.true
      expect(results[0].awaitingLlmDecision).to.be.undefined
    })

    it('should use onHumanEscalation callback when provided', async () => {
      insertHook(db, { name: 'human-hook', event: 'on_ci_green', action: 'notify', mode: 'human' })

      let called = false
      const engine = new OrchestrateEngine({
        db,
        onHumanEscalation: async () => {
          called = true
          return true
        },
      })

      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })
      expect(called).to.be.true
      expect(results[0].success).to.be.true
    })
  })

  // ===========================================================================
  // Mixed Tier Execution
  // ===========================================================================

  describe('mixed tier execution', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
      resetEventBus()
      stopHookManager()
    })

    afterEach(() => {
      stopHookManager()
      resetEventBus()
      if (db) db.close()
    })

    it('should execute auto, queue llm, and queue human hooks for the same event', async () => {
      insertHook(db, { name: 'auto-hook', event: 'on_agent_died', action: 'true', mode: 'auto', priority: 1 })
      insertHook(db, { name: 'llm-hook', event: 'on_agent_died', action: 'echo llm', mode: 'llm', priority: 2 })
      insertHook(db, { name: 'human-hook', event: 'on_agent_died', action: 'echo human', mode: 'human', priority: 3 })

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_agent_died', { event: 'on_agent_died' })

      expect(results).to.have.length(3)

      // auto executes
      expect(results[0].success).to.be.true
      expect(results[0].skipped).to.be.undefined

      // llm queued
      expect(results[1].awaitingLlmDecision).to.be.true
      expect(results[1].tier).to.equal('llm')

      // human queued
      expect(results[2].awaitingConfirmation).to.be.true
      expect(results[2].tier).to.equal('human')
    })

    it('should handle all three tiers with callbacks', async () => {
      insertHook(db, { name: 'auto-hook', event: 'on_agent_died', action: 'true', mode: 'auto', priority: 1 })
      insertHook(db, { name: 'llm-hook', event: 'on_agent_died', action: 'echo llm', mode: 'llm', priority: 2 })
      insertHook(db, { name: 'human-hook', event: 'on_agent_died', action: 'echo human', mode: 'human', priority: 3 })

      const manager = new HookManager({
        db,
        onLlmDecision: async () => 'approve',
        onHumanEscalation: async () => true,
      })

      const results = await manager.fireEvent('on_agent_died', { event: 'on_agent_died' })

      expect(results).to.have.length(3)
      // All three execute successfully
      for (const result of results) {
        expect(result.success).to.be.true
        expect(result.skipped).to.be.undefined
      }
    })

    it('confirm mode hooks should still work alongside llm and human modes', async () => {
      insertHook(db, { name: 'confirm-hook', event: 'on_ci_green', action: 'true', mode: 'confirm', priority: 1 })
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'echo llm', mode: 'llm', priority: 2 })

      const manager = new HookManager({ db })
      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(2)
      // confirm queued in pending confirmations
      expect(results[0].awaitingConfirmation).to.be.true
      // llm queued in pending LLM decisions
      expect(results[1].awaitingLlmDecision).to.be.true

      expect(manager.getPendingConfirmations()).to.have.length(1)
      expect(manager.getPendingLlmDecisions()).to.have.length(1)
    })
  })
})
