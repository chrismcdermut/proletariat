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
      'health-check',
      'resolve-conflict',
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
