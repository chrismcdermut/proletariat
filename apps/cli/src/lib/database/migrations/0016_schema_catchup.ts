/**
 * Migration 0016 — Idempotent Schema Catch-up
 *
 * Brings ANY schema version up to the current state. Safe to run on:
 * - A fresh (empty) database
 * - A database from v0.3.80 or earlier
 * - An already-current database (no-op)
 *
 * Strategy:
 * 1. CREATE TABLE IF NOT EXISTS for every table (no indexes yet)
 * 2. PRAGMA table_info() checks + ALTER TABLE ADD COLUMN for missing columns
 * 3. CREATE INDEX IF NOT EXISTS for all indexes (columns now guaranteed to exist)
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'
import { CREATE_TABLES_SQL } from '../workspace-schema.js'
import { PMO_TABLE_SCHEMAS, PMO_INDEXES } from '../../pmo/schema.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>
  return new Set(rows.map(r => r.name))
}

function hasTable(db: Database.Database, table: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(table) as { name: string } | undefined
  return !!row
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
  cols: Set<string>,
): void {
  if (!cols.has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export const schemaCatchup: Migration = {
  id: '0016',
  name: 'schema_catchup',
  up(db) {
    // =======================================================================
    // 1. Ensure every table exists (CREATE TABLE IF NOT EXISTS — no-op when
    //    the table already exists). Run table creation BEFORE indexes so that
    //    missing columns can be added in step 2.
    // =======================================================================

    // Core workspace tables (includes its own indexes using IF NOT EXISTS,
    // but workspace-schema indexes only reference columns from their own
    // CREATE TABLE, so they're safe to run here).
    db.exec(CREATE_TABLES_SQL)

    // PMO tables — create each individually WITHOUT indexes.
    // PMO_INDEXES reference columns that may not exist yet on old tables.
    for (const sql of Object.values(PMO_TABLE_SCHEMAS)) {
      db.exec(sql)
    }

    // =======================================================================
    // 2. Back-fill missing columns on tables that may predate later changes.
    //    Each block checks table existence first (for truly empty DBs where
    //    step 1 already created the full table, this is a no-op).
    // =======================================================================

    // --- agents ---
    if (hasTable(db, 'agents')) {
      const cols = getColumns(db, 'agents')
      addColumnIfMissing(db, 'agents', 'base_name', 'TEXT', cols)
      addColumnIfMissing(db, 'agents', 'mount_mode', "TEXT NOT NULL DEFAULT 'worktree'", cols)
      addColumnIfMissing(db, 'agents', 'cleaned_at', 'TEXT', cols)
    }

    // --- agent_worktrees ---
    if (hasTable(db, 'agent_worktrees')) {
      const cols = getColumns(db, 'agent_worktrees')
      addColumnIfMissing(db, 'agent_worktrees', 'last_commit_hash', 'TEXT', cols)
      addColumnIfMissing(db, 'agent_worktrees', 'commits_ahead', 'INTEGER NOT NULL DEFAULT 0', cols)
      addColumnIfMissing(db, 'agent_worktrees', 'is_clean', 'INTEGER NOT NULL DEFAULT 1', cols)
      addColumnIfMissing(db, 'agent_worktrees', 'last_checked', 'TEXT', cols)
    }

    // --- pmo_tickets ---
    if (hasTable(db, 'pmo_tickets')) {
      const cols = getColumns(db, 'pmo_tickets')
      addColumnIfMissing(db, 'pmo_tickets', 'status_id', 'TEXT', cols)
      addColumnIfMissing(db, 'pmo_tickets', 'position', 'INTEGER NOT NULL DEFAULT 0', cols)
      addColumnIfMissing(db, 'pmo_tickets', 'epic_id', 'TEXT', cols)
      addColumnIfMissing(db, 'pmo_tickets', 'labels', "TEXT NOT NULL DEFAULT '[]'", cols)
      addColumnIfMissing(db, 'pmo_tickets', 'last_synced_from_spec', 'TIMESTAMP', cols)
      addColumnIfMissing(db, 'pmo_tickets', 'last_synced_from_board', 'TIMESTAMP', cols)
    }

    // --- pmo_actions ---
    if (hasTable(db, 'pmo_actions')) {
      const cols = getColumns(db, 'pmo_actions')
      // Intent-based columns (migration 0023 renames from_state→from_intent, to_state→to_intent)
      // For fresh databases, add the intent columns. For old databases, add state columns
      // (migration 0023 will later rename them).
      if (!cols.has('from_intent') && !cols.has('from_state')) {
        addColumnIfMissing(db, 'pmo_actions', 'from_intent', 'TEXT', cols)
      } else if (!cols.has('from_intent')) {
        addColumnIfMissing(db, 'pmo_actions', 'from_state', 'TEXT', cols)
      }
      if (!cols.has('to_intent') && !cols.has('to_state')) {
        addColumnIfMissing(db, 'pmo_actions', 'to_intent', 'TEXT', cols)
      } else if (!cols.has('to_intent')) {
        addColumnIfMissing(db, 'pmo_actions', 'to_state', 'TEXT', cols)
      }
      addColumnIfMissing(db, 'pmo_actions', 'executor', 'TEXT', cols)
      addColumnIfMissing(db, 'pmo_actions', 'environment', 'TEXT', cols)
      addColumnIfMissing(db, 'pmo_actions', 'permission_mode', 'TEXT', cols)
      addColumnIfMissing(db, 'pmo_actions', 'timeout', 'INTEGER', cols)
      addColumnIfMissing(db, 'pmo_actions', 'model', 'TEXT', cols)
      addColumnIfMissing(db, 'pmo_actions', 'is_default', 'INTEGER NOT NULL DEFAULT 0', cols)
      addColumnIfMissing(db, 'pmo_actions', 'updated_at', 'TIMESTAMP', cols)
      addColumnIfMissing(db, 'pmo_actions', 'review_gate', 'TEXT', cols)
      addColumnIfMissing(db, 'pmo_actions', 'network_allowlist', 'TEXT', cols)
    }

    // --- agent_work ---
    if (hasTable(db, 'agent_work')) {
      const cols = getColumns(db, 'agent_work')
      addColumnIfMissing(db, 'agent_work', 'session_id', 'TEXT', cols)
      addColumnIfMissing(db, 'agent_work', 'host', 'TEXT', cols)
      addColumnIfMissing(db, 'agent_work', 'external_source', 'TEXT', cols)
      addColumnIfMissing(db, 'agent_work', 'external_key', 'TEXT', cols)
      addColumnIfMissing(db, 'agent_work', 'external_id', 'TEXT', cols)
      addColumnIfMissing(db, 'agent_work', 'external_url', 'TEXT', cols)
      addColumnIfMissing(db, 'agent_work', 'cleanup_policy', "TEXT NOT NULL DEFAULT 'on-exit'", cols)
      addColumnIfMissing(db, 'agent_work', 'last_heartbeat', 'TEXT', cols)
      addColumnIfMissing(db, 'agent_work', 'retries', 'INTEGER DEFAULT 0', cols)
      addColumnIfMissing(db, 'agent_work', 'lifecycle_state', "TEXT DEFAULT 'healthy'", cols)
    }

    // --- pmo_work_hooks ---
    if (hasTable(db, 'pmo_work_hooks')) {
      const cols = getColumns(db, 'pmo_work_hooks')
      addColumnIfMissing(db, 'pmo_work_hooks', 'mode', "TEXT DEFAULT 'auto'", cols)
      addColumnIfMissing(db, 'pmo_work_hooks', 'priority', 'INTEGER DEFAULT 0', cols)
      addColumnIfMissing(db, 'pmo_work_hooks', 'project_id', 'TEXT', cols)
      addColumnIfMissing(db, 'pmo_work_hooks', 'source', "TEXT DEFAULT 'cli'", cols)
      addColumnIfMissing(db, 'pmo_work_hooks', 'config', 'TEXT', cols)
    }

    // --- pmo_projects ---
    if (hasTable(db, 'pmo_projects')) {
      const cols = getColumns(db, 'pmo_projects')
      addColumnIfMissing(db, 'pmo_projects', 'phase_id', 'TEXT', cols)
      addColumnIfMissing(db, 'pmo_projects', 'workflow_id', 'TEXT', cols)
      addColumnIfMissing(db, 'pmo_projects', 'is_archived', 'INTEGER NOT NULL DEFAULT 0', cols)
      addColumnIfMissing(db, 'pmo_projects', 'target_date', 'TIMESTAMP', cols)
      addColumnIfMissing(db, 'pmo_projects', 'initiative_id', 'TEXT', cols)
    }

    // --- pmo_epics ---
    if (hasTable(db, 'pmo_epics')) {
      const cols = getColumns(db, 'pmo_epics')
      addColumnIfMissing(db, 'pmo_epics', 'file_path', 'TEXT', cols)
      addColumnIfMissing(db, 'pmo_epics', 'spec_id', 'TEXT', cols)
    }

    // --- containers ---
    if (hasTable(db, 'containers')) {
      const cols = getColumns(db, 'containers')
      addColumnIfMissing(db, 'containers', 'docker_name', 'TEXT', cols)
      addColumnIfMissing(db, 'containers', 'image', 'TEXT', cols)
      addColumnIfMissing(db, 'containers', 'current_execution_id', 'TEXT', cols)
      addColumnIfMissing(db, 'containers', 'last_seen_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP', cols)
    }

    // =======================================================================
    // 3. Create all indexes (now safe — all columns are guaranteed to exist)
    // =======================================================================

    // PMO indexes (covers most tables)
    db.exec(PMO_INDEXES)

    // Migration-added indexes not in PMO_INDEXES
    db.exec('CREATE INDEX IF NOT EXISTS idx_agent_work_lifecycle ON agent_work(lifecycle_state, status)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_priority ON pmo_work_hooks(event, priority)')
  },
}
