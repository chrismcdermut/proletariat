/**
 * Migration 0023 — Intent-Based Actions
 *
 * Decouples actions from provider-specific state names by using intent names instead.
 * This allows the same action definitions to work across different board providers
 * (Linear, Trello, ClickUp, etc.) where column names differ.
 *
 * Changes:
 * - Rename pmo_actions.from_state → from_intent (nullable)
 * - Rename pmo_actions.to_state → to_intent
 * - Map existing state name values to canonical intent names
 * - Add default_executor to workspace_settings
 * - Rename pmo_workflow_rules.from_state → from_intent
 * - Rename pmo_workflow_rules.to_state → to_intent
 *
 * State → Intent mapping:
 *   'Backlog' → 'backlog'
 *   'Todo'    → 'ready'
 *   'In Progress' → 'started'
 *   'Review'  → 'needs_review'
 *   'Done'    → 'completed'
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

/**
 * Map a provider state name to its canonical intent name.
 */
function stateToIntent(state: string | null): string | null {
  if (!state) return null
  const map: Record<string, string> = {
    'Backlog': 'backlog',
    'Todo': 'ready',
    'In Progress': 'started',
    'Review': 'needs_review',
    'Done': 'completed',
    'Canceled': 'canceled',
    'Triage': 'triage',
  }
  return map[state] ?? state.toLowerCase().replace(/\s+/g, '_')
}

export const intentBasedActions: Migration = {
  id: '0023',
  name: 'intent_based_actions',
  up: (db: Database.Database) => {
    // =========================================================================
    // 1. Migrate pmo_actions: from_state → from_intent, to_state → to_intent
    // =========================================================================
    const actionsExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_actions'"
    ).get()
    if (!actionsExists) return

    const actionCols = db.pragma('table_info(pmo_actions)') as Array<{ name: string }>
    const actionColNames = new Set(actionCols.map(c => c.name))

    // Already migrated?
    if (actionColNames.has('from_intent')) return

    // Read existing actions
    const existingActions = db.prepare('SELECT * FROM pmo_actions').all() as Array<Record<string, unknown>>

    // Create new table with intent columns
    db.exec(`
      CREATE TABLE pmo_actions_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        prompt TEXT NOT NULL,
        end_prompt TEXT,
        from_intent TEXT,
        to_intent TEXT,
        executor TEXT CHECK (executor IN ('claude', 'codex', 'opencode', 'custom')),
        environment TEXT CHECK (environment IN ('devcontainer', 'docker', 'host', 'vm')),
        permission_mode TEXT CHECK (permission_mode IN ('full', 'readonly', 'bypassPermissions')),
        timeout INTEGER,
        model TEXT,
        review_gate TEXT CHECK (review_gate IN ('required', 'auto', 'post')),
        network_allowlist TEXT,
        modifies_code INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
      )
    `)

    // Migrate data with intent mapping
    const insert = db.prepare(`
      INSERT INTO pmo_actions_new (id, name, description, prompt, end_prompt, from_intent, to_intent,
        executor, environment, permission_mode, timeout, model, review_gate, network_allowlist,
        modifies_code, is_default, is_builtin, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const action of existingActions) {
      insert.run(
        action.id,
        action.name,
        action.description,
        action.prompt,
        action.end_prompt,
        stateToIntent(action.from_state as string | null),
        stateToIntent(action.to_state as string | null),
        action.executor,
        action.environment,
        action.permission_mode,
        action.timeout,
        action.model,
        action.review_gate,
        action.network_allowlist,
        action.modifies_code,
        action.is_default,
        action.is_builtin,
        action.position,
        action.created_at,
        action.updated_at
      )
    }

    // Swap tables
    db.exec('DROP TABLE pmo_actions')
    db.exec('ALTER TABLE pmo_actions_new RENAME TO pmo_actions')

    // =========================================================================
    // 2. Migrate pmo_workflow_rules: from_state → from_intent, to_state → to_intent
    // =========================================================================
    const rulesExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_workflow_rules'"
    ).get()

    if (rulesExists) {
      const ruleCols = db.pragma('table_info(pmo_workflow_rules)') as Array<{ name: string }>
      const ruleColNames = new Set(ruleCols.map(c => c.name))

      if (!ruleColNames.has('from_intent')) {
        const existingRules = db.prepare('SELECT * FROM pmo_workflow_rules').all() as Array<Record<string, unknown>>

        db.exec(`
          CREATE TABLE pmo_workflow_rules_new (
            id TEXT PRIMARY KEY,
            from_intent TEXT,
            to_intent TEXT NOT NULL,
            action_id TEXT NOT NULL,
            trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'on_enter')),
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP,
            FOREIGN KEY (action_id) REFERENCES pmo_actions(id) ON DELETE CASCADE
          )
        `)

        const insertRule = db.prepare(`
          INSERT INTO pmo_workflow_rules_new (id, from_intent, to_intent, action_id, trigger, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)

        for (const rule of existingRules) {
          insertRule.run(
            rule.id,
            stateToIntent(rule.from_state as string | null),
            stateToIntent(rule.to_state as string),
            rule.action_id,
            rule.trigger,
            rule.enabled,
            rule.created_at,
            rule.updated_at
          )
        }

        db.exec('DROP TABLE pmo_workflow_rules')
        db.exec('ALTER TABLE pmo_workflow_rules_new RENAME TO pmo_workflow_rules')
      }
    }

    // =========================================================================
    // 3. Add default_executor to workspace_settings
    // =========================================================================
    const settingsExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_settings'"
    ).get()

    if (settingsExists) {
      const existing = db.prepare(
        "SELECT key FROM workspace_settings WHERE key = 'execution.default_executor'"
      ).get()
      if (!existing) {
        db.prepare(
          "INSERT INTO workspace_settings (key, value) VALUES ('execution.default_executor', 'claude')"
        ).run()
      }
    }
  },
}
