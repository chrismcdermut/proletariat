import { expect } from 'chai'
import { executeBuiltinAction, ACTION_HANDLERS } from '../../src/lib/orchestrate/actions.js'
import { PRESETS, getPreset } from '../../src/lib/orchestrate/presets.js'
import { BUILTIN_ACTIONS, ORCHESTRATE_EVENTS } from '../../src/lib/orchestrate/types.js'
import { HOOKABLE_EVENTS } from '../../src/lib/work-lifecycle/hooks/types.js'
import type { OrchestrateEventContext } from '../../src/lib/orchestrate/types.js'

/**
 * Regression tests for PRLT-1226: Reviewer Agents
 *
 * Tests cover:
 * - spawn-review-agent action exists and works
 * - Review events (on_review_approved, on_changes_requested) are defined
 * - Presets wire on_pr_opened -> spawn-review-agent
 * - Presets wire on_changes_requested -> spawn-fix-agent
 * - Supervised preset: spawn-review-agent is auto (non-destructive)
 * - Review flow: PR created -> review -> approve/changes
 */

describe('Reviewer Agents (PRLT-1226)', () => {
  // ===========================================================================
  // spawn-review-agent action
  // ===========================================================================

  describe('spawn-review-agent action', () => {
    it('should be registered in ACTION_HANDLERS', () => {
      expect(ACTION_HANDLERS).to.have.property('spawn-review-agent')
      expect(ACTION_HANDLERS['spawn-review-agent']).to.be.a('function')
    })

    it('should be listed in BUILTIN_ACTIONS', () => {
      expect(BUILTIN_ACTIONS).to.include('spawn-review-agent')
    })

    it('should fail without ticket in context', () => {
      const result = executeBuiltinAction('spawn-review-agent', { event: 'on_pr_opened' })
      expect(result.success).to.be.false
      expect(result.error).to.include('No ticket')
    })

    it('should invoke prlt work start with --action review', () => {
      const result = executeBuiltinAction('spawn-review-agent', {
        event: 'on_pr_opened',
        ticket: 'PRLT-1226',
      })
      // Will fail in test env since prlt isn't available, but error contains the command
      expect(result.success).to.be.false
      expect(result.error).to.include('prlt work start PRLT-1226 --action review --yes --display background')
    })

    it('should use --action review (not implement, not revise)', () => {
      const result = executeBuiltinAction('spawn-review-agent', {
        event: 'on_pr_opened',
        ticket: 'TKT-TEST',
      })
      expect(result.error).to.include('--action review')
      expect(result.error).to.not.include('--action implement')
      expect(result.error).to.not.include('--action revise')
    })
  })

  // ===========================================================================
  // Review lifecycle events
  // ===========================================================================

  describe('review lifecycle events', () => {
    it('on_review_approved should be a valid hookable event', () => {
      expect(HOOKABLE_EVENTS).to.include('on_review_approved')
    })

    it('on_changes_requested should be a valid hookable event', () => {
      expect(HOOKABLE_EVENTS).to.include('on_changes_requested')
    })

    it('on_review_approved should be a valid orchestrate event', () => {
      expect(ORCHESTRATE_EVENTS).to.include('on_review_approved')
    })

    it('on_changes_requested should be a valid orchestrate event', () => {
      expect(ORCHESTRATE_EVENTS).to.include('on_changes_requested')
    })
  })

  // ===========================================================================
  // Preset wiring
  // ===========================================================================

  describe('preset wiring', () => {
    it('should wire on_pr_opened -> spawn-review-agent in all presets', () => {
      for (const presetName of ['aggressive', 'conservative', 'supervised'] as const) {
        const preset = getPreset(presetName)
        const reviewHooks = preset.hooks.filter(
          h => h.event === 'on_pr_opened' && h.action === 'spawn-review-agent'
        )
        expect(
          reviewHooks.length,
          `Preset "${presetName}" should have on_pr_opened -> spawn-review-agent hook`
        ).to.equal(1)
      }
    })

    it('should wire on_changes_requested -> spawn-fix-agent in all presets', () => {
      for (const presetName of ['aggressive', 'conservative', 'supervised'] as const) {
        const preset = getPreset(presetName)
        const fixHooks = preset.hooks.filter(
          h => h.event === 'on_changes_requested' && h.action === 'spawn-fix-agent'
        )
        expect(
          fixHooks.length,
          `Preset "${presetName}" should have on_changes_requested -> spawn-fix-agent hook`
        ).to.equal(1)
      }
    })

    it('should wire on_changes_requested -> notify in all presets', () => {
      for (const presetName of ['aggressive', 'conservative', 'supervised'] as const) {
        const preset = getPreset(presetName)
        const notifyHooks = preset.hooks.filter(
          h => h.event === 'on_changes_requested' && h.action === 'notify'
        )
        expect(
          notifyHooks.length,
          `Preset "${presetName}" should have on_changes_requested -> notify hook`
        ).to.equal(1)
      }
    })

    it('should wire on_review_approved -> notify in all presets', () => {
      for (const presetName of ['aggressive', 'conservative', 'supervised'] as const) {
        const preset = getPreset(presetName)
        const notifyHooks = preset.hooks.filter(
          h => h.event === 'on_review_approved' && h.action === 'notify'
        )
        expect(
          notifyHooks.length,
          `Preset "${presetName}" should have on_review_approved -> notify hook`
        ).to.equal(1)
      }
    })
  })

  // ===========================================================================
  // Supervised mode: review agents are safe (auto)
  // ===========================================================================

  describe('supervised mode safety', () => {
    it('spawn-review-agent should be auto in supervised preset (non-destructive)', () => {
      const supervised = getPreset('supervised')
      const reviewHooks = supervised.hooks.filter(h => h.action === 'spawn-review-agent')

      expect(reviewHooks.length).to.be.greaterThan(0)
      for (const hook of reviewHooks) {
        expect(hook.mode).to.equal('auto',
          'spawn-review-agent should be auto in supervised mode — review is read-only'
        )
      }
    })

    it('spawn-agent should still be confirm in supervised preset', () => {
      const supervised = getPreset('supervised')
      const spawnHooks = supervised.hooks.filter(h => h.action === 'spawn-agent')

      expect(spawnHooks.length).to.be.greaterThan(0)
      for (const hook of spawnHooks) {
        expect(hook.mode).to.equal('confirm',
          'spawn-agent should be confirm in supervised mode — implementation modifies code'
        )
      }
    })

    it('spawn-fix-agent should still be confirm in supervised preset', () => {
      const supervised = getPreset('supervised')
      const fixHooks = supervised.hooks.filter(h => h.action === 'spawn-fix-agent')

      expect(fixHooks.length).to.be.greaterThan(0)
      for (const hook of fixHooks) {
        expect(hook.mode).to.equal('confirm',
          'spawn-fix-agent should be confirm in supervised mode — fixes modify code'
        )
      }
    })
  })

  // ===========================================================================
  // Full review flow validation
  // ===========================================================================

  describe('review flow', () => {
    it('should have the complete review loop events wired in presets', () => {
      // The review flow:
      // 1. on_pr_opened -> spawn-review-agent (spawn reviewer)
      // 2. on_review_approved -> notify (inform human)
      // 3. on_changes_requested -> spawn-fix-agent (auto-fix)
      // 4. on_changes_requested -> notify (inform human)

      const preset = getPreset('aggressive')
      const hookKeys = preset.hooks.map(h => `${h.event}:${h.action}`)

      expect(hookKeys).to.include('on_pr_opened:spawn-review-agent')
      expect(hookKeys).to.include('on_review_approved:notify')
      expect(hookKeys).to.include('on_changes_requested:spawn-fix-agent')
      expect(hookKeys).to.include('on_changes_requested:notify')
    })

    it('all review events should be valid RuntimeEventNames (no orphan events)', () => {
      const reviewEvents = ['on_review_approved', 'on_changes_requested']
      for (const event of reviewEvents) {
        expect(HOOKABLE_EVENTS).to.include(event,
          `Review event "${event}" must be a valid hookable event`
        )
        expect(ORCHESTRATE_EVENTS).to.include(event,
          `Review event "${event}" must be a valid orchestrate event`
        )
      }
    })
  })
})
