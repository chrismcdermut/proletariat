import { expect } from 'chai'
import { PRESETS, getPreset } from '../../src/lib/orchestrate/presets.js'
import { BUILTIN_ACTIONS, PRESET_NAMES, HOOK_MODES } from '../../src/lib/orchestrate/types.js'
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
  'resolve-conflict',
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
})
