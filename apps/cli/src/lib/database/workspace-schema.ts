/**
 * Core workspace table definitions.
 *
 * Extracted so migration files can reference the SQL without
 * creating a circular import through database/index.ts.
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
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'running', 'completed', 'dead', 'cleaned')),
  base_name TEXT,
  theme_id TEXT,
  worktree_path TEXT,
  mount_mode TEXT NOT NULL DEFAULT 'worktree' CHECK (mount_mode IN ('worktree', 'clone')),
  created_at TEXT NOT NULL,
  cleaned_at TEXT,
  FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

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

-- Media items (videos, audio files with preprocessed assets)
CREATE TABLE IF NOT EXISTS media_items (
  name TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  source_path TEXT,
  media_type TEXT NOT NULL DEFAULT 'video' CHECK (media_type IN ('video', 'audio')),
  duration_seconds REAL,
  resolution TEXT,
  frame_count INTEGER NOT NULL DEFAULT 0,
  has_transcript INTEGER NOT NULL DEFAULT 0,
  frame_interval INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'error')),
  error_message TEXT,
  added_at TEXT NOT NULL,
  processed_at TEXT
);

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_worktrees_agent ON agent_worktrees(agent_name);
CREATE INDEX IF NOT EXISTS idx_worktrees_repo ON agent_worktrees(repo_name);
CREATE INDEX IF NOT EXISTS idx_theme_names_theme ON agent_theme_names(theme_id);
CREATE INDEX IF NOT EXISTS idx_agents_theme ON agents(theme_id);
`;
