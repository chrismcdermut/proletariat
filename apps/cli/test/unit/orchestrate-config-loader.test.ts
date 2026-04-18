import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  loadHooksYaml,
  loadWorkflowYaml,
  syncHooksFromYaml,
  applyPreset,
  exportHooksToYaml,
} from '../../src/lib/orchestrate/config-loader.js'
import Database from 'better-sqlite3'
import { ensureHooksTable, WorkHookStorage } from '../../src/lib/work-lifecycle/hooks/storage.js'
import { PRESETS } from '../../src/lib/orchestrate/presets.js'

/**
 * Unit tests for orchestrate config loader.
 *
 * Tests cover:
 * - YAML file loading and parsing
 * - Hook sync from YAML to database
 * - Preset application
 * - YAML export
 */

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  ensureHooksTable(db)
  try {
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'confirm', 'notify', 'llm', 'human', 'off'))")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN project_id TEXT")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN source TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('yaml', 'cli', 'preset'))")
    db.exec("ALTER TABLE pmo_work_hooks ADD COLUMN config TEXT")
  } catch {
    // Columns may already exist
  }
  return db
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-test-'))
}

describe('Orchestrate Config Loader', () => {
  let db: Database.Database
  let tmpDir: string

  beforeEach(() => {
    db = createTestDb()
    tmpDir = createTempDir()
    fs.mkdirSync(path.join(tmpDir, '.proletariat'), { recursive: true })
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ===========================================================================
  // YAML Loading
  // ===========================================================================

  describe('loadHooksYaml', () => {
    it('should return null when file does not exist', () => {
      const result = loadHooksYaml(tmpDir)
      expect(result).to.be.null
    })

    it('should parse valid hooks.yml', () => {
      const yamlContent = `
on_ci_green:
  - action: merge-pr
    mode: auto
on_ticket_ready:
  - action: spawn-agent
    mode: confirm
`
      fs.writeFileSync(path.join(tmpDir, '.proletariat', 'hooks.yml'), yamlContent)

      const result = loadHooksYaml(tmpDir)
      expect(result).to.not.be.null
      expect(result!.on_ci_green).to.be.an('array').with.length(1)
      expect(result!.on_ci_green[0].action).to.equal('merge-pr')
      expect(result!.on_ci_green[0].mode).to.equal('auto')
      expect(result!.on_ticket_ready).to.be.an('array').with.length(1)
      expect(result!.on_ticket_ready[0].mode).to.equal('confirm')
    })
  })

  describe('loadWorkflowYaml', () => {
    it('should return null when file does not exist', () => {
      const result = loadWorkflowYaml(tmpDir)
      expect(result).to.be.null
    })

    it('should parse valid workflow.yml', () => {
      const yamlContent = `
branches:
  target: main
  strategy: squash
review:
  required: false
  auto_merge_on_green: true
`
      fs.writeFileSync(path.join(tmpDir, '.proletariat', 'workflow.yml'), yamlContent)

      const result = loadWorkflowYaml(tmpDir)
      expect(result).to.not.be.null
      expect(result!.branches!.target).to.equal('main')
      expect(result!.branches!.strategy).to.equal('squash')
      expect(result!.review!.auto_merge_on_green).to.be.true
    })
  })

  // ===========================================================================
  // Hook Sync
  // ===========================================================================

  describe('syncHooksFromYaml', () => {
    it('should sync hooks from YAML to database', () => {
      const hooksYaml = {
        on_ci_green: [
          { action: 'merge-pr', mode: 'auto' as const },
        ],
        on_pr_merged: [
          { action: 'move-ticket', mode: 'auto' as const },
          { action: 'rebase-conflicting-prs', mode: 'auto' as const },
        ],
      }

      const count = syncHooksFromYaml(db, hooksYaml)
      expect(count).to.equal(3)

      const hooks = db.prepare('SELECT * FROM pmo_work_hooks').all() as Array<{ name: string; action_value: string }>
      expect(hooks).to.have.length(3)
    })

    it('should replace existing YAML-sourced hooks on re-sync', () => {
      const first = { on_ci_green: [{ action: 'merge-pr', mode: 'auto' as const }] }
      syncHooksFromYaml(db, first)

      const second = { on_ci_failed: [{ action: 'notify', mode: 'auto' as const }] }
      const count = syncHooksFromYaml(db, second)
      expect(count).to.equal(1)

      // Old YAML hooks should be gone, new ones should be present
      const hooks = db.prepare("SELECT * FROM pmo_work_hooks WHERE source = 'yaml'").all() as Array<{ action_value: string }>
      expect(hooks).to.have.length(1)
      expect(hooks[0].action_value).to.equal('notify')
    })

    it('should skip entries without an action', () => {
      const hooksYaml = {
        on_ci_green: [
          { mode: 'auto' } as any,
          { action: 'notify', mode: 'auto' },
        ],
      }
      const count = syncHooksFromYaml(db, hooksYaml)
      expect(count).to.equal(1)
    })

    it('should default to auto mode for invalid modes', () => {
      const hooksYaml = {
        on_ci_green: [
          { action: 'notify', mode: 'invalid-mode' as any },
        ],
      }
      syncHooksFromYaml(db, hooksYaml)

      const hook = db.prepare("SELECT mode FROM pmo_work_hooks LIMIT 1").get() as { mode: string }
      expect(hook.mode).to.equal('auto')
    })
  })

  // ===========================================================================
  // Preset Application
  // ===========================================================================

  describe('applyPreset', () => {
    it('should apply aggressive preset', () => {
      const count = applyPreset(db, 'aggressive')
      expect(count).to.be.greaterThan(0)

      const hooks = db.prepare("SELECT * FROM pmo_work_hooks WHERE source = 'preset'").all() as Array<{ mode: string }>
      expect(hooks.length).to.equal(count)

      for (const hook of hooks) {
        expect(hook.mode).to.equal('auto')
      }
    })

    it('should apply conservative preset', () => {
      const count = applyPreset(db, 'conservative')
      expect(count).to.be.greaterThan(0)

      const hooks = db.prepare("SELECT * FROM pmo_work_hooks WHERE source = 'preset'").all() as Array<{ mode: string; action_value: string }>
      for (const hook of hooks) {
        // Conservative preset: safe actions are auto (Tier 1), destructive actions are human (Tier 3)
        // action_value is the action name directly (e.g. 'merge-pr', 'poke-orchestrator')
        const SAFE_ACTIONS = new Set(['move-ticket', 'notify', 'cleanup-container', 'health-check', 'rebase-conflicting-prs', 'spawn-review-agent', 'gc-sweep', 'poke-orchestrator'])
        const actionMatch = hook.action_value.match(/--action\s+(\S+)/)
        const actionName = actionMatch ? actionMatch[1] : hook.action_value
        const expectedMode = SAFE_ACTIONS.has(actionName) ? 'auto' : 'human'
        expect(hook.mode).to.equal(expectedMode)
      }
    })

    it('should replace previous preset hooks on re-apply', () => {
      applyPreset(db, 'aggressive')
      const countBefore = (db.prepare("SELECT COUNT(*) as c FROM pmo_work_hooks WHERE source = 'preset'").get() as { c: number }).c

      applyPreset(db, 'conservative')
      const countAfter = (db.prepare("SELECT COUNT(*) as c FROM pmo_work_hooks WHERE source = 'preset'").get() as { c: number }).c

      expect(countAfter).to.equal(countBefore)
    })

    it('should not affect YAML-sourced hooks when applying preset', () => {
      const hooksYaml = { on_ci_green: [{ action: 'merge-pr', mode: 'auto' as const }] }
      syncHooksFromYaml(db, hooksYaml)

      applyPreset(db, 'aggressive')

      const yamlHooks = db.prepare("SELECT * FROM pmo_work_hooks WHERE source = 'yaml'").all()
      expect(yamlHooks).to.have.length(1)
    })
  })

  // ===========================================================================
  // Regression: PRLT-1257 — event mapping must preserve correct event names
  // ===========================================================================

  describe('PRLT-1257: event mapping regression', () => {
    it('should store each preset hook with its correct event name, never work:status_changed fallback', () => {
      applyPreset(db, 'aggressive')

      const hooks = db.prepare("SELECT event, action_type, action_value, name FROM pmo_work_hooks WHERE source = 'preset'")
        .all() as Array<{ event: string; action_type: string; action_value: string; name: string }>

      // No hook should have been silently misrouted to work:status_changed
      // unless the preset actually defines a work:status_changed hook
      const presetEvents = new Set(PRESETS.aggressive.hooks.map(h => h.event))
      const hasWorkStatusChanged = presetEvents.has('work:status_changed')

      for (const hook of hooks) {
        // Preset hooks use action_type='action' or 'poke' (for poke-orchestrator).
        // Extract the original event from the hook name: "preset:<preset>:<event>:<action>:<idx>"
        expect(['action', 'poke']).to.include(hook.action_type,
          `Preset hook "${hook.name}" should use action_type='action' or 'poke', not '${hook.action_type}'`)
        const nameParts = hook.name.split(':')
        const originalEvent = nameParts[2]

        // The stored event MUST match the original event from the preset
        expect(hook.event).to.equal(originalEvent,
          `Hook for event "${originalEvent}" was stored as "${hook.event}" — misrouted!`)
      }

      // Verify we actually have hooks for orchestrate events (not just work:* events)
      const storedEvents = new Set(hooks.map(h => h.event))
      if (!hasWorkStatusChanged) {
        expect(storedEvents.has('work:status_changed')).to.be.false
      }
      expect(storedEvents.has('on_ci_green')).to.be.true
      expect(storedEvents.has('on_pr_opened')).to.be.true
      expect(storedEvents.has('on_ticket_ready')).to.be.true
      expect(storedEvents.has('on_agent_died')).to.be.true
      expect(storedEvents.has('on_agent_completed')).to.be.true
    })

    it('should fire on_ci_green with aggressive preset — hook manager finds hook by correct event', () => {
      applyPreset(db, 'aggressive')
      const storage = new WorkHookStorage(db)

      // Query hooks for on_ci_green event — this is what hook manager does at runtime
      const ciGreenHooks = storage.list({ event: 'on_ci_green' as any })

      // Before the fix, this returned empty because all hooks were stored as work:status_changed
      expect(ciGreenHooks.length).to.be.greaterThan(0)
      expect(ciGreenHooks[0].event).to.equal('on_ci_green')
      expect(ciGreenHooks[0].actionValue).to.include('merge-pr')
    })

    it('should preserve correct event for all preset event types across all presets', () => {
      for (const presetName of ['aggressive', 'conservative', 'supervised'] as const) {
        // Clear and re-apply
        try { db.exec("DELETE FROM pmo_work_hooks WHERE source = 'preset'") } catch { /* */ }
        applyPreset(db, presetName)

        const hooks = db.prepare("SELECT event, action_type, action_value, name FROM pmo_work_hooks WHERE source = 'preset'")
          .all() as Array<{ event: string; action_type: string; action_value: string; name: string }>

        for (const hook of hooks) {
          // Preset hooks use action_type='action' or 'poke'. Extract expected event from hook name.
          expect(['action', 'poke']).to.include(hook.action_type)
          const nameParts = hook.name.split(':')
          const originalEvent = nameParts[2]
          expect(hook.event).to.equal(originalEvent,
            `${presetName} preset: event "${originalEvent}" misrouted to "${hook.event}"`)
        }
      }
    })

    it('should store YAML-synced hooks with their correct event names', () => {
      const hooksYaml = {
        on_ci_green: [{ action: 'merge-pr', mode: 'auto' as const }],
        on_agent_died: [{ action: 'notify', mode: 'auto' as const }],
        on_ticket_ready: [{ action: 'spawn-agent', mode: 'confirm' as const }],
      }
      syncHooksFromYaml(db, hooksYaml)

      const hooks = db.prepare("SELECT event, action_value FROM pmo_work_hooks WHERE source = 'yaml'")
        .all() as Array<{ event: string; action_value: string }>

      expect(hooks).to.have.length(3)

      const eventMap = new Map(hooks.map(h => [h.event, h.action_value]))
      expect(eventMap.has('on_ci_green')).to.be.true
      expect(eventMap.has('on_agent_died')).to.be.true
      expect(eventMap.has('on_ticket_ready')).to.be.true
      // None should be misrouted to work:status_changed
      expect(eventMap.has('work:status_changed')).to.be.false
    })
  })

  // ===========================================================================
  // Export
  // ===========================================================================

  describe('exportHooksToYaml', () => {
    it('should export empty config when no hooks exist', () => {
      const yamlStr = exportHooksToYaml(db)
      expect(yamlStr).to.be.a('string')
      // Should be empty YAML (just {}\n or similar)
      expect(yamlStr.trim()).to.satisfy((s: string) => s === '{}' || s === '')
    })

    it('should export hooks grouped by event', () => {
      applyPreset(db, 'aggressive')
      const yamlStr = exportHooksToYaml(db)
      expect(yamlStr).to.be.a('string')
      expect(yamlStr.length).to.be.greaterThan(10)
      // Should contain at least some event names
      expect(yamlStr).to.include('action')
      expect(yamlStr).to.include('mode')
    })
  })
})
