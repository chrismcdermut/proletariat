/**
 * Migration 0023 — Intent-Based Actions
 *
 * Decouples actions from provider-specific state names by renaming
 * from_state/to_state to from_intent/to_intent and migrating existing
 * values to canonical intent names.
 *
 * State name → Intent mapping:
 *   'Backlog'       → 'backlog'
 *   'Todo'          → 'ready'
 *   'In Progress'   → 'started'
 *   'Review'        → 'needs_review'
 *   'Done'          → 'completed'
 *
 * Also seeds workspace_settings.default_executor = 'claude' if not set.
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

/** Map provider state names to canonical intents */
const STATE_TO_INTENT: Record<string, string> = {
  'Backlog': 'backlog',
  'Todo': 'ready',
  'In Progress': 'started',
  'Review': 'needs_review',
  'Done': 'completed',
}

export const intentBasedActions: Migration = {
  id: '0023',
  name: 'intent_based_actions',
  up: (db: Database.Database) => {
    // --- pmo_actions: rename from_state/to_state → from_intent/to_intent ---
    const actionsExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_actions'"
    ).get()
    if (!actionsExists) return

    const actionCols = db.prepare("PRAGMA table_info(pmo_actions)").all() as { name: string }[]
    const actionColNames = new Set(actionCols.map(c => c.name))

    if (actionColNames.has('from_state') && !actionColNames.has('from_intent')) {
      db.exec('ALTER TABLE pmo_actions RENAME COLUMN from_state TO from_intent')
      db.exec('ALTER TABLE pmo_actions RENAME COLUMN to_state TO to_intent')

      // Migrate existing state names to intent names
      for (const [stateName, intentName] of Object.entries(STATE_TO_INTENT)) {
        db.prepare('UPDATE pmo_actions SET from_intent = ? WHERE from_intent = ?').run(intentName, stateName)
        db.prepare('UPDATE pmo_actions SET to_intent = ? WHERE to_intent = ?').run(intentName, stateName)
      }
    }

    // --- pmo_workflow_rules: rename from_state/to_state → from_intent/to_intent ---
    const rulesExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_workflow_rules'"
    ).get()

    if (rulesExists) {
      const ruleCols = db.prepare("PRAGMA table_info(pmo_workflow_rules)").all() as { name: string }[]
      const ruleColNames = new Set(ruleCols.map(c => c.name))

      if (ruleColNames.has('from_state') && !ruleColNames.has('from_intent')) {
        db.exec('ALTER TABLE pmo_workflow_rules RENAME COLUMN from_state TO from_intent')
        db.exec('ALTER TABLE pmo_workflow_rules RENAME COLUMN to_state TO to_intent')

        // Migrate existing state names to intent names
        for (const [stateName, intentName] of Object.entries(STATE_TO_INTENT)) {
          db.prepare('UPDATE pmo_workflow_rules SET from_intent = ? WHERE from_intent = ?').run(intentName, stateName)
          db.prepare('UPDATE pmo_workflow_rules SET to_intent = ? WHERE to_intent = ?').run(intentName, stateName)
        }
      }
    }

    // --- Seed default_executor into workspace_settings if not set ---
    const settingsExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_settings'"
    ).get()

    if (settingsExists) {
      const existing = db.prepare(
        "SELECT value FROM workspace_settings WHERE key = 'execution.default_executor'"
      ).get()

      if (!existing) {
        db.prepare(
          "INSERT INTO workspace_settings (key, value) VALUES ('execution.default_executor', 'claude')"
        ).run()
      }
    }
  },
}
