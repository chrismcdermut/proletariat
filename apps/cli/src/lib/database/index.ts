import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { THEMES } from '../themes.js';

export interface WorkspaceConfig {
  id: number;
  type: 'hq' | 'workspace';
  theme: string;
  workspace_name: string;
  has_pmo: boolean;
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
  theme: string;
  status: 'working' | 'idle' | 'offline';
  current_task?: string;
  created_at: string;
  last_activity?: string;
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
  theme TEXT NOT NULL,
  workspace_name TEXT NOT NULL,
  has_pmo BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL
);

-- Theme definitions with agent list as JSON array
CREATE TABLE IF NOT EXISTS themes (
  name TEXT PRIMARY KEY,
  workspace_dir TEXT NOT NULL,
  add_command TEXT NOT NULL,
  remove_command TEXT NOT NULL,
  agents JSON NOT NULL
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

-- Agent instances in workspace
CREATE TABLE IF NOT EXISTS agents (
  name TEXT PRIMARY KEY,
  theme TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('working', 'idle', 'offline')),
  current_task TEXT,
  created_at TEXT NOT NULL,
  last_activity TEXT,
  FOREIGN KEY (theme) REFERENCES themes(name)
);

-- Agent-owned worktrees
CREATE TABLE IF NOT EXISTS agent_worktrees (
  agent_name TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  branch TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_commit_hash TEXT,
  commits_ahead INTEGER DEFAULT 0,
  is_clean BOOLEAN DEFAULT TRUE,
  last_checked TEXT,
  PRIMARY KEY (agent_name, repo_name),
  FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE,
  FOREIGN KEY (repo_name) REFERENCES repositories(name) ON DELETE CASCADE
);

-- =============================================================================
-- PMO (Project Management Office) Tables
-- =============================================================================

-- Projects (replaces pmo_board for multi-project support)
CREATE TABLE IF NOT EXISTS pmo_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template TEXT,
  description TEXT,
  initiative_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Initiatives (optional OKR-level grouping)
CREATE TABLE IF NOT EXISTS pmo_initiatives (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  objective TEXT,
  key_results TEXT,  -- JSON array
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Columns (kanban lanes) - now per-project
CREATE TABLE IF NOT EXISTS pmo_columns (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, id)
);

-- Tickets (kanban cards) - now per-project
CREATE TABLE IF NOT EXISTS pmo_tickets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  column_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  priority TEXT,
  category TEXT,
  description TEXT,
  epic_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id, column_id) REFERENCES pmo_columns(project_id, id) ON DELETE CASCADE
);

-- Epics (optional grouping within a project)
CREATE TABLE IF NOT EXISTS pmo_epics (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
);

-- Subtasks
CREATE TABLE IF NOT EXISTS pmo_subtasks (
  id TEXT NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  position INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, id)
);

-- Custom metadata fields for tickets
CREATE TABLE IF NOT EXISTS pmo_ticket_metadata (
  ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (ticket_id, key)
);

-- Specs (specification documents)
CREATE TABLE IF NOT EXISTS pmo_specs (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ticket-Spec relationship (many-to-many)
CREATE TABLE IF NOT EXISTS pmo_ticket_specs (
  ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
  spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, spec_id)
);

-- Agent-Ticket assignments (many-to-many)
CREATE TABLE IF NOT EXISTS pmo_ticket_assignments (
  ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL REFERENCES agents(name) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticket_id, agent_name)
);

-- Cache metadata (for board.md sync)
CREATE TABLE IF NOT EXISTS pmo_cache_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- Agent indexes
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_theme ON agents(theme);
CREATE INDEX IF NOT EXISTS idx_worktrees_agent ON agent_worktrees(agent_name);
CREATE INDEX IF NOT EXISTS idx_worktrees_repo ON agent_worktrees(repo_name);

