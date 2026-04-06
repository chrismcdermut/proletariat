/**
 * Orchestrate Config Loader
 *
 * Loads .proletariat/hooks.yml and .proletariat/workflow.yml files,
 * validates them, and syncs hook configurations into the database.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import yaml from 'js-yaml'
import type Database from 'better-sqlite3'
import { WorkHookStorage } from '../work-lifecycle/hooks/storage.js'
import { type HookableEvent, HOOKABLE_EVENTS } from '../work-lifecycle/hooks/types.js'
import type {
  HooksYaml,
  WorkflowYaml,
  OrchestrateEvent,
  HookMode,
  PresetName,
} from './types.js'
import { ORCHESTRATE_EVENTS, HOOK_MODES } from './types.js'
import { getPreset } from './presets.js'

// =============================================================================
// YAML File Loading
// =============================================================================

/**
 * Load and parse .proletariat/hooks.yml from an HQ path.
 * Returns null if the file doesn't exist.
 */
export function loadHooksYaml(hqPath: string): HooksYaml | null {
  const filePath = path.join(hqPath, '.proletariat', 'hooks.yml')
  if (!fs.existsSync(filePath)) return null

  const content = fs.readFileSync(filePath, 'utf-8')
  const parsed = yaml.load(content) as HooksYaml | null
  return parsed ?? null
}

/**
 * Load and parse .proletariat/workflow.yml from an HQ path.
 * Returns null if the file doesn't exist.
 */
export function loadWorkflowYaml(hqPath: string): WorkflowYaml | null {
  const filePath = path.join(hqPath, '.proletariat', 'workflow.yml')
  if (!fs.existsSync(filePath)) return null

  const content = fs.readFileSync(filePath, 'utf-8')
  const parsed = yaml.load(content) as WorkflowYaml | null
  return parsed ?? null
}

// =============================================================================
// Hook Sync
// =============================================================================

/**
 * Sync hooks from a parsed YAML config into the database.
 * Clears existing YAML-sourced hooks and replaces them.
 */
export function syncHooksFromYaml(db: Database.Database, hooksYaml: HooksYaml): number {
  const storage = new WorkHookStorage(db)
  let count = 0

  // Clear existing YAML-sourced hooks
  try {
    db.exec("DELETE FROM pmo_work_hooks WHERE source = 'yaml'")
  } catch {
    // source column might not exist yet — ignore
  }

  for (const [eventName, entries] of Object.entries(hooksYaml)) {
    if (!Array.isArray(entries)) continue

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry.action) continue

      const mode = entry.mode && HOOK_MODES.includes(entry.mode as HookMode)
        ? entry.mode as HookMode
        : 'auto'

      const hookName = `yaml:${eventName}:${entry.action}:${i}`

      try {
        const hook = storage.create({
          name: hookName,
          event: (eventName as HookableEvent) || 'work:status_changed',
          actionType: 'shell',
          actionValue: entry.action,
          description: `From hooks.yml: ${eventName} → ${entry.action} (${mode})`,
        })

        // Update the mode and source via raw SQL since WorkHookStorage doesn't support these yet
        try {
          db.prepare(
            "UPDATE pmo_work_hooks SET mode = ?, priority = ?, source = 'yaml', config = ? WHERE id = ?"
          ).run(mode, i, entry.max_retries ? JSON.stringify({ max_retries: entry.max_retries }) : null, hook.id)
        } catch {
          // Columns might not exist yet
        }

        count++
      } catch {
        // Skip duplicates
      }
    }
  }

  return count
}

/**
 * Apply a preset to the database, replacing existing preset-sourced hooks.
 */
export function applyPreset(db: Database.Database, presetName: PresetName): number {
  const preset = getPreset(presetName)
  const storage = new WorkHookStorage(db)
  let count = 0

  // Clear existing preset-sourced hooks
  try {
    db.exec("DELETE FROM pmo_work_hooks WHERE source = 'preset'")
  } catch {
    // source column might not exist yet
  }

  for (let i = 0; i < preset.hooks.length; i++) {
    const hook = preset.hooks[i]
    const hookName = `preset:${presetName}:${hook.event}:${hook.action}:${i}`

    try {
      const created = storage.create({
        name: hookName,
        event: mapOrchestrateToHookable(hook.event),
        actionType: 'shell',
        actionValue: `prlt hook fire ${hook.event} --action ${hook.action}`,
        description: `Preset ${presetName}: ${hook.event} → ${hook.action} (${hook.mode})`,
      })

      try {
        db.prepare(
          "UPDATE pmo_work_hooks SET mode = ?, priority = ?, source = 'preset', config = ? WHERE id = ?"
        ).run(hook.mode, i, hook.config ? JSON.stringify(hook.config) : null, created.id)
      } catch {
        // Columns might not exist
      }

      count++
    } catch {
      // Skip duplicates
    }
  }

  return count
}

/**
 * Map orchestrate event to hookable event.
 * All orchestrate events that are valid HookableEvents pass through as-is.
 * Throws if the event has no valid mapping — never silently misroute.
 */
function mapOrchestrateToHookable(event: OrchestrateEvent): HookableEvent {
  const hookableSet = new Set<string>(HOOKABLE_EVENTS)
  if (hookableSet.has(event)) {
    return event as HookableEvent
  }
  throw new Error(`Orchestrate event "${event}" has no valid HookableEvent mapping`)
}

/**
 * Export current hook configuration to YAML format.
 */
export function exportHooksToYaml(db: Database.Database): string {
  const storage = new WorkHookStorage(db)
  const hooks = storage.list()

  const grouped: Record<string, Array<{ action: string; mode: string; config?: Record<string, unknown> }>> = {}

  for (const hook of hooks) {
    const event = hook.event
    if (!grouped[event]) grouped[event] = []

    let mode = 'auto'
    let config: Record<string, unknown> | undefined
    try {
      const row = db.prepare("SELECT mode, config FROM pmo_work_hooks WHERE id = ?").get(hook.id) as { mode?: string; config?: string } | undefined
      if (row?.mode) mode = row.mode
      if (row?.config) config = JSON.parse(row.config) as Record<string, unknown>
    } catch {
      // mode column might not exist
    }

    grouped[event].push({
      action: hook.actionValue,
      mode,
      ...(config ? config : {}),
    })
  }

  return yaml.dump(grouped, { indent: 2, lineWidth: 120 })
}
