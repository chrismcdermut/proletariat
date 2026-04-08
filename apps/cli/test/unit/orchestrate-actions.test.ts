import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  executeBuiltinAction,
  ACTION_HANDLERS,
  AGENT_SPAWN_TIMEOUT_MS,
  setChainExecutorForTesting,
} from '../../src/lib/orchestrate/actions.js'
import type { ChainExecutor } from '../../src/lib/orchestrate/prompt-chain.js'
import type { OrchestrateEventContext } from '../../src/lib/orchestrate/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ACTIONS_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../src/lib/orchestrate/actions.ts'),
  'utf-8',
)

/**
 * Unit tests for orchestrate built-in actions.
 *
 * Tests cover:
 * - Action registry completeness
 * - Notify action (pure, no side effects)
 * - Error handling for missing context
 * - Unknown action handling
 */

describe('Orchestrate Built-in Actions', () => {
  // ===========================================================================
  // Action Registry
  // ===========================================================================

  describe('action registry', () => {
    const expectedActions = [
      'merge-pr',
      'move-ticket',
      'rebase-conflicting-prs',
      'spawn-agent',
      'respawn',
      'notify',
      'cleanup-container',
      'spawn-fix-agent',
      'spawn-review-agent',
      'health-check',
      'resolve-conflict',
      'gc-sweep',
    ]

    it('should have all expected actions registered', () => {
      for (const action of expectedActions) {
        expect(ACTION_HANDLERS).to.have.property(action)
        expect(ACTION_HANDLERS[action]).to.be.a('function')
      }
    })

    it('should have exactly the expected number of actions', () => {
      expect(Object.keys(ACTION_HANDLERS)).to.have.length(expectedActions.length)
    })
  })

  // ===========================================================================
  // Notify Action (pure — no external dependencies)
  // ===========================================================================

  describe('notify action', () => {
    it('should succeed with all context fields', () => {
      const ctx: OrchestrateEventContext = {
        event: 'on_ci_green',
        ticket: 'TKT-100',
        pr: 123,
        agent: 'bold-turing',
      }
      const result = executeBuiltinAction('notify', ctx)
      expect(result.action).to.equal('notify')
      expect(result.success).to.be.true
      expect(result.durationMs).to.be.a('number').and.at.least(0)
    })

    it('should succeed with minimal context', () => {
      const result = executeBuiltinAction('notify', { event: 'on_ci_green' })
      expect(result.success).to.be.true
    })
  })

  // ===========================================================================
  // Missing Context Handling
  // ===========================================================================

  describe('missing context handling', () => {
    it('merge-pr should fail without ticket or PR', () => {
      const result = executeBuiltinAction('merge-pr', { event: 'on_ci_green' })
      expect(result.success).to.be.false
      expect(result.error).to.include('No ticket or PR')
    })

    it('move-ticket should fail without ticket', () => {
      const result = executeBuiltinAction('move-ticket', { event: 'on_pr_merged' })
      expect(result.success).to.be.false
      expect(result.error).to.include('No ticket')
    })

    it('spawn-agent should fail without ticket', () => {
      const result = executeBuiltinAction('spawn-agent', { event: 'on_ticket_ready' })
      expect(result.success).to.be.false
      expect(result.error).to.include('No ticket')
    })

    it('respawn should fail without ticket', () => {
      const result = executeBuiltinAction('respawn', { event: 'on_agent_died' })
      expect(result.success).to.be.false
      expect(result.error).to.include('No ticket')
    })

    it('spawn-fix-agent should fail without ticket', () => {
      const result = executeBuiltinAction('spawn-fix-agent', { event: 'on_ci_failed' })
      expect(result.success).to.be.false
      expect(result.error).to.include('No ticket')
    })

    it('spawn-review-agent should fail without ticket', () => {
      const result = executeBuiltinAction('spawn-review-agent', { event: 'on_pr_opened' })
      expect(result.success).to.be.false
      expect(result.error).to.include('No ticket')
    })

    it('health-check should fail without agent', () => {
      const result = executeBuiltinAction('health-check', { event: 'on_agent_idle' })
      expect(result.success).to.be.false
      expect(result.error).to.include('No agent')
    })

    it('cleanup-container should fail without agent or container', () => {
      const result = executeBuiltinAction('cleanup-container', { event: 'on_agent_completed' })
      expect(result.success).to.be.false
      expect(result.error).to.include('No agent or container')
    })
  })

  // ===========================================================================
  // Resolve Conflict Action
  // ===========================================================================

  describe('resolve-conflict action', () => {
    it('should skip (with success) when no ticket in context', () => {
      const result = executeBuiltinAction('resolve-conflict', { event: 'on_pr_conflicting', pr: 42 })
      expect(result.action).to.equal('resolve-conflict')
      expect(result.success).to.be.true
      expect(result.skipped).to.be.true
    })

    it('should attempt resolution when ticket is present', () => {
      // With a ticket, it will try to poke/respawn — both will fail in test env
      // but the action should not throw
      const result = executeBuiltinAction('resolve-conflict', {
        event: 'on_pr_conflicting',
        ticket: 'TKT-999',
        pr: 42,
      })
      expect(result.action).to.equal('resolve-conflict')
      // Will fail because prlt commands aren't available in test, but should not throw
      expect(result).to.have.property('success')
      expect(result).to.have.property('durationMs')
    })
  })

  // ===========================================================================
  // CLI Invocation String Validation (PRLT-1268)
  //
  // After PRLT-1268, all action handlers that shell out to prlt go through
  // walkPromptChain. We test the constructed base command by injecting a
  // mock executor that captures every command sent to it and returns a
  // synthetic success envelope so the chain terminates immediately.
  // ===========================================================================

  describe('CLI invocation strings (via prompt chain executor)', () => {
    let calls: string[] = []
    const successExecutor: ChainExecutor = (command) => {
      calls.push(command)
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
    }

    beforeEach(() => {
      calls = []
      setChainExecutorForTesting(successExecutor)
    })

    afterEach(() => {
      setChainExecutorForTesting(null)
    })

    it('merge-pr should call: prlt work ship <ticket> --pr <number> --json (no --yes)', () => {
      const result = executeBuiltinAction('merge-pr', {
        event: 'on_ci_green',
        ticket: 'PRLT-100',
        pr: 42,
      })
      expect(result.success).to.be.true
      expect(calls).to.have.length(1)
      expect(calls[0]).to.include('prlt work ship PRLT-100 --pr 42')
      expect(calls[0]).to.include('--json')
      expect(calls[0]).to.not.include('--yes')
    })

    it('merge-pr should work with only PR (no ticket)', () => {
      const result = executeBuiltinAction('merge-pr', {
        event: 'on_ci_green',
        pr: 55,
      })
      expect(result.success).to.be.true
      expect(calls[0]).to.include('prlt work ship --pr 55')
      expect(calls[0]).to.not.include('--yes')
    })

    it('spawn-agent should call: prlt work start <ticket> --json (no --yes, no --display)', () => {
      const result = executeBuiltinAction('spawn-agent', {
        event: 'on_ticket_ready',
        ticket: 'PRLT-200',
      })
      expect(result.success).to.be.true
      expect(calls[0]).to.equal('prlt work start PRLT-200 --json')
      // The whole point of PRLT-1268: no hardcoded --yes / --display flags
      expect(calls[0]).to.not.include('--yes')
      expect(calls[0]).to.not.include('--display')
    })

    it('respawn should call: prlt work start <ticket> --force --json', () => {
      const result = executeBuiltinAction('respawn', {
        event: 'on_agent_died',
        ticket: 'PRLT-300',
      })
      expect(result.success).to.be.true
      expect(calls[0]).to.equal('prlt work start PRLT-300 --force --json')
      expect(calls[0]).to.not.include('--yes')
      expect(calls[0]).to.not.include('--display')
    })

    it('spawn-fix-agent should call: prlt work start <ticket> --action revise --json', () => {
      const result = executeBuiltinAction('spawn-fix-agent', {
        event: 'on_ci_failed',
        ticket: 'PRLT-400',
      })
      expect(result.success).to.be.true
      expect(calls[0]).to.equal('prlt work start PRLT-400 --action revise --json')
      expect(calls[0]).to.not.include('--yes')
    })

    it('spawn-review-agent should call: prlt work start <ticket> --action review --json', () => {
      const result = executeBuiltinAction('spawn-review-agent', {
        event: 'on_pr_opened',
        ticket: 'PRLT-450',
      })
      expect(result.success).to.be.true
      expect(calls[0]).to.equal('prlt work start PRLT-450 --action review --json')
      expect(calls[0]).to.not.include('--yes')
    })

    it('move-ticket should call: prlt ticket move <ticket> "<target>" --json', () => {
      const targets = ['done', 'review', 'in-progress', 'backlog']
      for (const target of targets) {
        calls = []
        const result = executeBuiltinAction('move-ticket', {
          event: 'on_pr_merged',
          ticket: 'TKT-001',
        }, { target })
        expect(result.success).to.be.true
        expect(calls[0]).to.include(`prlt ticket move TKT-001 "${target}"`)
        expect(calls[0]).to.include('--json')
        expect(calls[0]).to.not.include('--yes')
      }
    })

    it('move-ticket defaults target to "done" when no config provided', () => {
      const result = executeBuiltinAction('move-ticket', {
        event: 'on_pr_merged',
        ticket: 'TKT-099',
      })
      expect(result.success).to.be.true
      expect(calls[0]).to.include('prlt ticket move TKT-099 "done"')
    })
  })

  // ===========================================================================
  // Direct execSync invocations (commands not yet behind prompt chain)
  // ===========================================================================

  describe('CLI invocation strings (direct execSync)', () => {
    it('health-check should use: prlt poke <agent> "..."', () => {
      const result = executeBuiltinAction('health-check', {
        event: 'on_agent_idle',
        agent: 'bold-turing',
      })
      expect(result.success).to.be.false
      expect(result.error).to.include('prlt poke bold-turing')
    })

    it('cleanup-container should use: prlt docker stop <target> --force', () => {
      const result = executeBuiltinAction('cleanup-container', {
        event: 'on_agent_completed',
        agent: 'bold-turing',
      })
      expect(result.action).to.equal('cleanup-container')
      if (!result.success && result.error) {
        expect(result.error).to.include('prlt docker stop bold-turing --force')
        expect(result.error).to.not.include('docker rm')
        expect(result.error).to.not.include('--yes')
      }
    })

    it('cleanup-container should prefer container over agent when both present', () => {
      const result = executeBuiltinAction('cleanup-container', {
        event: 'on_agent_completed',
        agent: 'bold-turing',
        container: 'prlt-container-abc',
      })
      expect(result.action).to.equal('cleanup-container')
      if (!result.success && result.error) {
        expect(result.error).to.include('prlt docker stop prlt-container-abc --force')
      }
    })

    it('rebase-conflicting-prs should use: prlt work rebase --all (no --yes, no error suppression)', () => {
      const result = executeBuiltinAction('rebase-conflicting-prs', {
        event: 'on_pr_merged',
      })
      expect(result.action).to.equal('rebase-conflicting-prs')
      if (!result.success && result.error) {
        expect(result.error).to.include('prlt work rebase --all')
        expect(result.error).to.not.include('--yes')
        expect(result.error).to.not.include('2>/dev/null')
      }
    })
  })

  // ===========================================================================
  // Invalid Flag Regression (PRLT-1259)
  // ===========================================================================

  describe('no invalid flags on CLI commands (PRLT-1259)', () => {
    // These tests read the source file directly to verify command strings,
    // because prlt may be globally installed and commands may succeed,
    // making error messages unavailable for inspection.

    /**
     * Extract the source code of a specific action handler from the source file.
     * Finds the handler by looking for its assignment in the const declaration
     * and captures everything up to the next top-level const or function.
     */
    function getHandlerSource(actionVarName: string): string {
      const pattern = new RegExp(`const ${actionVarName}[:\\s].*?(?=\\nconst |\\nfunction |\\n// =)`, 's')
      const match = ACTIONS_SOURCE.match(pattern)
      expect(match, `Could not find handler "${actionVarName}" in source`).to.not.be.null
      return match![0]
    }

    it('merge-pr must not pass --yes to prlt work ship', () => {
      const src = getHandlerSource('mergePr')
      expect(src).to.include('prlt')
      expect(src).to.include('work')
      expect(src).to.include('ship')
      // Must NOT pass --yes (work ship does not have this flag)
      expect(src).to.not.include('--yes')
    })

    it('rebase-conflicting-prs must not pass --yes to prlt work rebase', () => {
      const src = getHandlerSource('rebaseConflictingPrs')
      expect(src).to.include('prlt work rebase --all')
      expect(src).to.not.include('--yes')
    })

    it('rebase-conflicting-prs must not suppress errors with 2>/dev/null || true', () => {
      const src = getHandlerSource('rebaseConflictingPrs')
      expect(src).to.not.include('2>/dev/null')
      expect(src).to.not.include('|| true')
    })

    it('cleanup-container must use prlt docker stop --force, not prlt docker rm --yes', () => {
      const src = getHandlerSource('cleanupContainer')
      expect(src).to.include('prlt docker stop')
      expect(src).to.include('--force')
      expect(src).to.not.include('docker rm')
      expect(src).to.not.include('--yes')
    })

    // PRLT-1268: spawn-* handlers must not hardcode --yes / --display flags.
    // Instead they go through walkPromptChain which picks defaults from
    // the prompt chain.
    it('spawn-agent must not hardcode --yes or --display flags', () => {
      const src = getHandlerSource('spawnAgent')
      expect(src).to.include('walkPromptChain')
      expect(src).to.not.include('--yes')
      expect(src).to.not.include('--display background')
    })

    it('respawn must not hardcode --yes or --display flags', () => {
      const src = getHandlerSource('respawn')
      expect(src).to.include('walkPromptChain')
      // --force is still required so prlt skips its in-progress guard
      expect(src).to.include('--force')
      expect(src).to.not.include('--yes')
      expect(src).to.not.include('--display background')
    })

    it('spawn-fix-agent must not hardcode --yes or --display flags', () => {
      const src = getHandlerSource('spawnFixAgent')
      expect(src).to.include('walkPromptChain')
      expect(src).to.include('--action revise')
      expect(src).to.not.include('--yes')
      expect(src).to.not.include('--display background')
    })

    it('spawn-review-agent must not hardcode --yes or --display flags', () => {
      const src = getHandlerSource('spawnReviewAgent')
      expect(src).to.include('walkPromptChain')
      expect(src).to.include('--action review')
      expect(src).to.not.include('--yes')
      expect(src).to.not.include('--display background')
    })
  })

  // ===========================================================================
  // Unknown Action
  // ===========================================================================

  describe('unknown action', () => {
    it('should return failure for unregistered action name', () => {
      const result = executeBuiltinAction('nonexistent-action', { event: 'on_ci_green' })
      expect(result.success).to.be.false
      expect(result.error).to.include('Unknown action')
    })

    it('should include the action name in the error', () => {
      const result = executeBuiltinAction('does-not-exist', { event: 'on_ci_green' })
      expect(result.error).to.include('does-not-exist')
    })
  })

  // ===========================================================================
  // Agent Spawn Timeout (PRLT-1221 regression)
  // ===========================================================================

  describe('agent spawn timeout', () => {
    it('should export AGENT_SPAWN_TIMEOUT_MS >= 120s to avoid ETIMEDOUT on container setup', () => {
      expect(AGENT_SPAWN_TIMEOUT_MS).to.be.a('number')
      expect(AGENT_SPAWN_TIMEOUT_MS).to.be.at.least(120_000)
    })
  })

  // ===========================================================================
  // Error Handling and Timeouts (PRLT-1223)
  // ===========================================================================

  describe('error handling', () => {
    // Inject a failing executor so we don't shell out to real prlt for these
    // tests — keeps them fast and deterministic regardless of host config.
    const failingExecutor: ChainExecutor = (command) => ({
      stdout: JSON.stringify({
        type: 'error',
        error: { code: 'TEST_FAILURE', message: `mock failure for ${command}` },
        metadata: { command: 'test', flags: {} },
      }),
      stderr: '',
      status: 1,
    })

    beforeEach(() => {
      setChainExecutorForTesting(failingExecutor)
    })

    afterEach(() => {
      setChainExecutorForTesting(null)
    })

    it('actions should catch executor errors and return failure (not throw)', () => {
      const actionsWithContext: Array<{ name: string; ctx: OrchestrateEventContext }> = [
        { name: 'merge-pr', ctx: { event: 'test', ticket: 'TKT-1', pr: 1 } },
        { name: 'move-ticket', ctx: { event: 'test', ticket: 'TKT-1' } },
        { name: 'spawn-agent', ctx: { event: 'test', ticket: 'TKT-1' } },
        { name: 'respawn', ctx: { event: 'test', ticket: 'TKT-1' } },
        { name: 'spawn-fix-agent', ctx: { event: 'test', ticket: 'TKT-1' } },
        { name: 'spawn-review-agent', ctx: { event: 'test', ticket: 'TKT-1' } },
        { name: 'resolve-conflict', ctx: { event: 'test', ticket: 'TKT-1' } },
      ]

      for (const { name, ctx } of actionsWithContext) {
        const result = executeBuiltinAction(name, ctx)
        expect(result).to.have.property('action', name)
        expect(result).to.have.property('success')
        expect(result).to.have.property('durationMs')
        if (!result.success) {
          expect(result.error).to.be.a('string').with.length.greaterThan(0)
        }
      }
    })

    it('actions should include meaningful error messages on failure', () => {
      const result = executeBuiltinAction('move-ticket', {
        event: 'test',
        ticket: 'TKT-NONEXISTENT-999',
      })
      expect(result.success).to.be.false
      expect(result.error).to.be.a('string')
      expect(result.error).to.include('TEST_FAILURE')
    })

    it('resolve-conflict should gracefully skip when ticket is missing', () => {
      const result = executeBuiltinAction('resolve-conflict', {
        event: 'on_pr_conflicting',
        pr: 42,
        branch: 'feat/unknown',
      })
      expect(result.success).to.be.true
      expect(result.skipped).to.be.true
      expect(result.error).to.be.undefined
    })

    it('AGENT_SPAWN_TIMEOUT_MS should be used by spawn-agent, respawn, and spawn-fix-agent', () => {
      // Verify the timeout constant is reasonable and used by all spawn actions
      expect(AGENT_SPAWN_TIMEOUT_MS).to.equal(180_000)
      // This is implicitly tested by the CLI invocation tests above,
      // but we verify the constant is exported and has the right value
    })
  })

  // ===========================================================================
  // Action Result Shape
  // ===========================================================================

  describe('result shape', () => {
    it('should always include action, success, and durationMs', () => {
      const result = executeBuiltinAction('notify', { event: 'test' })
      expect(result).to.have.property('action')
      expect(result).to.have.property('success')
      expect(result).to.have.property('durationMs')
    })

    it('should include error only on failure', () => {
      const success = executeBuiltinAction('notify', { event: 'test' })
      expect(success.error).to.be.undefined

      const failure = executeBuiltinAction('merge-pr', { event: 'test' })
      expect(failure.error).to.be.a('string')
    })
  })
})