-- PMO indexes
CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
CREATE INDEX IF NOT EXISTS idx_pmo_tickets_column ON pmo_tickets(column_id);
CREATE INDEX IF NOT EXISTS idx_pmo_tickets_priority ON pmo_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_pmo_tickets_category ON pmo_tickets(category);
CREATE INDEX IF NOT EXISTS idx_pmo_tickets_epic ON pmo_tickets(epic_id);
CREATE INDEX IF NOT EXISTS idx_pmo_subtasks_ticket ON pmo_subtasks(ticket_id);
CREATE INDEX IF NOT EXISTS idx_pmo_ticket_specs_spec ON pmo_ticket_specs(spec_id);
CREATE INDEX IF NOT EXISTS idx_pmo_assignments_agent ON pmo_ticket_assignments(agent_name);
CREATE INDEX IF NOT EXISTS idx_pmo_epics_project ON pmo_epics(project_id);
CREATE INDEX IF NOT EXISTS idx_pmo_projects_initiative ON pmo_projects(initiative_id);
`;

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
  
  return new Database(dbPath);
}

/**
 * Create and initialize workspace database
 */
export function createWorkspaceDatabase(
  workspacePath: string, 
  type: 'hq' | 'workspace',
  theme: string,
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
  
  // Create all tables
  db.exec(CREATE_TABLES_SQL);
  
  // Insert workspace data (convert boolean to number for SQLite)
  db.prepare(`
    INSERT INTO workspace (id, type, theme, workspace_name, has_pmo, created_at)
    VALUES (1, ?, ?, ?, ?, ?)
  `).run(type, theme, workspaceName, hasPMO ? 1 : 0, new Date().toISOString());
  
  // Insert theme data
  const themeConfig = THEMES[theme];
  if (!themeConfig) {
    throw new Error(`Unknown theme: ${theme}`);
  }
  
  db.prepare(`
    INSERT OR REPLACE INTO themes (name, workspace_dir, add_command, remove_command, agents)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    theme,
    themeConfig.workspaceDir,
    themeConfig.commands.add,
    themeConfig.commands.remove,
    JSON.stringify(themeConfig.agents)
  );
  
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
 * Add agents to database
 */
export function addAgentsToDatabase(workspacePath: string, agentNames: string[], theme: string): void {
  const db = openWorkspaceDatabase(workspacePath);
  
  const insertAgent = db.prepare(`
    INSERT OR REPLACE INTO agents (name, theme, status, created_at, last_activity)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const insertWorktree = db.prepare(`
    INSERT OR REPLACE INTO agent_worktrees (agent_name, repo_name, worktree_path, branch, created_at, commits_ahead, is_clean)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  // Get workspace config to determine paths
  const workspace = db.prepare('SELECT * FROM workspace').get() as WorkspaceConfig;
  const themeConfig = THEMES[theme];
  
  // Get all repos for this workspace
  const repos = db.prepare('SELECT name FROM repositories').all() as { name: string }[];
  
  const transaction = db.transaction(() => {
    for (const agentName of agentNames) {
      const now = new Date().toISOString();
      
      // Add agent
      insertAgent.run(agentName, theme, 'idle', now, now);
      
      // Add worktrees for all repos
      for (const repo of repos) {
        const worktreePath = workspace.type === 'hq' 
          ? `agents/${themeConfig.workspaceDir}/${agentName}/${repo.name}`
          : `${agentName}/${repo.name}`;
          
        insertWorktree.run(
          agentName,
          repo.name,
          worktreePath,
          `agent-${agentName}`,
          now,
          0,
          1 // true as number
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
 * Get available agents (from theme minus workspace agents)
 */
export function getAvailableAgents(workspacePath: string): string[] {
  const db = openWorkspaceDatabase(workspacePath);
  
  // Get theme agents
  const workspace = db.prepare('SELECT theme FROM workspace').get() as { theme: string };
  const theme = db.prepare('SELECT agents FROM themes WHERE name = ?').get(workspace.theme) as { agents: string };
  const themeAgents: string[] = JSON.parse(theme.agents);
  
  // Get workspace agents
  const workspaceAgents = db.prepare('SELECT name FROM agents').all() as { name: string }[];
  const workspaceAgentNames = workspaceAgents.map(a => a.name);
  
  db.close();
  
  // Return theme agents minus workspace agents
  return themeAgents.filter(agent => !workspaceAgentNames.includes(agent));
}

/**
 * Remove agents from database
 */
export function removeAgentsFromDatabase(workspacePath: string, agentNames: string[]): void {
  const db = openWorkspaceDatabase(workspacePath);
  
  const deleteAgent = db.prepare('DELETE FROM agents WHERE name = ?');
  // Note: agent_worktrees will be deleted automatically due to CASCADE
  
  const transaction = db.transaction(() => {
    for (const agentName of agentNames) {
      deleteAgent.run(agentName);
    }
  });
  
  transaction();
  db.close();
}