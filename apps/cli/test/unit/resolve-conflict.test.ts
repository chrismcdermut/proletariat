import { expect } from 'chai'
import { executeBuiltinAction, ACTION_HANDLERS } from '../../src/lib/orchestrate/actions.js'
import { BUILTIN_ACTIONS } from '../../src/lib/orchestrate/types.js'
import type { OrchestrateEventContext } from '../../src/lib/orchestrate/types.js'
import { PRESETS } from '../../src/lib/orchestrate/presets.js'

/**
 * Regression tests for PRLT-1161: Daemon auto-detect and resolve merge conflicts.
 * Updated for PRLT-1222: resolve-conflict moved to confirm mode + dedup fixes.
 *
 * Tests cover:
 * - resolve-conflict action is registered and wired
 * - Skips PRs with no associated ticket (AC: no action on unassociated PRs)
 * - on_pr_conflicting event triggers resolve-conflict in presets
 * - resolve-conflict requires confirmation in supervised preset (PRLT-1222)
 * - Agent-spawning actions are NOT classified as safe (PRLT-1222)
 */

describe('Merge Conflict Resolution (PRLT-1161, PRLT-1222)', () => {
  // ===========================================================================
  // Action Registration
  // ===========================================================================

  describe('resolve-conflict action registration', () => {
    it('should be registered in ACTION_HANDLERS', () => {
      expect(ACTION_HANDLERS).to.have.property('resolve-conflict')
      expect(ACTION_HANDLERS['resolve-conflict']).to.be.a('function')
    })

    it('should be listed in BUILTIN_ACTIONS', () => {
      expect(BUILTIN_ACTIONS).to.include('resolve-conflict')
    })
  })

  // ===========================================================================
  // No-Ticket Skip Behavior (AC: no action on PRs with no associated ticket)
  // ===========================================================================

  describe('skip behavior for unassociated PRs', () => {
    it('should skip with success when no ticket is in context', () => {
      const result = executeBuiltinAction('resolve-conflict', {
        event: 'on_pr_conflicting',
        pr: 42,
        branch: 'some-random-branch',
      })
      expect(result.action).to.equal('resolve-conflict')
      expect(result.success).to.be.true
      expect(result.skipped).to.be.true
    })

    it('should skip when context has only event field', () => {
      const result = executeBuiltinAction('resolve-conflict', {
        event: 'on_pr_conflicting',
      })
      expect(result.success).to.be.true
      expect(result.skipped).to.be.true
    })
  })

  // ===========================================================================
  // Resolution Attempt (AC: running agents poked, stopped agents respawned)
  // ===========================================================================

  describe('resolution attempt with ticket', () => {
    it('should attempt resolution and return a result (not throw)', () => {
      const ctx: OrchestrateEventContext = {
        event: 'on_pr_conflicting',
        ticket: 'TKT-999',
        pr: 42,
        branch: 'PRLT-999/feat/some-feature',
      }
      const result = executeBuiltinAction('resolve-conflict', ctx)
      expect(result.action).to.equal('resolve-conflict')
      // In test environment prlt commands fail, but the action should handle it gracefully
      expect(result).to.have.property('success')
      expect(result).to.have.property('durationMs')
      expect(result.durationMs).to.be.a('number').and.at.least(0)
    })

    it('should not have skipped flag when ticket is present', () => {
      const result = executeBuiltinAction('resolve-conflict', {
        event: 'on_pr_conflicting',
        ticket: 'TKT-100',
        pr: 10,
      })
      // With a ticket, it attempts resolution (even if it fails in test env)
      expect(result.skipped).to.be.undefined
    })
  })

  // ===========================================================================
  // Preset Integration (AC: conflicts detected within one polling interval)
  // ===========================================================================

  describe('preset integration', () => {
    it('should wire on_pr_conflicting to resolve-conflict in all presets', () => {
      for (const [presetName, preset] of Object.entries(PRESETS)) {
        const conflictHooks = preset.hooks.filter(
          h => h.event === 'on_pr_conflicting' && h.action === 'resolve-conflict'
        )
        expect(conflictHooks.length).to.be.greaterThan(
          0,
          `Preset "${presetName}" should have a resolve-conflict hook for on_pr_conflicting`
        )
      }
    })

    it('should auto-execute resolve-conflict in aggressive preset', () => {
      const hook = PRESETS.aggressive.hooks.find(
        h => h.event === 'on_pr_conflicting' && h.action === 'resolve-conflict'
      )
      expect(hook).to.exist
      expect(hook!.mode).to.equal('auto')
    })

    it('should require confirmation for resolve-conflict in supervised preset (spawns agents)', () => {
      const hook = PRESETS.supervised.hooks.find(
        h => h.event === 'on_pr_conflicting' && h.action === 'resolve-conflict'
      )
      expect(hook).to.exist
      expect(hook!.mode).to.equal('confirm')
    })

    it('should require confirmation for resolve-conflict in conservative preset', () => {
      const hook = PRESETS.conservative.hooks.find(
        h => h.event === 'on_pr_conflicting' && h.action === 'resolve-conflict'
      )
      expect(hook).to.exist
      expect(hook!.mode).to.equal('confirm')
    })
  })

  // ===========================================================================
  // Result Shape
  // ===========================================================================

  describe('result shape', () => {
    it('should always include action, success, and durationMs', () => {
      const result = executeBuiltinAction('resolve-conflict', {
        event: 'on_pr_conflicting',
      })
      expect(result).to.have.property('action', 'resolve-conflict')
      expect(result).to.have.property('success')
      expect(result).to.have.property('durationMs')
    })
  })

  // ===========================================================================
  // PRLT-1222 Regression: agent-spawning actions must not be safe
  // ===========================================================================

  describe('PRLT-1222: agent-spawning actions are destructive', () => {
    const AGENT_SPAWNING_ACTIONS = ['spawn-agent', 'respawn', 'spawn-fix-agent', 'resolve-conflict']

    it('should NOT classify any agent-spawning action as safe in supervised preset', () => {
      const supervised = PRESETS.supervised
      for (const action of AGENT_SPAWNING_ACTIONS) {
        const hooks = supervised.hooks.filter(h => h.action === action)
        for (const hook of hooks) {
          expect(hook.mode).to.equal(
            'confirm',
            `Agent-spawning action "${action}" (event: ${hook.event}) must be confirm in supervised preset, not ${hook.mode}`
          )
        }
      }
    })

    it('should classify resolve-conflict as confirm in supervised preset', () => {
      const hook = PRESETS.supervised.hooks.find(
        h => h.action === 'resolve-conflict'
      )
      expect(hook).to.exist
      expect(hook!.mode).to.equal('confirm')
    })

    it('should still allow resolve-conflict as auto in aggressive preset', () => {
      const hook = PRESETS.aggressive.hooks.find(
        h => h.action === 'resolve-conflict'
      )
      expect(hook).to.exist
      expect(hook!.mode).to.equal('auto')
    })
  })
})
