import { expect } from 'chai'
import { PRESETS, getPreset } from '../../src/lib/orchestrate/presets.js'
import { BUILTIN_ACTIONS, PRESET_NAMES, HOOK_MODES, ORCHESTRATE_EVENTS } from '../../src/lib/orchestrate/types.js'
import { ACTION_HANDLERS } from '../../src/lib/orchestrate/actions.js'
import { HOOKABLE_EVENTS } from '../../src/lib/work-lifecycle/hooks/types.js'
import type { HookMode, PresetName } from '../../src/lib/orchestrate/types.js'

/**
 * Unit tests for orchestrate presets.
 *
 * Tests cover:
 * - Preset completeness and validity
 * - Aggressive: all auto
 * - Conservative: all confirm
 * - Supervised: safe=auto, destructive=confirm
 */

const SAFE_ACTIONS = new Set([
  'move-ticket',
  'notify',
  'cleanup-container',
  'health-check',
  'rebase-conflicting-prs',
  'spawn-review-agent',
  'gc-sweep',
])

describe('Orchestrate Presets', () => {
  // ===========================================================================
  // Preset Registry
  // ===========================================================================

  describe('registry', () => {
    it('should define all preset names', () => {
      for (const name of PRESET_NAMES) {
        expect(PRESETS).to.have.property(name)
      }
    })

    it('should return preset via getPreset()', () => {
      for (const name of PRESET_NAMES) {
        const preset = getPreset(name)
        expect(preset).to.exist
        expect(preset.name).to.equal(name)
        expect(preset.description).to.be.a('string').with.length.greaterThan(0)
        expect(preset.hooks).to.be.an('array').with.length.greaterThan(0)
      }
    })

    it('should have valid modes on all hooks in all presets', () => {
      for (const name of PRESET_NAMES) {
        const preset = getPreset(name)
        for (const hook of preset.hooks) {
          expect(HOOK_MODES).to.include(hook.mode, `Invalid mode "${hook.mode}" in preset "${name}" for ${hook.event}→${hook.action}`)
        }
      }
    })

    it('should have valid event names on all hooks', () => {
      for (const name of PRESET_NAMES) {
        const preset = getPreset(name)
        for (const hook of preset.hooks) {
          expect(hook.event).to.be.a('string').with.length.greaterThan(0)
        }
      }
    })
  })

  // ===========================================================================
  // Aggressive Preset
  // ===========================================================================

  describe('aggressive', () => {
    it('should set all hooks to auto mode', () => {
      const preset = getPreset('aggressive')
      for (const hook of preset.hooks) {
        expect(hook.mode).to.equal('auto', `Expected auto for ${hook.event}→${hook.action}`)
      }
    })
  })

  // ===========================================================================
  // Conservative Preset
  // ===========================================================================

  describe('conservative', () => {
    it('should set all hooks to confirm mode', () => {
      const preset = getPreset('conservative')
      for (const hook of preset.hooks) {
        expect(hook.mode).to.equal('confirm', `Expected confirm for ${hook.event}→${hook.action}`)
      }
    })
  })

  // ===========================================================================
  // Supervised Preset
  // ===========================================================================

  describe('supervised', () => {
    it('should set safe actions to auto', () => {
      const preset = getPreset('supervised')
      const safeHooks = preset.hooks.filter(h => SAFE_ACTIONS.has(h.action))

      expect(safeHooks.length).to.be.greaterThan(0, 'Should have at least one safe hook')
      for (const hook of safeHooks) {
        expect(hook.mode).to.equal('auto', `Expected auto for safe action ${hook.event}→${hook.action}`)
      }
    })

    it('should set destructive actions to confirm', () => {
      const preset = getPreset('supervised')
      const destructiveHooks = preset.hooks.filter(h => !SAFE_ACTIONS.has(h.action))

      expect(destructiveHooks.length).to.be.greaterThan(0, 'Should have at least one destructive hook')
      for (const hook of destructiveHooks) {
        expect(hook.mode).to.equal('confirm', `Expected confirm for destructive action ${hook.event}→${hook.action}`)
      }
    })
  })

  // ===========================================================================
  // Consistency
  // ===========================================================================

  describe('consistency', () => {
    it('all presets should have the same number of hooks', () => {
      const counts = PRESET_NAMES.map(name => getPreset(name).hooks.length)
      expect(new Set(counts).size).to.equal(1, 'All presets should have the same hook count')
    })

    it('all presets should cover the same events', () => {
      const eventSets = PRESET_NAMES.map(name =>
        new Set(getPreset(name).hooks.map(h => `${h.event}:${h.action}`))
      )
      const first = eventSets[0]
      for (let i = 1; i < eventSets.length; i++) {
        expect([...first]).to.have.members([...eventSets[i]], `Preset ${PRESET_NAMES[i]} has different events than ${PRESET_NAMES[0]}`)
      }
    })
  })

  // ===========================================================================
  // Preset Invariants (PRLT-1223)
  // ===========================================================================

  describe('invariants', () => {
    it('code-modifying spawn actions MUST NOT be auto in supervised mode', () => {
      // Actions that spawn code-modifying agents: spawn-agent, respawn, spawn-fix-agent, resolve-conflict
      // These actions internally call `prlt work start` with code-modifying actions and MUST require confirmation.
      // Exception: spawn-review-agent is safe (review agents are read-only, non-destructive).
      const unsafeSpawnActions = new Set(['spawn-agent', 'respawn', 'spawn-fix-agent', 'resolve-conflict'])
      const supervised = getPreset('supervised')

      for (const hook of supervised.hooks) {
        if (unsafeSpawnActions.has(hook.action)) {
          expect(hook.mode).to.equal(
            'confirm',
            `Action "${hook.action}" (event: ${hook.event}) calls prlt work start — must be confirm mode in supervised preset, not ${hook.mode}`
          )
        }
      }
    })

    it('spawn-review-agent SHOULD be auto in supervised mode (non-destructive)', () => {
      const supervised = getPreset('supervised')
      const reviewHooks = supervised.hooks.filter(h => h.action === 'spawn-review-agent')

      expect(reviewHooks.length).to.be.greaterThan(0, 'Should have at least one spawn-review-agent hook')
      for (const hook of reviewHooks) {
        expect(hook.mode).to.equal('auto', 'spawn-review-agent should be auto in supervised mode (review is read-only)')
      }
    })

    it('merge-pr MUST NOT be auto in supervised mode', () => {
      // merge-pr is destructive (merges code) and should require confirmation
      const supervised = getPreset('supervised')
      const mergeHooks = supervised.hooks.filter(h => h.action === 'merge-pr')

      expect(mergeHooks.length).to.be.greaterThan(0, 'Should have at least one merge-pr hook')
      for (const hook of mergeHooks) {
        expect(hook.mode).to.equal('confirm', `merge-pr should be confirm mode in supervised preset`)
      }
    })

    it('all hook events should map to real hookable event names', () => {
      const hookableSet = new Set(HOOKABLE_EVENTS)

      for (const name of PRESET_NAMES) {
        const preset = getPreset(name)
        for (const hook of preset.hooks) {
          expect(hookableSet.has(hook.event as any)).to.be.true,
            `Preset "${name}" hook event "${hook.event}" is not a valid HookableEvent`
        }
      }
    })

    it('all hook events should map to real EventBus RuntimeEventName entries', () => {
      // ORCHESTRATE_EVENTS covers all OrchestrateEvent names in the type system
      const validEvents = new Set(ORCHESTRATE_EVENTS)

      for (const name of PRESET_NAMES) {
        const preset = getPreset(name)
        for (const hook of preset.hooks) {
          expect(validEvents.has(hook.event)).to.be.true,
            `Preset "${name}" hook event "${hook.event}" is not in ORCHESTRATE_EVENTS`
        }
      }
    })

    it('all preset actions should reference real action handlers in ACTION_HANDLERS', () => {
      for (const name of PRESET_NAMES) {
        const preset = getPreset(name)
        for (const hook of preset.hooks) {
          expect(
            ACTION_HANDLERS,
            `Preset "${name}" references action "${hook.action}" which is not in ACTION_HANDLERS`
          ).to.have.property(hook.action)
        }
      }
    })

    it('BUILTIN_ACTIONS list should match ACTION_HANDLERS keys', () => {
      const handlerKeys = Object.keys(ACTION_HANDLERS).sort()
      const builtinSorted = [...BUILTIN_ACTIONS].sort()
      expect(handlerKeys).to.deep.equal(builtinSorted)
    })

    it('every BUILTIN_ACTION should appear in at least one preset', () => {
      const presetActions = new Set<string>()
      for (const name of PRESET_NAMES) {
        for (const hook of getPreset(name).hooks) {
          presetActions.add(hook.action)
        }
      }

      for (const action of BUILTIN_ACTIONS) {
        expect(presetActions.has(action)).to.be.true,
          `Built-in action "${action}" is not used in any preset`
      }
    })
  })
})
