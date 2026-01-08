import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_AGENTS_DIR } from '../themes.js';
import { PMO_SCHEMA_SQL } from '../pmo/schema.js';

export interface WorkspaceConfig {
  id: number;
  type: 'hq' | 'workspace';
  workspace_name: string;
  has_pmo: boolean;
  active_theme_id: string | null;
  created_at: string;
}

export interface Repository {
  name: string;
  path: string;
  type: 'main' | 'dependency';
  source_url?: string;
  action?: 'clone' | 'move' | 'link';
  added_at: string;
}

export interface Agent {
  name: string;
  theme_id: string | null;
  created_at: string;
}

export interface AgentTheme {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  builtin: boolean;
  created_at: string;
}

export interface AgentThemeName {
  theme_id: string;
  name: string;
  used: boolean;
}

export interface AgentWorktree {
  agent_name: string;
  repo_name: string;
  worktree_path: string;
  branch: string;
  created_at: string;
  last_commit_hash?: string;
  commits_ahead: number;
  is_clean: boolean;
  last_checked?: string;
}

const CREATE_TABLES_SQL = `
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
  used BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (theme_id, name),
  FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE CASCADE
);

-- Agent instances in workspace
CREATE TABLE IF NOT EXISTS agents (
  name TEXT PRIMARY KEY,
  theme_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE SET NULL
);

-- Agent-owned worktrees
CREATE TABLE IF NOT EXISTS agent_worktrees (
  agent_name TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  branch TEXT NOT NULL,
  created_at TEXT NOT NULL,
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
 * Migrate existing database to add theme support
 */
function migrateToThemeSupport(db: Database.Database): void {
  // Check if agents table exists
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").get();
  if (!tableExists) {
    return; // No agents table yet, nothing to migrate
  }

  const agentColumns = db.pragma('table_info(agents)') as Array<{ name: string; notnull: number }>;

  // Check for old 'theme' column (was NOT NULL in old schema)
  const hasOldTheme = agentColumns.some(c => c.name === 'theme');
  const hasThemeId = agentColumns.some(c => c.name === 'theme_id');
  const hasStatus = agentColumns.some(c => c.name === 'status');

  // Need to recreate table if we have old columns (theme, status, etc)
  if (hasOldTheme || hasStatus) {
    // Migrate from old schema to new clean schema
    // Need to disable foreign keys temporarily for table recreation
    db.pragma('foreign_keys = OFF');

    // Drop old indexes first
    db.exec(`
      DROP INDEX IF EXISTS idx_agents_status;
      DROP INDEX IF EXISTS idx_agents_theme;
    `);

    db.exec(`
      -- Create new agents table with correct schema
      CREATE TABLE IF NOT EXISTS agents_new (
        name TEXT PRIMARY KEY,
        theme_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE SET NULL
      );

      -- Copy data from old table (theme column becomes theme_id if it exists)
      INSERT OR IGNORE INTO agents_new (name, theme_id, created_at)
      SELECT name, ${hasThemeId ? 'theme_id' : 'NULL'}, created_at FROM agents;

      -- Drop old table
      DROP TABLE agents;

      -- Rename new table
      ALTER TABLE agents_new RENAME TO agents;

      -- Recreate index
      CREATE INDEX IF NOT EXISTS idx_agents_theme ON agents(theme_id);
    `);

    // Clean up old themes table if it exists (replaced by agent_themes)
    db.exec('DROP TABLE IF EXISTS themes;');

    db.pragma('foreign_keys = ON');
  } else if (!hasThemeId && agentColumns.length > 0) {
    // Just add theme_id column to existing agents table
    db.exec('ALTER TABLE agents ADD COLUMN theme_id TEXT REFERENCES agent_themes(id) ON DELETE SET NULL');
  }

  // Check if active_theme_id column exists in workspace table
  const workspaceColumns = db.pragma('table_info(workspace)') as Array<{ name: string }>;
  const hasActiveThemeId = workspaceColumns.some(c => c.name === 'active_theme_id');

  if (!hasActiveThemeId && workspaceColumns.length > 0) {
    // Add active_theme_id column to existing workspace table
    db.exec('ALTER TABLE workspace ADD COLUMN active_theme_id TEXT REFERENCES agent_themes(id) ON DELETE SET NULL');
  }
}

/**
 * Get the database path for a workspace
 */
export function getDatabasePath(workspacePath: string): string {
  return path.join(workspacePath, '.proletariat', 'workspace.db');
}

/**
 * Get the config path for a workspace
 */
export function getConfigPath(workspacePath: string): string {
  return path.join(workspacePath, '.proletariat', 'config.json');
}

/**
 * Open workspace database connection
 */
export function openWorkspaceDatabase(workspacePath: string): Database.Database {
  const dbPath = getDatabasePath(workspacePath);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}. Run 'prlt init' first.`);
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  // Run migrations for theme support
  migrateToThemeSupport(db);

  // Ensure theme tables exist (for older databases)
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
      used BOOLEAN DEFAULT FALSE,
      PRIMARY KEY (theme_id, name),
      FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_theme_names_theme ON agent_theme_names(theme_id);
    CREATE INDEX IF NOT EXISTS idx_agents_theme ON agents(theme_id);
  `);

  return db;
}

/**
 * Create and initialize workspace database
 */
export function createWorkspaceDatabase(
  workspacePath: string,
  type: 'hq' | 'workspace',
  workspaceName: string,
  hasPMO: boolean = false
): Database.Database {
  const dbPath = getDatabasePath(workspacePath);
  const configPath = getConfigPath(workspacePath);

  // Ensure .proletariat directory exists
  const proletariatDir = path.dirname(dbPath);
  if (!fs.existsSync(proletariatDir)) {
    fs.mkdirSync(proletariatDir, { recursive: true });
  }

  // Create minimal config.json (bootstrap only)
  const bootstrapConfig = {
    version: "1.0.0",
    schemaVersion: 1
  };
  fs.writeFileSync(configPath, JSON.stringify(bootstrapConfig, null, 2));

  // Create and setup SQLite database
  const db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create core workspace tables (agents, repos, etc)
  db.exec(CREATE_TABLES_SQL);

  // Create PMO tables (from shared schema)
  db.exec(PMO_SCHEMA_SQL);

  // Insert workspace data (convert boolean to number for SQLite)
  db.prepare(`
    INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
    VALUES (1, ?, ?, ?, ?)
  `).run(type, workspaceName, hasPMO ? 1 : 0, new Date().toISOString());

  return db;
}

/**
 * Get workspace configuration
 */
export function getWorkspaceConfig(workspacePath: string): WorkspaceConfig | null {
  try {
    const db = openWorkspaceDatabase(workspacePath);
    const config = db.prepare('SELECT * FROM workspace LIMIT 1').get() as WorkspaceConfig | undefined;
    db.close();
    return config || null;
  } catch {
    return null;
  }
}

/**
 * Get the active theme for a workspace
 * Auto-detects theme from existing agents if not explicitly set
 */
export function getActiveTheme(workspacePath: string): AgentTheme | null {
  const config = getWorkspaceConfig(workspacePath);

  // If explicitly set, use that
  if (config?.active_theme_id) {
    return getTheme(workspacePath, config.active_theme_id);
  }

  // Auto-detect from existing agents
  const agents = getWorkspaceAgents(workspacePath);
  if (agents.length === 0) {
    return null;
  }

  // Check if any agent has a theme_id set
  const themedAgent = agents.find(a => a.theme_id);
  if (themedAgent?.theme_id) {
    const theme = getTheme(workspacePath, themedAgent.theme_id);
    if (theme) {
      // Auto-set it for future use
      setActiveTheme(workspacePath, themedAgent.theme_id);
      return theme;
    }
  }

  // Check if agent names match any builtin theme
  const themes = getThemes(workspacePath);
  for (const theme of themes) {
    const themeNames = getThemeNames(workspacePath, theme.id);
    const themeNameSet = new Set(themeNames.map(n => n.name.toLowerCase()));

    // If any existing agent matches this theme's names
    const matchingAgent = agents.find(a => themeNameSet.has(a.name.toLowerCase()));
    if (matchingAgent) {
      // Auto-set it for future use
      setActiveTheme(workspacePath, theme.id);
      return theme;
    }
  }

  return null;
}

/**
 * Set the active theme for a workspace
 */
export function setActiveTheme(workspacePath: string, themeId: string | null): void {
  const db = openWorkspaceDatabase(workspacePath);

  if (themeId) {
    // Validate theme exists
    const theme = db.prepare('SELECT id FROM agent_themes WHERE id = ?').get(themeId);
    if (!theme) {
      db.close();
      throw new Error(`Theme "${themeId}" not found`);
    }
  }

  db.prepare('UPDATE workspace SET active_theme_id = ? WHERE id = 1').run(themeId);
  db.close();
}

/**
 * Add repositories to database
 */
export function addRepositoriesToDatabase(workspacePath: string, repos: { name: string; path: string; source_url?: string; action?: 'clone' | 'move' | 'link' }[]): void {
  const db = openWorkspaceDatabase(workspacePath);
  
  const insertRepo = db.prepare(`
    INSERT OR REPLACE INTO repositories (name, path, type, source_url, action, added_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const transaction = db.transaction(() => {
    for (const repo of repos) {
      insertRepo.run(
        repo.name,
        repo.path,
        'main',
        repo.source_url || null,
        repo.action || null,
        new Date().toISOString()
      );
    }
  });
  
  transaction();
  db.close();
}

