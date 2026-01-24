import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getThemePersistentDir } from '../themes.js';
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

export type AgentType = 'persistent' | 'ephemeral';
export type AgentStatus = 'active' | 'cleaned';

export interface Agent {
  name: string;
  type: AgentType;
  status: AgentStatus;
  base_name: string | null;  // Theme name (e.g., "bezos" from "bold-bezos-1")
  theme_id: string | null;
  worktree_path: string | null;  // e.g., "agents/temp/bold-bezos-1"
  created_at: string;
  cleaned_at: string | null;  // When the agent was cleaned up
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
  type TEXT NOT NULL DEFAULT 'persistent' CHECK (type IN ('persistent', 'ephemeral')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cleaned')),
  base_name TEXT,
  theme_id TEXT,
  worktree_path TEXT,
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
 * Ensure ephemeral agents are correctly typed based on their worktree path or naming pattern
 */
function ensureEphemeralAgentTypes(db: Database.Database): void {
  // Check if agents table exists
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").get();
  if (!tableExists) {
    return;
  }

  // Agents in temp directory should be ephemeral
  db.exec("UPDATE agents SET type = 'ephemeral' WHERE worktree_path LIKE 'agents/temp/%' AND type != 'ephemeral'");

  // Detect ephemeral agents by naming pattern: adjective-name-number (e.g., blue-khosla-1)
  // Staff agents are single names like 'lecun', 'musk', 'gates'
  db.exec(`
    UPDATE agents SET type = 'ephemeral'
    WHERE type != 'ephemeral'
    AND name GLOB '*-*-[0-9]*'
  `);
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

  // Ensure ephemeral agents are correctly typed
  ensureEphemeralAgentTypes(db);

  // Ensure theme tables exist
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
    INSERT OR REPLACE INTO agents (name, type, base_name, theme_id, worktree_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertWorktree = db.prepare(`
    INSERT OR REPLACE INTO agent_worktrees (agent_name, repo_name, worktree_path, branch, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Get workspace config to determine paths
  const workspace = db.prepare('SELECT * FROM workspace').get() as WorkspaceConfig;

  // Get all repos for this workspace
  const repos = db.prepare('SELECT name FROM repositories').all() as { name: string }[];

  // Determine the effective theme ID (provided or active theme)
  const effectiveThemeId = themeId || workspace.active_theme_id || undefined;
  const persistentDir = getThemePersistentDir(effectiveThemeId);

  const transaction = db.transaction(() => {
    for (const agentName of agentNames) {
      // Skip if agent already exists (case-insensitive check)
      const existing = checkExisting.get(agentName) as { name: string } | undefined;
      if (existing) {
        continue; // Agent already exists with same name (different case)
      }

      const now = new Date().toISOString();

      // Determine worktree path for the agent
      const agentWorktreePath = workspace.type === 'hq'
        ? `agents/${persistentDir}/${agentName}`
        : agentName;

      // Add agent (persistent type for manually added agents)
      insertAgent.run(agentName, 'persistent', null, effectiveThemeId || null, agentWorktreePath, now);

      // Add worktrees for all repos
      for (const repo of repos) {
        const worktreePath = workspace.type === 'hq'
          ? `agents/${persistentDir}/${agentName}/${repo.name}`
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
 * Add an ephemeral agent to the database
 */
export function addEphemeralAgentToDatabase(
  workspacePath: string,
  agentName: string,
  baseName: string,
  themeId?: string
): Agent {
  const db = openWorkspaceDatabase(workspacePath);

  const now = new Date().toISOString();
  const worktreePath = `agents/temp/${agentName}`;

  db.prepare(`
    INSERT INTO agents (name, type, status, base_name, theme_id, worktree_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(agentName, 'ephemeral', 'active', baseName, themeId || null, worktreePath, now);

  const agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(agentName) as {
    name: string;
    type: string;
    status: string;
    base_name: string | null;
    theme_id: string | null;
    worktree_path: string | null;
    created_at: string;
    cleaned_at: string | null;
  };

  db.close();

  return {
    name: agent.name,
    type: agent.type as AgentType,
    status: agent.status as AgentStatus,
    base_name: agent.base_name,
    theme_id: agent.theme_id,
    worktree_path: agent.worktree_path,
    created_at: agent.created_at,
    cleaned_at: agent.cleaned_at,
  };
}

/**
 * Get all ephemeral agent names from the database
 */
export function getEphemeralAgentNames(workspacePath: string): Set<string> {
  const db = openWorkspaceDatabase(workspacePath);
  const agents = db.prepare("SELECT name FROM agents WHERE type = 'ephemeral'").all() as { name: string }[];
  db.close();
  return new Set(agents.map(a => a.name.toLowerCase()));
}

/**
 * Remove an ephemeral agent from the database
 */
export function removeEphemeralAgent(workspacePath: string, agentName: string): void {
  const db = openWorkspaceDatabase(workspacePath);
  db.prepare("DELETE FROM agents WHERE name = ? AND type = 'ephemeral'").run(agentName);
  db.close();
}

/**
 * Get all agents in workspace
 */
export function getWorkspaceAgents(workspacePath: string, includeCleanedUp: boolean = false): Agent[] {
  const db = openWorkspaceDatabase(workspacePath);
  const query = includeCleanedUp
    ? 'SELECT * FROM agents ORDER BY created_at'
    : "SELECT * FROM agents WHERE status = 'active' OR status IS NULL ORDER BY created_at";
  const rows = db.prepare(query).all() as Array<{
    name: string;
    type: string | null;
    status: string | null;
    base_name: string | null;
    theme_id: string | null;
    worktree_path: string | null;
    created_at: string;
    cleaned_at: string | null;
  }>;
  db.close();

  // Map rows to Agent type, handling missing columns in old databases
  return rows.map(row => ({
    name: row.name,
    type: (row.type || 'persistent') as AgentType,
    status: (row.status || 'active') as AgentStatus,
    base_name: row.base_name,
    theme_id: row.theme_id,
    worktree_path: row.worktree_path,
    created_at: row.created_at,
    cleaned_at: row.cleaned_at,
  }));
}

/**
 * Get an agent by directory path.
 * Looks up agent where the given absolute path is inside the agent's worktree.
 * Returns null if no matching agent found.
 */
export function getAgentByPath(workspacePath: string, absolutePath: string): Agent | null {
  // Normalize paths
  const normalizedWorkspace = path.resolve(workspacePath);
  const normalizedPath = path.resolve(absolutePath);

  // Path must be inside workspace
  if (!normalizedPath.startsWith(normalizedWorkspace)) {
    return null;
  }

  // Get relative path from workspace root
  const relativePath = path.relative(normalizedWorkspace, normalizedPath);

  const db = openWorkspaceDatabase(workspacePath);
  const agents = db.prepare(
    "SELECT * FROM agents WHERE status = 'active' OR status IS NULL"
  ).all() as Array<{
    name: string;
    type: string | null;
    status: string | null;
    base_name: string | null;
    theme_id: string | null;
    worktree_path: string | null;
    created_at: string;
    cleaned_at: string | null;
  }>;
  db.close();

  // Find agent whose worktree_path matches or contains the relative path
  for (const row of agents) {
    if (row.worktree_path) {
      // Check if relativePath starts with or equals the agent's worktree_path
      if (relativePath === row.worktree_path || relativePath.startsWith(row.worktree_path + '/')) {
        return {
          name: row.name,
          type: (row.type || 'persistent') as AgentType,
          status: (row.status || 'active') as AgentStatus,
          base_name: row.base_name,
          theme_id: row.theme_id,
          worktree_path: row.worktree_path,
          created_at: row.created_at,
          cleaned_at: row.cleaned_at,
        };
      }
    }
  }

  return null;
}

/**
 * Mark an agent as cleaned up (keeps the record for history)
 */
export function markAgentCleaned(workspacePath: string, agentName: string): void {
  const db = openWorkspaceDatabase(workspacePath);
  const now = new Date().toISOString();
  db.prepare("UPDATE agents SET status = 'cleaned', cleaned_at = ? WHERE name = ?").run(now, agentName);
  db.close();
}

/**
 * Sync agents in database with what exists on disk.
 * Marks agents as 'cleaned' if their directory no longer exists.
 * Returns list of agents that were cleaned up.
 */
export function syncAgentsWithDisk(workspacePath: string): string[] {
  const agents = getWorkspaceAgents(workspacePath, false); // Only active agents
  const cleanedAgents: string[] = [];

  for (const agent of agents) {
    // Determine expected directory path
    let agentDir: string;
    if (agent.worktree_path) {
      agentDir = path.join(workspacePath, agent.worktree_path);
    } else if (agent.type === 'ephemeral') {
      agentDir = path.join(workspacePath, 'agents', 'temp', agent.name);
    } else {
      agentDir = path.join(workspacePath, 'agents', 'staff', agent.name);
    }

    // If directory doesn't exist, mark agent as cleaned
    if (!fs.existsSync(agentDir)) {
      markAgentCleaned(workspacePath, agent.name);
      cleanedAgents.push(agent.name);
    }
  }

  return cleanedAgents;
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