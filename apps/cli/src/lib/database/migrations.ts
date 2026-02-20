/**
 * Database Migrations
 *
 * Dedicated module for raw DDL operations that cannot be expressed through Drizzle ORM.
 * All schema creation and migration SQL is isolated here to keep runtime query logic clean.
 */

import Database from 'better-sqlite3';

/**
 * Core workspace table DDL.
 * Uses CREATE TABLE IF NOT EXISTS for safe re-execution on existing databases.
 */
export const CREATE_TABLES_SQL = `
-- Core workspace metadata
CREATE TABLE IF NOT EXISTS workspace (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  type TEXT NOT NULL CHECK (type IN ('hq', 'workspace')),
  workspace_name TEXT NOT NULL,
  has_pmo BOOLEAN DEFAULT FALSE,
  active_theme_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (active_theme_id) REFERENCES agent_themes(id) ON DELETE SET NULL
);

-- Repository management
CREATE TABLE IF NOT EXISTS repositories (
  name TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  type TEXT DEFAULT 'main' CHECK (type IN ('main', 'dependency')),
  source_url TEXT,
  action TEXT CHECK (action IN ('clone', 'move', 'link')),
  added_at TEXT NOT NULL
);

-- Agent naming themes (optional)
CREATE TABLE IF NOT EXISTS agent_themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  builtin BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL
);

-- Names available within each theme
CREATE TABLE IF NOT EXISTS agent_theme_names (
  theme_id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (theme_id, name),
  FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE CASCADE
);

-- Agent instances in workspace
CREATE TABLE IF NOT EXISTS agents (
  name TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'persistent' CHECK (type IN ('persistent', 'ephemeral')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cleaned')),
  base_name TEXT,
  theme_id TEXT,
  worktree_path TEXT,
  mount_mode TEXT NOT NULL DEFAULT 'worktree' CHECK (mount_mode IN ('worktree', 'clone')),
  created_at TEXT NOT NULL,
  cleaned_at TEXT,
  FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE SET NULL
);

-- Agent-owned worktrees
CREATE TABLE IF NOT EXISTS agent_worktrees (
  agent_name TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  branch TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_commit_hash TEXT,
  commits_ahead INTEGER NOT NULL DEFAULT 0,
  is_clean INTEGER NOT NULL DEFAULT 1,
  last_checked TEXT,
  PRIMARY KEY (agent_name, repo_name),
  FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE,
  FOREIGN KEY (repo_name) REFERENCES repositories(name) ON DELETE CASCADE
);

-- Workspace-level settings (key-value store)
CREATE TABLE IF NOT EXISTS workspace_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_worktrees_agent ON agent_worktrees(agent_name);
CREATE INDEX IF NOT EXISTS idx_worktrees_repo ON agent_worktrees(repo_name);
CREATE INDEX IF NOT EXISTS idx_theme_names_theme ON agent_theme_names(theme_id);
CREATE INDEX IF NOT EXISTS idx_agents_theme ON agents(theme_id);
`;

/**
 * Ensure theme tables exist (for databases created before themes were added).
 */
export function migrateEnsureThemeTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT,
      builtin BOOLEAN DEFAULT FALSE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_theme_names (
      theme_id TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (theme_id, name),
      FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_theme_names_theme ON agent_theme_names(theme_id);
    CREATE INDEX IF NOT EXISTS idx_agents_theme ON agents(theme_id);
  `);
}

/**
 * Migration: drop 'used' column from agent_theme_names if it exists.
 * SQLite doesn't support DROP COLUMN directly, so we recreate the table.
 */
export function migrateDropUsedColumn(db: Database.Database): void {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(agent_theme_names)").all() as { name: string }[];
    if (tableInfo.some(col => col.name === 'used')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_theme_names_new (
          theme_id TEXT NOT NULL,
          name TEXT NOT NULL,
          PRIMARY KEY (theme_id, name),
          FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE CASCADE
        );
        INSERT OR IGNORE INTO agent_theme_names_new (theme_id, name)
          SELECT theme_id, name FROM agent_theme_names;
        DROP TABLE agent_theme_names;
        ALTER TABLE agent_theme_names_new RENAME TO agent_theme_names;
        CREATE INDEX IF NOT EXISTS idx_theme_names_theme ON agent_theme_names(theme_id);
      `);
    }
  } catch {
    // Ignore migration errors - table might not exist yet
  }
}

