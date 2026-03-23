/**
 * Migration 0002 — Work Lifecycle Hooks
 *
 * Adds the pmo_work_hooks table for configurable event-driven actions.
 * Hooks fire when work lifecycle events occur (work:started, work:completed, etc.).
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'
import { HOOKS_TABLE_SCHEMA, HOOKS_TABLE_INDEX } from '../../work-lifecycle/hooks/storage.js'

export const workHooks: Migration = {
  id: '0002',
  name: 'work_hooks',
  up: (db: SqliteDatabase) => {
    db.exec(HOOKS_TABLE_SCHEMA)
    db.exec(HOOKS_TABLE_INDEX)
  },
}
