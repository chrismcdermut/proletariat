/**
 * Migration 0001 — Baseline
 *
 * Creates all core workspace tables and PMO tables that represent
 * the current schema. Every statement uses CREATE TABLE IF NOT EXISTS
 * so this migration is safe on both new and existing databases.
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'
import { CREATE_TABLES_SQL } from '../workspace-schema.js'
import { PMO_SCHEMA_SQL } from '../../pmo/schema.js'

export const baseline: Migration = {
  id: '0001',
  name: 'baseline',
  up: (db: SqliteDatabase) => {
    db.exec(CREATE_TABLES_SQL)
    db.exec(PMO_SCHEMA_SQL)
  },
}