/**
 * Migration: add missing worktree status columns (TKT-1014).
 */
export function migrateAddWorktreeColumns(db: Database.Database): void {
  try {
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_worktrees'").get();
    if (tableExists) {
      const tableInfo = db.prepare("PRAGMA table_info(agent_worktrees)").all() as { name: string }[];
      if (!tableInfo.some(col => col.name === 'commits_ahead')) {
        db.exec("ALTER TABLE agent_worktrees ADD COLUMN last_commit_hash TEXT");
        db.exec("ALTER TABLE agent_worktrees ADD COLUMN commits_ahead INTEGER NOT NULL DEFAULT 0");
        db.exec("ALTER TABLE agent_worktrees ADD COLUMN is_clean INTEGER NOT NULL DEFAULT 1");
        db.exec("ALTER TABLE agent_worktrees ADD COLUMN last_checked TEXT");
      }
    }
  } catch {
    // Ignore migration errors - table might not exist yet or columns already exist
  }
}

/**
 * Migration: add mount_mode column to agents table (TKT-686).
 */
export function migrateAddMountMode(db: Database.Database): void {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
    if (!tableInfo.some(col => col.name === 'mount_mode')) {
      db.exec("ALTER TABLE agents ADD COLUMN mount_mode TEXT NOT NULL DEFAULT 'worktree' CHECK (mount_mode IN ('worktree', 'clone'))");
    }
  } catch {
    // Ignore migration errors - table might not exist yet or column already exists
  }
}

/**
 * Migration: add position column to pmo_tickets with backfill (TKT-965).
 */
export function migrateAddTicketPosition(db: Database.Database): void {
  try {
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_tickets'").get();
    if (tableExists) {
      const tableInfo = db.prepare("PRAGMA table_info(pmo_tickets)").all() as { name: string }[];
      if (!tableInfo.some(col => col.name === 'position')) {
        db.exec("ALTER TABLE pmo_tickets ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
        db.exec("CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status_position ON pmo_tickets(status_id, position)");

        // Backfill existing tickets with gapped positions (1000, 2000, ...) per status
        const statuses = db.prepare(
          "SELECT DISTINCT status_id FROM pmo_tickets WHERE status_id IS NOT NULL"
        ).all() as { status_id: string }[];

        const getTicketsForStatus = db.prepare(`
          SELECT id FROM pmo_tickets WHERE status_id = ?
          ORDER BY
            CASE priority
              WHEN 'P0' THEN 0
              WHEN 'P1' THEN 1
              WHEN 'P2' THEN 2
              WHEN 'P3' THEN 3
              ELSE 4
            END,
            created_at ASC
        `);
        const updatePosition = db.prepare("UPDATE pmo_tickets SET position = ? WHERE id = ?");

        const backfill = db.transaction(() => {
          for (const { status_id } of statuses) {
            const tickets = getTicketsForStatus.all(status_id) as { id: string }[];
            tickets.forEach((ticket, idx) => {
              updatePosition.run((idx + 1) * 1000, ticket.id);
            });
          }
        });
        backfill();
      }
    }
  } catch {
    // Ignore migration errors - table might not exist yet
  }
}

/**
 * Run all migrations in order.
 * Each migration is idempotent and safe to re-run.
 */
export function runAllMigrations(db: Database.Database): void {
  migrateEnsureThemeTables(db);
  migrateDropUsedColumn(db);
  migrateAddWorktreeColumns(db);
  migrateAddMountMode(db);
  migrateAddTicketPosition(db);
}
