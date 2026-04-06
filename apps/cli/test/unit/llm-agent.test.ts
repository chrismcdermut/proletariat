import { expect } from 'chai'
import Database from 'better-sqlite3'
import { HookManager, stopHookManager } from '../../src/lib/work-lifecycle/hooks/manager.js'
import { ensureHooksTable } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { resetEventBus } from '../../src/lib/events/event-bus.js'
import { OrchestrateEngine } from '../../src/lib/orchestrate/engine.js'
import { orchestrateHooks } from '../../src/lib/database/migrations/0015_orchestrate_hooks.js'
import { hookModeTiers } from '../../src/lib/database/migrations/0022_hook_mode_tiers.js'
import {
  buildDecisionPrompt,
  parseDecisionResponse,
  gatherDecisionContext,
  createLlmDecisionHandler,
} from '../../src/lib/orchestrate/llm-agent.js'
import type { DecisionContext } from '../../src/lib/orchestrate/llm-agent.js'
import type { EscalationContext } from '../../src/lib/orchestrate/escalation.js'
import type { LlmDecision } from '../../src/lib/work-lifecycle/hooks/types.js'

/**
 * Tests for the LLM Orchestrator Agent (PRLT-1253).
 *
 * Tests cover:
 * - parseDecisionResponse: all decision paths + edge cases
 * - buildDecisionPrompt: prompt structure and content
 * - createLlmDecisionHandler: factory function with mocked LLM
 * - HookManager integration: tier-2 decisions via callback
 * - OrchestrateEngine integration: end-to-end wiring
 * - Error handling: LLM failures escalate to human
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

function makeEscalationContext(overrides: Partial<EscalationContext> = {}): EscalationContext {
  return {
    hookName: 'test-hook',
    event: 'on_ci_green',
    action: 'merge-pr',
    ctx: {
      event: 'on_ci_green',
      ticket: 'PRLT-100',
      pr: 42,
      branch: 'feat/test-branch',
    },
    ...overrides,
  }
}

// =============================================================================
// parseDecisionResponse
// =============================================================================

describe('PRLT-1253: LLM Orchestrator Agent', () => {
  describe('parseDecisionResponse', () => {
    it('should parse APPROVE as first line', () => {
      expect(parseDecisionResponse('APPROVE\nCI is green, safe to merge.')).to.equal('approve')
    })

    it('should parse DENY as first line', () => {
      expect(parseDecisionResponse('DENY\nCI is failing.')).to.equal('deny')
    })

    it('should parse ESCALATE as first line', () => {
      expect(parseDecisionResponse('ESCALATE\nAmbiguous situation.')).to.equal('escalate')
    })

    it('should be case-insensitive for first line', () => {
      expect(parseDecisionResponse('approve\nLooks good.')).to.equal('approve')
      expect(parseDecisionResponse('Deny\nNot ready.')).to.equal('deny')
      expect(parseDecisionResponse('Escalate\nNeed human.')).to.equal('escalate')
    })

    it('should handle leading whitespace', () => {
      expect(parseDecisionResponse('  APPROVE\nAll good.')).to.equal('approve')
    })

    it('should handle leading blank lines', () => {
      expect(parseDecisionResponse('\n\nAPPROVE\nAll good.')).to.equal('approve')
    })

    it('should handle APPROVE with extra text on same line', () => {
      expect(parseDecisionResponse('APPROVE - CI is green and tests pass')).to.equal('approve')
    })

    it('should escalate on empty response', () => {
      expect(parseDecisionResponse('')).to.equal('escalate')
    })

    it('should escalate on whitespace-only response', () => {
      expect(parseDecisionResponse('   \n  \n  ')).to.equal('escalate')
    })

    it('should escalate when first line is ambiguous', () => {
      expect(parseDecisionResponse('I am not sure about this one.')).to.equal('escalate')
    })

    it('should fallback-scan for unambiguous APPROVE in body', () => {
      expect(parseDecisionResponse('Decision: APPROVE because CI is green')).to.equal('approve')
    })

    it('should fallback-scan for unambiguous DENY in body', () => {
      expect(parseDecisionResponse('Decision: DENY because tests fail')).to.equal('deny')
    })

    it('should escalate when multiple keywords found in body', () => {
      expect(parseDecisionResponse('I could APPROVE or DENY this.')).to.equal('escalate')
    })

    it('should escalate on completely unrelated response', () => {
      expect(parseDecisionResponse('The weather is nice today.')).to.equal('escalate')
    })
  })

  // ===========================================================================
  // buildDecisionPrompt
  // ===========================================================================

  describe('buildDecisionPrompt', () => {
    it('should include hook name, event, and action', () => {
      const context: DecisionContext = {
        escalation: makeEscalationContext(),
      }
      const prompt = buildDecisionPrompt(context)
      expect(prompt).to.include('test-hook')
      expect(prompt).to.include('on_ci_green')
      expect(prompt).to.include('merge-pr')
    })

    it('should include PR diff when available', () => {
      const context: DecisionContext = {
        escalation: makeEscalationContext(),
        prDiff: '+ added line\n- removed line',
      }
      const prompt = buildDecisionPrompt(context)
      expect(prompt).to.include('PR Diff')
      expect(prompt).to.include('+ added line')
      expect(prompt).to.include('- removed line')
    })

    it('should include ticket description when available', () => {
      const context: DecisionContext = {
        escalation: makeEscalationContext(),
        ticketDescription: 'Fix the login bug that causes 500 errors',
      }
      const prompt = buildDecisionPrompt(context)
      expect(prompt).to.include('Ticket Context')
      expect(prompt).to.include('Fix the login bug')
    })

    it('should include test output when available', () => {
      const context: DecisionContext = {
        escalation: makeEscalationContext(),
        testOutput: 'All 42 tests passed',
      }
      const prompt = buildDecisionPrompt(context)
      expect(prompt).to.include('CI/Test Status')
      expect(prompt).to.include('All 42 tests passed')
    })

    it('should include branch name when available', () => {
      const context: DecisionContext = {
        escalation: makeEscalationContext(),
        branch: 'feat/cool-feature',
      }
      const prompt = buildDecisionPrompt(context)
      expect(prompt).to.include('feat/cool-feature')
    })

    it('should include config when available', () => {
      const context: DecisionContext = {
        escalation: makeEscalationContext({ config: { target: 'done' } }),
      }
      const prompt = buildDecisionPrompt(context)
      expect(prompt).to.include('"target"')
      expect(prompt).to.include('"done"')
    })

    it('should work with minimal context (no enrichment)', () => {
      const context: DecisionContext = {
        escalation: makeEscalationContext(),
      }
      const prompt = buildDecisionPrompt(context)
      expect(prompt).to.include('APPROVE')
      expect(prompt).to.include('DENY')
      expect(prompt).to.include('ESCALATE')
      expect(prompt).to.not.include('PR Diff')
      expect(prompt).to.not.include('Ticket Context')
      expect(prompt).to.not.include('CI/Test Status')
    })

    it('should include decision guidelines', () => {
      const context: DecisionContext = {
        escalation: makeEscalationContext(),
      }
      const prompt = buildDecisionPrompt(context)
      expect(prompt).to.include('When to APPROVE')
      expect(prompt).to.include('When to DENY')
      expect(prompt).to.include('When to ESCALATE')
      expect(prompt).to.include('Response Format')
    })
  })

  // ===========================================================================
  // createLlmDecisionHandler
  // ===========================================================================

  describe('createLlmDecisionHandler', () => {
    // Use a minimal context without PR/ticket to avoid slow external command timeouts
    const minimalContext = makeEscalationContext({
      ctx: { event: 'on_ci_green' }, // No pr, ticket, or branch
    })

    it('should return approve when LLM responds APPROVE', async () => {
      const handler = createLlmDecisionHandler({
        invokeLlm: () => 'APPROVE\nCI is green, safe to merge.',
      })

      const decision = await handler(minimalContext)
      expect(decision).to.equal('approve')
    })

    it('should return deny when LLM responds DENY', async () => {
      const handler = createLlmDecisionHandler({
        invokeLlm: () => 'DENY\nTests are failing.',
      })

      const decision = await handler(minimalContext)
      expect(decision).to.equal('deny')
    })

    it('should return escalate when LLM responds ESCALATE', async () => {
      const handler = createLlmDecisionHandler({
        invokeLlm: () => 'ESCALATE\nNeed human review for this production change.',
      })

      const decision = await handler(minimalContext)
      expect(decision).to.equal('escalate')
    })

    it('should escalate on LLM invocation error', async () => {
      const handler = createLlmDecisionHandler({
        invokeLlm: () => { throw new Error('LLM unavailable') },
      })

      const decision = await handler(minimalContext)
      expect(decision).to.equal('escalate')
    })

    it('should escalate on empty LLM response', async () => {
      const handler = createLlmDecisionHandler({
        invokeLlm: () => '',
      })

      const decision = await handler(minimalContext)
      expect(decision).to.equal('escalate')
    })

    it('should log decision flow when log function provided', async () => {
      const logs: string[] = []
      const handler = createLlmDecisionHandler({
        log: (msg) => logs.push(msg),
        invokeLlm: () => 'APPROVE\nAll good.',
      })

      await handler(minimalContext)

      expect(logs.some(l => l.includes('Decision requested'))).to.be.true
      expect(logs.some(l => l.includes('Prompt built'))).to.be.true
      expect(logs.some(l => l.includes('Response received'))).to.be.true
      expect(logs.some(l => l.includes('Decision: approve'))).to.be.true
    })

    it('should log error and escalate on failure', async () => {
      const logs: string[] = []
      const handler = createLlmDecisionHandler({
        log: (msg) => logs.push(msg),
        invokeLlm: () => { throw new Error('timeout') },
      })

      const decision = await handler(minimalContext)
      expect(decision).to.equal('escalate')
      expect(logs.some(l => l.includes('Error during decision'))).to.be.true
      expect(logs.some(l => l.includes('escalating to human'))).to.be.true
    })

    it('should pass context through to prompt builder', async () => {
      let capturedPrompt = ''
      const handler = createLlmDecisionHandler({
        invokeLlm: (prompt) => {
          capturedPrompt = prompt
          return 'APPROVE'
        },
      })

      await handler(makeEscalationContext({
        hookName: 'my-special-hook',
        event: 'on_agent_died',
        action: 'respawn',
        ctx: { event: 'on_agent_died' }, // Minimal to avoid external calls
      }))

      expect(capturedPrompt).to.include('my-special-hook')
      expect(capturedPrompt).to.include('on_agent_died')
      expect(capturedPrompt).to.include('respawn')
    })
  })

  // ===========================================================================
  // HookManager Integration with LLM Agent
  // ===========================================================================

  describe('HookManager — LLM agent integration', () => {
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

    it('should execute hook when LLM agent approves', async () => {
      insertHook(db, { name: 'llm-merge', event: 'on_ci_green', action: 'true', mode: 'llm' })

      const handler = createLlmDecisionHandler({
        invokeLlm: () => 'APPROVE\nCI green, merge it.',
      })

      const manager = new HookManager({ db, onLlmDecision: handler })
      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(results[0].awaitingLlmDecision).to.be.undefined
      expect(manager.getPendingLlmDecisions()).to.be.empty
    })

    it('should skip hook when LLM agent denies', async () => {
      insertHook(db, { name: 'llm-merge', event: 'on_ci_green', action: 'true', mode: 'llm' })

      const handler = createLlmDecisionHandler({
        invokeLlm: () => 'DENY\nTests failing.',
      })

      const manager = new HookManager({ db, onLlmDecision: handler })
      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].skipped).to.be.true
      expect(results[0].tier).to.equal('llm')
    })

    it('should escalate to human queue when LLM agent escalates and no human callback', async () => {
      insertHook(db, { name: 'llm-merge', event: 'on_ci_green', action: 'true', mode: 'llm' })

      const handler = createLlmDecisionHandler({
        invokeLlm: () => 'ESCALATE\nNeed human review.',
      })

      const manager = new HookManager({ db, onLlmDecision: handler })
      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].escalatedToHuman).to.be.true
      expect(results[0].tier).to.equal('human')
      expect(manager.getPendingHumanEscalations()).to.have.length(1)
      expect(manager.getPendingHumanEscalations()[0].reason).to.equal('llm_escalate')
    })

    it('should escalate to human on LLM error', async () => {
      insertHook(db, { name: 'llm-merge', event: 'on_ci_green', action: 'true', mode: 'llm' })

      const handler = createLlmDecisionHandler({
        invokeLlm: () => { throw new Error('LLM down') },
      })

      const manager = new HookManager({ db, onLlmDecision: handler })
      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      // On error, handler returns 'escalate', which triggers human escalation
      expect(results).to.have.length(1)
      expect(results[0].escalatedToHuman).to.be.true
      expect(results[0].tier).to.equal('human')
    })

    it('should handle multiple llm hooks for the same event', async () => {
      insertHook(db, { name: 'llm-hook-1', event: 'on_ci_green', action: 'true', mode: 'llm', priority: 1 })
      insertHook(db, { name: 'llm-hook-2', event: 'on_ci_green', action: 'echo ok', mode: 'llm', priority: 2 })

      let callCount = 0
      const handler = createLlmDecisionHandler({
        invokeLlm: () => {
          callCount++
          return callCount === 1 ? 'APPROVE' : 'DENY'
        },
      })

      const manager = new HookManager({ db, onLlmDecision: handler })
      const results = await manager.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(2)
      expect(results[0].success).to.be.true     // First hook approved & executed
      expect(results[1].skipped).to.be.true      // Second hook denied
      expect(callCount).to.equal(2)
    })
  })

  // ===========================================================================
  // OrchestrateEngine Integration with LLM Agent
  // ===========================================================================

  describe('OrchestrateEngine — LLM agent integration', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
      resetEventBus()
    })

    afterEach(() => {
      resetEventBus()
      db.close()
    })

    it('should process llm hooks via agent instead of queuing', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'notify', mode: 'llm' })

      const engine = new OrchestrateEngine({
        db,
        onLlmDecision: createLlmDecisionHandler({
          invokeLlm: () => 'APPROVE\nGood to go.',
        }),
      })

      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].success).to.be.true
      expect(results[0].awaitingLlmDecision).to.be.undefined
      // No decisions should be queued since the agent handled them
      expect(engine.getPendingLlmDecisions()).to.be.empty
    })

    it('should deny via engine when LLM agent says DENY', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'notify', mode: 'llm' })

      const engine = new OrchestrateEngine({
        db,
        onLlmDecision: createLlmDecisionHandler({
          invokeLlm: () => 'DENY\nCI not green.',
        }),
      })

      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].skipped).to.be.true
      expect(results[0].tier).to.equal('llm')
    })

    it('should escalate via engine when LLM agent says ESCALATE', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'notify', mode: 'llm' })

      const engine = new OrchestrateEngine({
        db,
        onLlmDecision: createLlmDecisionHandler({
          invokeLlm: () => 'ESCALATE\nNeed human eyes.',
        }),
      })

      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      expect(results).to.have.length(1)
      expect(results[0].escalatedToHuman).to.be.true
      expect(engine.getPendingHumanEscalations()).to.have.length(1)
    })

    it('should handle mixed tiers with LLM agent wired', async () => {
      insertHook(db, { name: 'auto-hook', event: 'on_agent_died', action: 'true', mode: 'auto', priority: 1 })
      insertHook(db, { name: 'llm-hook', event: 'on_agent_died', action: 'echo ok', mode: 'llm', priority: 2 })
      insertHook(db, { name: 'human-hook', event: 'on_agent_died', action: 'echo human', mode: 'human', priority: 3 })

      const engine = new OrchestrateEngine({
        db,
        onLlmDecision: createLlmDecisionHandler({
          invokeLlm: () => 'APPROVE\nSafe to proceed.',
        }),
      })

      const results = await engine.fireEvent('on_agent_died', { event: 'on_agent_died' })

      expect(results).to.have.length(3)
      // Auto: executed immediately
      expect(results[0].success).to.be.true
      // LLM: approved by agent and executed
      expect(results[1].success).to.be.true
      expect(results[1].awaitingLlmDecision).to.be.undefined
      // Human: queued (no human callback)
      expect(results[2].awaitingConfirmation).to.be.true
      expect(results[2].tier).to.equal('human')
    })

    it('should escalate on LLM error and fall through to human queue', async () => {
      insertHook(db, { name: 'llm-hook', event: 'on_ci_green', action: 'notify', mode: 'llm' })

      const engine = new OrchestrateEngine({
        db,
        onLlmDecision: createLlmDecisionHandler({
          invokeLlm: () => { throw new Error('Network error') },
        }),
      })

      const results = await engine.fireEvent('on_ci_green', { event: 'on_ci_green' })

      // Error → escalate → queued for human
      expect(results).to.have.length(1)
      expect(results[0].escalatedToHuman).to.be.true
      expect(engine.getPendingHumanEscalations()).to.have.length(1)
      expect(engine.getPendingHumanEscalations()[0].reason).to.equal('llm_escalate')
    })
  })

  // ===========================================================================
  // gatherDecisionContext (with mocked externals)
  // ===========================================================================

  describe('gatherDecisionContext', () => {
    it('should return escalation context even when no enrichment is available', () => {
      const escalation = makeEscalationContext({
        ctx: { event: 'on_ci_green' }, // No ticket, PR, or branch
      })

      const result = gatherDecisionContext(escalation, {
        maxDiffChars: 8000,
        maxTestOutputChars: 4000,
      })

      expect(result.escalation).to.equal(escalation)
      // External calls will fail gracefully (no gh, no prlt)
      // These will be undefined since the commands aren't available in test
      expect(result.prDiff).to.be.undefined
      expect(result.ticketDescription).to.be.undefined
      expect(result.testOutput).to.be.undefined
    })

    it('should extract branch from context', () => {
      const escalation = makeEscalationContext({
        ctx: { event: 'on_ci_green', branch: 'feat/my-branch' },
      })

      const result = gatherDecisionContext(escalation, {
        maxDiffChars: 8000,
        maxTestOutputChars: 4000,
      })

      expect(result.branch).to.equal('feat/my-branch')
    })
  })
})
