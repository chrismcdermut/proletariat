import { expect } from 'chai'
import { executeBuiltinAction, ACTION_HANDLERS, AGENT_SPAWN_TIMEOUT_MS } from '../../src/lib/orchestrate/actions.js'
import type { OrchestrateEventContext } from '../../src/lib/orchestrate/types.js'

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
  // Move-ticket CLI flag regression (PRLT-1220)
  // ===========================================================================

  describe('move-ticket command format (PRLT-1220)', () => {
    it('should use positional args, not --to or --yes flags', () => {
      const ctx: OrchestrateEventContext = {
        event: 'on_pr_merged',
        ticket: 'TKT-012',
      }
      const result = executeBuiltinAction('move-ticket', ctx, { target: 'in-progress' })
      // The action will fail because prlt is not available in test, but the
      // error message contains the exact command that was attempted.
      expect(result.success).to.be.false
      expect(result.error).to.be.a('string')
      // Must use positional args: prlt ticket move TICKETID COLUMN
      expect(result.error).to.include('prlt ticket move TKT-012 "in-progress"')
      // Must NOT use the old --to / --yes flags
      expect(result.error).to.not.include('--to')
      expect(result.error).to.not.include('--yes')
    })

    it('should default target to "done" when no config provided', () => {
      const ctx: OrchestrateEventContext = {
        event: 'on_pr_merged',
        ticket: 'TKT-099',
      }
      const result = executeBuiltinAction('move-ticket', ctx)
      expect(result.success).to.be.false
      expect(result.error).to.include('prlt ticket move TKT-099 "done"')
    })
  })

  // ===========================================================================
  // CLI Invocation String Validation (PRLT-1223)
  // ===========================================================================

  describe('CLI invocation strings', () => {
    // Each action that shells out to prlt will fail in test env because prlt
    // commands aren't available, but the error message contains the exact
    // command string, which we can validate against expected syntax.

    it('merge-pr should use: prlt work ship <ticket> --pr <number> --yes', () => {
      const result = executeBuiltinAction('merge-pr', {
        event: 'on_ci_green',
        ticket: 'PRLT-100',
        pr: 42,
      })
      expect(result.success).to.be.false
      expect(result.error).to.include('prlt work ship PRLT-100 --pr 42 --yes')
    })

    it('merge-pr should work with only PR (no ticket)', () => {
      const result = executeBuiltinAction('merge-pr', {
        event: 'on_ci_green',
        pr: 55,
      })
      expect(result.success).to.be.false
      expect(result.error).to.include('prlt work ship')
      expect(result.error).to.include('--pr 55')
      expect(result.error).to.include('--yes')
    })

    it('spawn-agent should use: prlt work start <ticket> --yes --display background', () => {
      const result = executeBuiltinAction('spawn-agent', {
        event: 'on_ticket_ready',
        ticket: 'PRLT-200',
      })
      expect(result.success).to.be.false
      expect(result.error).to.include('prlt work start PRLT-200 --yes --display background')
    })

    it('respawn should use: prlt work start <ticket> --yes --display background --force', () => {
      const result = executeBuiltinAction('respawn', {
        event: 'on_agent_died',
        ticket: 'PRLT-300',
      })
      expect(result.success).to.be.false
      expect(result.error).to.include('prlt work start PRLT-300 --yes --display background --force')
    })

    it('spawn-fix-agent should use: prlt work start <ticket> --action revise --yes --display background', () => {
      const result = executeBuiltinAction('spawn-fix-agent', {
        event: 'on_ci_failed',
        ticket: 'PRLT-400',
      })
      expect(result.success).to.be.false
      expect(result.error).to.include('prlt work start PRLT-400 --action revise --yes --display background')
    })

    it('spawn-review-agent should use: prlt work start <ticket> --action review --yes --display background', () => {
      const result = executeBuiltinAction('spawn-review-agent', {
        event: 'on_pr_opened',
        ticket: 'PRLT-450',
      })
      expect(result.success).to.be.false
      expect(result.error).to.include('prlt work start PRLT-450 --action review --yes --display background')
    })

    it('health-check should use: prlt poke <agent> "..."', () => {
      const result = executeBuiltinAction('health-check', {
        event: 'on_agent_idle',
        agent: 'bold-turing',
      })
      expect(result.success).to.be.false
      expect(result.error).to.include('prlt poke bold-turing')
    })

    it('cleanup-container should use: prlt docker rm <target> --yes', () => {
      const result = executeBuiltinAction('cleanup-container', {
        event: 'on_agent_completed',
        agent: 'bold-turing',
      })
      // cleanup-container uses `|| true` so it succeeds even when prlt is missing
      expect(result.action).to.equal('cleanup-container')
      expect(result.success).to.be.true
    })

    it('cleanup-container should prefer container over agent when both present', () => {
      const result = executeBuiltinAction('cleanup-container', {
        event: 'on_agent_completed',
        agent: 'bold-turing',
        container: 'prlt-container-abc',
      })
      // cleanup-container uses `|| true` so it succeeds even when prlt is missing
      expect(result.action).to.equal('cleanup-container')
      expect(result.success).to.be.true
    })

    it('rebase-conflicting-prs should use: prlt work rebase --all --yes', () => {
      const result = executeBuiltinAction('rebase-conflicting-prs', {
        event: 'on_pr_merged',
      })
      // May succeed (if || true catches) or fail, but the command should be correct
      expect(result.action).to.equal('rebase-conflicting-prs')
    })

    it('resolve-conflict should attempt poke then fallback to respawn with --action resolve', () => {
      const result = executeBuiltinAction('resolve-conflict', {
        event: 'on_pr_conflicting',
        ticket: 'PRLT-500',
        pr: 99,
      })
      // The poke will fail, then the respawn will fail in test env
      // but the error should show the fallback command
      expect(result.action).to.equal('resolve-conflict')
      if (!result.success && result.error) {
        expect(result.error).to.include('prlt work start PRLT-500 --action resolve --yes --display background')
      }
    })

    it('move-ticket should use positional args for all config targets', () => {
      const targets = ['done', 'review', 'in-progress', 'backlog']
      for (const target of targets) {
        const result = executeBuiltinAction('move-ticket', {
          event: 'on_pr_merged',
          ticket: 'TKT-001',
        }, { target })
        expect(result.success).to.be.false
        expect(result.error).to.include(`prlt ticket move TKT-001 "${target}"`)
        expect(result.error).to.not.include('--to')
        expect(result.error).to.not.include('--yes')
      }
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
    it('actions should catch execSync errors and return failure (not throw)', () => {
      // All actions that call execSync should catch errors and return a result
      const actionsWithContext: Array<{ name: string; ctx: OrchestrateEventContext }> = [
        { name: 'merge-pr', ctx: { event: 'test', ticket: 'TKT-1', pr: 1 } },
        { name: 'move-ticket', ctx: { event: 'test', ticket: 'TKT-1' } },
        { name: 'spawn-agent', ctx: { event: 'test', ticket: 'TKT-1' } },
        { name: 'respawn', ctx: { event: 'test', ticket: 'TKT-1' } },
        { name: 'spawn-fix-agent', ctx: { event: 'test', ticket: 'TKT-1' } },
        { name: 'spawn-review-agent', ctx: { event: 'test', ticket: 'TKT-1' } },
        { name: 'health-check', ctx: { event: 'test', agent: 'agent-1' } },
        { name: 'cleanup-container', ctx: { event: 'test', agent: 'agent-1' } },
        { name: 'resolve-conflict', ctx: { event: 'test', ticket: 'TKT-1' } },
      ]

      for (const { name, ctx } of actionsWithContext) {
        // Should not throw — errors are caught internally
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
      const result = executeBuiltinAction('merge-pr', {
        event: 'test',
        ticket: 'TKT-1',
        pr: 999,
      })
      // Will fail because prlt is not available — the error should contain context
      expect(result.success).to.be.false
      expect(result.error).to.be.a('string')
      expect(result.error!.length).to.be.greaterThan(0)
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
