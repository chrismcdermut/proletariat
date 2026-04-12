/**
 * Migration 0015 — Intent-Based Actions
 *
 * Renames from_state/to_state to from_intent/to_intent in pmo_actions and
 * pmo_workflow_rules tables. Maps existing provider state names to semantic
 * intent names so actions work across any board layout.
 *
 * State → Intent mapping:
 *   'Backlog'      → 'backlog'
 *   'Todo'         → 'ready'
 *   'In Progress'  → 'started'
 *   'Review'       → 'needs_review'
 *   'Done'         → 'completed'
 *
 * Also makes executor nullable (null inherits workspace default_executor setting).
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

/**
 * Map a provider state name to a semantic intent name.
 */
function stateToIntent(stateName: string): string {
  const map: Record<string, string> = {
    'Backlog': 'backlog',
    'Triage': 'backlog',
    'Todo': 'ready',
    'To Do': 'ready',
    'Ready': 'ready',
    'In Progress': 'started',
    'Working On': 'started',
    'Doing': 'started',
    'Review': 'needs_review',
    'In Review': 'needs_review',
    'Done': 'completed',
    'Complete': 'completed',
    'Closed': 'completed',
    'Canceled': 'completed',
  }
  // Case-insensitive lookup
  const lower = stateName.toLowerCase()
  for (const [key, value] of Object.entries(map)) {
    if (key.toLowerCase() === lower) return value
  }
  // Unknown state — use it as-is (lowercase)
  return stateName.toLowerCase().replace(/\s+/g, '_')
}

export const intentBasedActions: Migration = {
  id: '0015',
  name: 'intent_based_actions',
  up: (db: SqliteDatabase) => {
    // ── pmo_actions ────────────────────────────────────────────────────
    const actionsExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_actions'"
    ).get()
    if (!actionsExists) return

    const actionCols = db.pragma('table_info(pmo_actions)') as Array<{ name: string }>
    const actionColNames = new Set(actionCols.map(c => c.name))

    if (actionColNames.has('from_intent')) {
      // Already migrated
      return
    }

    // Read existing data
    const existingActions = db.prepare('SELECT * FROM pmo_actions').all() as Array<Record<string, unknown>>

    // Create new table
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

    const insert = db.prepare(`
      INSERT INTO pmo_actions_new (id, name, description, prompt, end_prompt, from_intent, to_intent,
        executor, environment, permission_mode, timeout, model, review_gate, network_allowlist,
        modifies_code, is_default, is_builtin, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const action of existingActions) {
      const fromState = action.from_state as string | null
      const toState = action.to_state as string | null
      const fromIntent = fromState ? stateToIntent(fromState) : null
      const toIntent = toState ? stateToIntent(toState) : null

      insert.run(
        action.id,
        action.name,
        action.description,
        action.prompt,
        action.end_prompt,
        fromIntent,
        toIntent,
        action.executor,  // Keep existing executor (may be null after seed update)
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
        action.updated_at,
      )
    }

    db.exec('DROP TABLE pmo_actions')
    db.exec('ALTER TABLE pmo_actions_new RENAME TO pmo_actions')

    // ── pmo_workflow_rules ─────────────────────────────────────────────
    const rulesExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_workflow_rules'"
    ).get()
    if (!rulesExists) return

    const ruleCols = db.pragma('table_info(pmo_workflow_rules)') as Array<{ name: string }>
    const ruleColNames = new Set(ruleCols.map(c => c.name))

    if (ruleColNames.has('from_intent')) {
      // Already migrated
      return
    }

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
      const fromState = rule.from_state as string | null
      const toState = rule.to_state as string
      const fromIntent = fromState ? stateToIntent(fromState) : null
      const toIntent = stateToIntent(toState)

      insertRule.run(
        rule.id,
        fromIntent,
        toIntent,
        rule.action_id,
        rule.trigger,
        rule.enabled,
        rule.created_at,
        rule.updated_at,
      )
    }

    db.exec('DROP TABLE pmo_workflow_rules')
    db.exec('ALTER TABLE pmo_workflow_rules_new RENAME TO pmo_workflow_rules')
  },
}