/**
 * Add agents to database (case-insensitive uniqueness)
 */
export function addAgentsToDatabase(workspacePath: string, agentNames: string[], themeId?: string): void {
  const db = openWorkspaceDatabase(workspacePath);

  // Check for existing agents (case-insensitive)
  const checkExisting = db.prepare('SELECT name FROM agents WHERE LOWER(name) = LOWER(?)');

  const insertAgent = db.prepare(`
    INSERT OR REPLACE INTO agents (name, theme_id, created_at)
    VALUES (?, ?, ?)
  `);

  const insertWorktree = db.prepare(`
    INSERT OR REPLACE INTO agent_worktrees (agent_name, repo_name, worktree_path, branch, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Get workspace config to determine paths
  const workspace = db.prepare('SELECT * FROM workspace').get() as WorkspaceConfig;

  // Get all repos for this workspace
  const repos = db.prepare('SELECT name FROM repositories').all() as { name: string }[];

  const transaction = db.transaction(() => {
    for (const agentName of agentNames) {
      // Skip if agent already exists (case-insensitive check)
      const existing = checkExisting.get(agentName) as { name: string } | undefined;
      if (existing) {
        continue; // Agent already exists with same name (different case)
      }

      const now = new Date().toISOString();

      // Add agent
      insertAgent.run(agentName, themeId || null, now);

      // Add worktrees for all repos
      for (const repo of repos) {
        const worktreePath = workspace.type === 'hq'
          ? `agents/${DEFAULT_AGENTS_DIR}/${agentName}/${repo.name}`
          : `${agentName}/${repo.name}`;

        insertWorktree.run(
          agentName,
          repo.name,
          worktreePath,
          `agent-${agentName}`,
          now
        );
      }
    }
  });

  transaction();
  db.close();
}

/**
 * Get all agents in workspace
 */
export function getWorkspaceAgents(workspacePath: string): Agent[] {
  const db = openWorkspaceDatabase(workspacePath);
  const agents = db.prepare('SELECT * FROM agents ORDER BY created_at').all() as Agent[];
  db.close();
  return agents;
}

/**
 * Get all repositories in workspace
 */
export function getWorkspaceRepositories(workspacePath: string): Repository[] {
  const db = openWorkspaceDatabase(workspacePath);
  const repos = db.prepare('SELECT * FROM repositories ORDER BY added_at').all() as Repository[];
  db.close();
  return repos;
}

/**
 * Get worktrees for a specific agent
 */
export function getAgentWorktrees(workspacePath: string, agentName: string): AgentWorktree[] {
  const db = openWorkspaceDatabase(workspacePath);
  const worktrees = db.prepare('SELECT * FROM agent_worktrees WHERE agent_name = ?').all(agentName) as AgentWorktree[];
  db.close();
  return worktrees;
}


/**
 * Remove agents from database
 */
export function removeAgentsFromDatabase(workspacePath: string, agentNames: string[]): void {
  const db = openWorkspaceDatabase(workspacePath);

  const getAgent = db.prepare('SELECT theme_id, name FROM agents WHERE name = ?');
  const deleteAgent = db.prepare('DELETE FROM agents WHERE name = ?');
  const clearUsedFlag = db.prepare('UPDATE agent_theme_names SET used = 0 WHERE theme_id = ? AND name = ?');
  // Note: agent_worktrees will be deleted automatically due to CASCADE

  const transaction = db.transaction(() => {
    for (const agentName of agentNames) {
      // Clear used flag if agent came from a theme
      const agent = getAgent.get(agentName) as { theme_id: string | null; name: string } | undefined;
      if (agent?.theme_id) {
        clearUsedFlag.run(agent.theme_id, agentName);
      }
      deleteAgent.run(agentName);
    }
  });

  transaction();
  db.close();
}

// =============================================================================
// Theme CRUD Operations
// =============================================================================

/**
 * Get all themes
 */
export function getThemes(workspacePath: string): AgentTheme[] {
  const db = openWorkspaceDatabase(workspacePath);
  const themes = db.prepare('SELECT * FROM agent_themes ORDER BY builtin DESC, name').all() as AgentTheme[];
  db.close();
  return themes;
}

/**
 * Get a theme by ID
 */
export function getTheme(workspacePath: string, themeId: string): AgentTheme | null {
  const db = openWorkspaceDatabase(workspacePath);
  const theme = db.prepare('SELECT * FROM agent_themes WHERE id = ?').get(themeId) as AgentTheme | undefined;
  db.close();
  return theme || null;
}

/**
 * Create a new theme
 */
export function createTheme(
  workspacePath: string,
  theme: { id: string; name: string; displayName: string; description?: string; builtin?: boolean }
): AgentTheme {
  const db = openWorkspaceDatabase(workspacePath);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO agent_themes (id, name, display_name, description, builtin, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(theme.id, theme.name, theme.displayName, theme.description || null, theme.builtin ? 1 : 0, now);

  const created = db.prepare('SELECT * FROM agent_themes WHERE id = ?').get(theme.id) as AgentTheme;
  db.close();
  return created;
}

/**
 * Delete a theme (cannot delete builtin themes)
 */
export function deleteTheme(workspacePath: string, themeId: string): boolean {
  const db = openWorkspaceDatabase(workspacePath);

  // Check if builtin
  const theme = db.prepare('SELECT builtin FROM agent_themes WHERE id = ?').get(themeId) as { builtin: number } | undefined;
  if (!theme) {
    db.close();
    return false;
  }
  if (theme.builtin) {
    db.close();
    throw new Error('Cannot delete built-in themes');
  }

  db.prepare('DELETE FROM agent_themes WHERE id = ?').run(themeId);
  db.close();
  return true;
}

/**
 * Get names for a theme
 */
export function getThemeNames(workspacePath: string, themeId: string, includeUsed: boolean = true): AgentThemeName[] {
  const db = openWorkspaceDatabase(workspacePath);
  const query = includeUsed
    ? 'SELECT * FROM agent_theme_names WHERE theme_id = ? ORDER BY name'
    : 'SELECT * FROM agent_theme_names WHERE theme_id = ? AND used = 0 ORDER BY name';
  const names = db.prepare(query).all(themeId) as AgentThemeName[];
  db.close();
  return names;
}

/**
 * Get available (unused) names for a theme
 * Also excludes names that match existing agents (case-insensitive)
 */
export function getAvailableThemeNames(workspacePath: string, themeId: string): string[] {
  const db = openWorkspaceDatabase(workspacePath);

  // Get unused theme names
  const names = db.prepare(
    'SELECT name FROM agent_theme_names WHERE theme_id = ? AND used = 0 ORDER BY name'
  ).all(themeId) as { name: string }[];

  // Get existing agent names (lowercase for comparison)
  const existingAgents = db.prepare('SELECT LOWER(name) as name FROM agents').all() as { name: string }[];
  const existingSet = new Set(existingAgents.map(a => a.name));

  db.close();

  // Filter out names that match existing agents
  return names
    .map(n => n.name)
    .filter(name => !existingSet.has(name.toLowerCase()));
}

/**
 * Add names to a theme (case-insensitive uniqueness)
 */
export function addThemeNames(workspacePath: string, themeId: string, names: string[]): void {
  const db = openWorkspaceDatabase(workspacePath);

  // Check for existing name (case-insensitive)
  const checkExisting = db.prepare('SELECT name FROM agent_theme_names WHERE theme_id = ? AND LOWER(name) = LOWER(?)');

  const insertName = db.prepare(`
    INSERT INTO agent_theme_names (theme_id, name, used)
    VALUES (?, ?, 0)
  `);

  const transaction = db.transaction(() => {
    for (const name of names) {
      // Skip if name already exists (case-insensitive)
      const existing = checkExisting.get(themeId, name) as { name: string } | undefined;
      if (existing) {
        continue;
      }
      insertName.run(themeId, name);
    }
  });

  transaction();
  db.close();
}

/**
 * Mark a theme name as used
 */
export function markThemeNameUsed(workspacePath: string, themeId: string, name: string): void {
  const db = openWorkspaceDatabase(workspacePath);
  db.prepare('UPDATE agent_theme_names SET used = 1 WHERE theme_id = ? AND name = ?').run(themeId, name);
  db.close();
}

/**
 * Mark a theme name as available
 */
export function markThemeNameAvailable(workspacePath: string, themeId: string, name: string): void {
  const db = openWorkspaceDatabase(workspacePath);
  db.prepare('UPDATE agent_theme_names SET used = 0 WHERE theme_id = ? AND name = ?').run(themeId, name);
  db.close();
}