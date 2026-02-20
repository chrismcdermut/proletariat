import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq, and, or, isNull, asc, desc, sql, like } from 'drizzle-orm';
import { getThemePersistentDir, isEphemeralAgentName } from '../themes.js';
import { PMO_SCHEMA_SQL } from '../pmo/schema.js';
import { createDrizzleConnection, DrizzleDB } from './drizzle.js';
import * as schema from './drizzle-schema.js';
import { CREATE_TABLES_SQL, runAllMigrations } from './migrations.js';

// Re-export CREATE_TABLES_SQL for backward compatibility
export { CREATE_TABLES_SQL };

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
export type MountMode = 'worktree' | 'clone';

export interface Agent {
  name: string;
  type: AgentType;
  status: AgentStatus;
  base_name: string | null;  // Theme name (e.g., "bezos" from "bold-bezos-1")
  theme_id: string | null;
  worktree_path: string | null;  // e.g., "agents/temp/bold-bezos-1"
  mount_mode: MountMode;  // 'worktree' = git worktree (shared .git), 'clone' = independent clone
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

// =============================================================================
// Drizzle row → domain type mappers
// =============================================================================

function dbRowToAgent(row: typeof schema.agents.$inferSelect): Agent {
  return {
    name: row.name,
    type: (row.type || 'persistent') as AgentType,
    status: (row.status || 'active') as AgentStatus,
    base_name: row.baseName,
    theme_id: row.themeId,
    worktree_path: row.worktreePath,
    mount_mode: (row.mountMode || 'worktree') as MountMode,
    created_at: row.createdAt,
    cleaned_at: row.cleanedAt,
  };
}

function dbRowToTheme(row: typeof schema.agentThemes.$inferSelect): AgentTheme {
  return {
    id: row.id,
    name: row.name,
    display_name: row.displayName,
    description: row.description,
    builtin: !!row.builtin,
    created_at: row.createdAt,
  };
}

function dbRowToWorkspaceConfig(row: typeof schema.workspace.$inferSelect): WorkspaceConfig {
  return {
    id: row.id!,
    type: row.type as 'hq' | 'workspace',
    workspace_name: row.workspaceName,
    has_pmo: !!row.hasPmo,
    active_theme_id: row.activeThemeId,
    created_at: row.createdAt,
  };
}

function dbRowToRepository(row: typeof schema.repositories.$inferSelect): Repository {
  return {
    name: row.name,
    path: row.path,
    type: (row.type || 'main') as 'main' | 'dependency',
    source_url: row.sourceUrl ?? undefined,
    action: (row.action ?? undefined) as 'clone' | 'move' | 'link' | undefined,
    added_at: row.addedAt,
  };
}

function dbRowToWorktree(row: typeof schema.agentWorktrees.$inferSelect): AgentWorktree {
  return {
    agent_name: row.agentName,
    repo_name: row.repoName,
    worktree_path: row.worktreePath,
    branch: row.branch,
    created_at: row.createdAt,
    last_commit_hash: row.lastCommitHash ?? undefined,
    commits_ahead: row.commitsAhead ?? 0,
    is_clean: row.isClean ?? true,
    last_checked: row.lastChecked ?? undefined,
  };
}

/**
 * Ensure ephemeral agents are correctly typed based on their worktree path or naming pattern.
 * Uses Drizzle for typed queries where possible; GLOB patterns require raw SQL.
 */
function ensureEphemeralAgentTypes(drizzle: DrizzleDB, rawDb: Database.Database): void {
  // Check if agents table exists (raw DDL introspection — unavoidable)
  const tableExists = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").get();
  if (!tableExists) {
    return;
  }

  // Agents in temp directory should be ephemeral
  drizzle.update(schema.agents)
    .set({ type: 'ephemeral' })
    .where(
      and(
        like(schema.agents.worktreePath, 'agents/temp/%'),
        sql`${schema.agents.type} != 'ephemeral'`
      )
    )
    .run();

  // Detect ephemeral agents by naming pattern: adjective-name-number (e.g., blue-khosla-1)
  // GLOB is SQLite-specific and not available in Drizzle, so use raw sql expression
  drizzle.update(schema.agents)
    .set({ type: 'ephemeral' })
    .where(
      and(
        sql`${schema.agents.type} != 'ephemeral'`,
        sql`${schema.agents.name} GLOB '*-*-[0-9]*'`
      )
    )
    .run();

  // Also detect numberless ephemeral names (e.g., bold-bezos) using isEphemeralAgentName()
  const potentialEphemeral = drizzle.select({ name: schema.agents.name })
    .from(schema.agents)
    .where(
      and(
        sql`${schema.agents.type} != 'ephemeral'`,
        like(schema.agents.name, '%-%'),
        sql`${schema.agents.name} NOT GLOB '*-*-[0-9]*'`
      )
    )
    .all();

  for (const agent of potentialEphemeral) {
    if (isEphemeralAgentName(agent.name)) {
      drizzle.update(schema.agents)
        .set({ type: 'ephemeral' })
        .where(eq(schema.agents.name, agent.name))
        .run();
    }
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
 * Open workspace database connection (raw better-sqlite3).
 * Runs migrations and ensures schema is up-to-date.
 */
export function openWorkspaceDatabase(workspacePath: string): Database.Database {
  const dbPath = getDatabasePath(workspacePath);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}. Run 'prlt init' first.`);
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');  // Wait up to 5 seconds if database is locked

  // Run all DDL migrations (isolated in migrations module)
  runAllMigrations(db);

  // Ensure ephemeral agents are correctly typed (uses Drizzle for typed queries)
  const drizzle = createDrizzleConnection(db);
  ensureEphemeralAgentTypes(drizzle, db);

  return db;
}

/**
 * Open workspace database and return both raw and Drizzle connections.
 * Preferred for new code — provides typed Drizzle queries while keeping raw access for DDL.
 */
export function openDrizzleWorkspaceDatabase(workspacePath: string): { db: Database.Database; drizzle: DrizzleDB } {
  const db = openWorkspaceDatabase(workspacePath);
  const drizzle = createDrizzleConnection(db);
  return { db, drizzle };
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

  // Create core workspace tables (raw DDL — unavoidable for CREATE TABLE IF NOT EXISTS)
  db.exec(CREATE_TABLES_SQL);

  // Create PMO tables (from shared schema)
  db.exec(PMO_SCHEMA_SQL);

  // Insert workspace data using Drizzle
  const drizzle = createDrizzleConnection(db);
  drizzle.insert(schema.workspace).values({
    id: 1,
    type,
    workspaceName,
    hasPmo: hasPMO,
    createdAt: new Date().toISOString(),
  }).run();

  return db;
}

/**
 * Get workspace configuration
 */
export function getWorkspaceConfig(workspacePath: string): WorkspaceConfig | null {
  try {
    const { db, drizzle } = openDrizzleWorkspaceDatabase(workspacePath);
    const row = drizzle.select().from(schema.workspace).limit(1).get();
    db.close();
    return row ? dbRowToWorkspaceConfig(row) : null;
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
  const agentsList = getWorkspaceAgents(workspacePath);
  if (agentsList.length === 0) {
    return null;
  }

  // Check if any agent has a theme_id set
  const themedAgent = agentsList.find(a => a.theme_id);
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
    const matchingAgent = agentsList.find(a => themeNameSet.has(a.name.toLowerCase()));
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
  const { db, drizzle } = openDrizzleWorkspaceDatabase(workspacePath);

  if (themeId) {
    // Validate theme exists
    const theme = drizzle.select({ id: schema.agentThemes.id })
      .from(schema.agentThemes)
      .where(eq(schema.agentThemes.id, themeId))
      .get();
    if (!theme) {
      db.close();
      throw new Error(`Theme "${themeId}" not found`);
    }
  }

  drizzle.update(schema.workspace)
    .set({ activeThemeId: themeId })
    .where(eq(schema.workspace.id, 1))
    .run();
  db.close();
}

/**
 * Add repositories to database
 */
export function addRepositoriesToDatabase(workspacePath: string, repos: { name: string; path: string; source_url?: string; action?: 'clone' | 'move' | 'link' }[]): void {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);

  const insertAll = db.transaction(() => {
    for (const repo of repos) {
      drizzleDb.insert(schema.repositories).values({
        name: repo.name,
        path: repo.path,
        type: 'main',
        sourceUrl: repo.source_url || null,
        action: repo.action || null,
        addedAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: schema.repositories.name,
        set: {
          path: repo.path,
          type: 'main',
          sourceUrl: repo.source_url || null,
          action: repo.action || null,
          addedAt: new Date().toISOString(),
        },
      }).run();
    }
  });

  insertAll();
  db.close();
}

/**
 * Add agents to database (case-insensitive uniqueness)
 */
export function addAgentsToDatabase(workspacePath: string, agentNames: string[], themeId?: string, mountMode: MountMode = 'worktree'): void {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);

  // Get workspace config to determine paths
  const workspaceRow = drizzleDb.select().from(schema.workspace).get();
  if (!workspaceRow) {
    db.close();
    throw new Error('Workspace not found');
  }
  const wsConfig = dbRowToWorkspaceConfig(workspaceRow);

  // Get all repos for this workspace
  const repos = drizzleDb.select({ name: schema.repositories.name })
    .from(schema.repositories)
    .all();

  // Determine the effective theme ID (provided or active theme)
  const effectiveThemeId = themeId || wsConfig.active_theme_id || undefined;
  const persistentDir = getThemePersistentDir(effectiveThemeId);

  const transaction = db.transaction(() => {
    for (const agentName of agentNames) {
      // Skip if agent already exists (case-insensitive check)
      const existing = drizzleDb.select({ name: schema.agents.name })
        .from(schema.agents)
        .where(sql`LOWER(${schema.agents.name}) = LOWER(${agentName})`)
        .get();
      if (existing) {
        continue;
      }

      const now = new Date().toISOString();

      // Determine worktree path for the agent
      const agentWorktreePath = wsConfig.type === 'hq'
        ? `agents/${persistentDir}/${agentName}`
        : agentName;

      // Add agent (persistent type for manually added agents)
      drizzleDb.insert(schema.agents).values({
        name: agentName,
        type: 'persistent',
        baseName: null,
        themeId: effectiveThemeId || null,
        worktreePath: agentWorktreePath,
        mountMode,
        createdAt: now,
      }).onConflictDoUpdate({
        target: schema.agents.name,
        set: {
          type: 'persistent',
          baseName: null,
          themeId: effectiveThemeId || null,
          worktreePath: agentWorktreePath,
          mountMode,
          createdAt: now,
        },
      }).run();

      // Add worktrees for all repos
      for (const repo of repos) {
        const worktreePath = wsConfig.type === 'hq'
          ? `agents/${persistentDir}/${agentName}/${repo.name}`
          : `${agentName}/${repo.name}`;

        drizzleDb.insert(schema.agentWorktrees).values({
          agentName,
          repoName: repo.name,
          worktreePath,
          branch: `agent-${agentName}`,
          createdAt: now,
        }).onConflictDoUpdate({
          target: [schema.agentWorktrees.agentName, schema.agentWorktrees.repoName],
          set: {
            worktreePath,
            branch: `agent-${agentName}`,
            createdAt: now,
          },
        }).run();
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
  themeId?: string,
  mountMode: MountMode = 'worktree'
): Agent {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);

  const now = new Date().toISOString();
  const worktreePath = `agents/temp/${agentName}`;

  drizzleDb.insert(schema.agents).values({
    name: agentName,
    type: 'ephemeral',
    status: 'active',
    baseName,
    themeId: themeId || null,
    worktreePath,
    mountMode,
    createdAt: now,
  }).run();

  const row = drizzleDb.select().from(schema.agents)
    .where(eq(schema.agents.name, agentName))
    .get();

  db.close();

  if (!row) {
    throw new Error(`Failed to insert ephemeral agent "${agentName}"`);
  }

  return dbRowToAgent(row);
}

/**
 * Get all ephemeral agent names from the database
 */
export function getEphemeralAgentNames(workspacePath: string): Set<string> {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);
  const rows = drizzleDb.select({ name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.type, 'ephemeral'))
    .all();
  db.close();
  return new Set(rows.map(a => a.name.toLowerCase()));
}

/**
 * Remove an ephemeral agent from the database
 */
export function removeEphemeralAgent(workspacePath: string, agentName: string): void {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);
  drizzleDb.delete(schema.agents)
    .where(and(eq(schema.agents.name, agentName), eq(schema.agents.type, 'ephemeral')))
    .run();
  db.close();
}

/**
 * Get all agents in workspace
 */
export function getWorkspaceAgents(workspacePath: string, includeCleanedUp: boolean = false): Agent[] {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);

  let rows: (typeof schema.agents.$inferSelect)[];
  if (includeCleanedUp) {
    rows = drizzleDb.select().from(schema.agents)
      .orderBy(asc(schema.agents.createdAt))
      .all();
  } else {
    rows = drizzleDb.select().from(schema.agents)
      .where(or(eq(schema.agents.status, 'active'), isNull(schema.agents.status)))
      .orderBy(asc(schema.agents.createdAt))
      .all();
  }

  db.close();
  return rows.map(dbRowToAgent);
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

  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);
  const rows = drizzleDb.select().from(schema.agents)
    .where(or(eq(schema.agents.status, 'active'), isNull(schema.agents.status)))
    .all();
  db.close();

  // Find agent whose worktree_path matches or contains the relative path
  for (const row of rows) {
    if (row.worktreePath) {
      if (relativePath === row.worktreePath || relativePath.startsWith(row.worktreePath + '/')) {
        return dbRowToAgent(row);
      }
    }
  }

  return null;
}

/**
 * Mark an agent as cleaned up (keeps the record for history)
 */
export function markAgentCleaned(workspacePath: string, agentName: string): void {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);
  const now = new Date().toISOString();
  drizzleDb.update(schema.agents)
    .set({ status: 'cleaned', cleanedAt: now })
    .where(eq(schema.agents.name, agentName))
    .run();
  db.close();
}

/**
 * Sync agents in database with what exists on disk.
 * Marks agents as 'cleaned' if their directory no longer exists.
 * Returns list of agents that were cleaned up.
 */
export function syncAgentsWithDisk(workspacePath: string): string[] {
  const agentsList = getWorkspaceAgents(workspacePath, false); // Only active agents
  const cleanedAgents: string[] = [];

  for (const agent of agentsList) {
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

export interface DiscoverResult {
  discovered: { name: string; type: AgentType; path: string }[];
  cleaned: string[];
}

/**
 * Discover agents on disk that aren't in the database and register them.
 * Also cleans up agents in DB whose directories no longer exist.
 * Returns both discovered and cleaned agents.
 */
export function discoverAgentsOnDisk(workspacePath: string): DiscoverResult {
  const result: DiscoverResult = { discovered: [], cleaned: [] };

  // First, clean up missing agents
  result.cleaned = syncAgentsWithDisk(workspacePath);

  // Get existing ACTIVE agents from DB (case-insensitive lookup)
  const activeAgents = getWorkspaceAgents(workspacePath, false); // Only active agents
  const activeNames = new Set(activeAgents.map(a => a.name.toLowerCase()));

  // Get ALL agents including cleaned (for reactivation)
  const allAgents = getWorkspaceAgents(workspacePath, true);
  const cleanedAgentsMap = new Map(
    allAgents.filter(a => a.status === 'cleaned').map(a => [a.name.toLowerCase(), a])
  );

  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);

  try {
    // Scan staff directory
    const staffDir = path.join(workspacePath, 'agents', 'staff');
    if (fs.existsSync(staffDir)) {
      const staffEntries = fs.readdirSync(staffDir, { withFileTypes: true });
      for (const entry of staffEntries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const nameLower = entry.name.toLowerCase();
          if (!activeNames.has(nameLower)) {
            const worktreePath = `agents/staff/${entry.name}`;
            const now = new Date().toISOString();

            const cleanedAgent = cleanedAgentsMap.get(nameLower);
            if (cleanedAgent) {
              // Reactivate the cleaned agent
              drizzleDb.update(schema.agents)
                .set({ status: 'active', cleanedAt: null, worktreePath })
                .where(sql`LOWER(${schema.agents.name}) = LOWER(${entry.name})`)
                .run();
            } else {
              // Register new agent - discovered agents default to 'worktree' mode
              drizzleDb.insert(schema.agents).values({
                name: entry.name,
                type: 'persistent',
                status: 'active',
                worktreePath,
                mountMode: 'worktree',
                createdAt: now,
              }).run();
            }
            result.discovered.push({ name: entry.name, type: 'persistent', path: worktreePath });
            activeNames.add(nameLower);
          }
        }
      }
    }

    // Scan temp directory
    const tempDir = path.join(workspacePath, 'agents', 'temp');
    if (fs.existsSync(tempDir)) {
      const tempEntries = fs.readdirSync(tempDir, { withFileTypes: true });
      for (const entry of tempEntries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const nameLower = entry.name.toLowerCase();
          if (!activeNames.has(nameLower)) {
            const worktreePath = `agents/temp/${entry.name}`;
            const now = new Date().toISOString();

            const cleanedAgent = cleanedAgentsMap.get(nameLower);
            if (cleanedAgent) {
              // Reactivate the cleaned agent
              drizzleDb.update(schema.agents)
                .set({ status: 'active', cleanedAt: null, worktreePath })
                .where(sql`LOWER(${schema.agents.name}) = LOWER(${entry.name})`)
                .run();
            } else {
              // Register new agent - discovered agents default to 'worktree' mode
              drizzleDb.insert(schema.agents).values({
                name: entry.name,
                type: 'ephemeral',
                status: 'active',
                worktreePath,
                mountMode: 'worktree',
                createdAt: now,
              }).run();
            }
            result.discovered.push({ name: entry.name, type: 'ephemeral', path: worktreePath });
            activeNames.add(nameLower);
          }
        }
      }
    }
  } finally {
    db.close();
  }

  return result;
}

/**
 * Get all repositories in workspace
 */
export function getWorkspaceRepositories(workspacePath: string): Repository[] {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);
  const rows = drizzleDb.select().from(schema.repositories)
    .orderBy(asc(schema.repositories.addedAt))
    .all();
  db.close();
  return rows.map(dbRowToRepository);
}

/**
 * Get worktrees for a specific agent
 */
export function getAgentWorktrees(workspacePath: string, agentName: string): AgentWorktree[] {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);
  const rows = drizzleDb.select().from(schema.agentWorktrees)
    .where(eq(schema.agentWorktrees.agentName, agentName))
    .all();
  db.close();
  return rows.map(dbRowToWorktree);
}


/**
 * Remove agents from database
 */
export function removeAgentsFromDatabase(workspacePath: string, agentNames: string[]): void {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);

  const transaction = db.transaction(() => {
    for (const agentName of agentNames) {
      // Note: agent_worktrees will be deleted automatically due to CASCADE
      drizzleDb.delete(schema.agents)
        .where(eq(schema.agents.name, agentName))
        .run();
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
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);
  const rows = drizzleDb.select().from(schema.agentThemes)
    .orderBy(desc(schema.agentThemes.builtin), asc(schema.agentThemes.name))
    .all();
  db.close();
  return rows.map(dbRowToTheme);
}

/**
 * Get a theme by ID
 */
export function getTheme(workspacePath: string, themeId: string): AgentTheme | null {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);
  const row = drizzleDb.select().from(schema.agentThemes)
    .where(eq(schema.agentThemes.id, themeId))
    .get();
  db.close();
  return row ? dbRowToTheme(row) : null;
}

/**
 * Create a new theme
 */
export function createTheme(
  workspacePath: string,
  theme: { id: string; name: string; displayName: string; description?: string; builtin?: boolean }
): AgentTheme {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);
  const now = new Date().toISOString();

  drizzleDb.insert(schema.agentThemes).values({
    id: theme.id,
    name: theme.name,
    displayName: theme.displayName,
    description: theme.description || null,
    builtin: theme.builtin || false,
    createdAt: now,
  }).run();

  const created = drizzleDb.select().from(schema.agentThemes)
    .where(eq(schema.agentThemes.id, theme.id))
    .get();
  db.close();

  if (!created) {
    throw new Error(`Failed to create theme "${theme.id}"`);
  }
  return dbRowToTheme(created);
}

/**
 * Delete a theme (cannot delete builtin themes)
 */
export function deleteTheme(workspacePath: string, themeId: string): boolean {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);

  // Check if builtin
  const theme = drizzleDb.select({ builtin: schema.agentThemes.builtin })
    .from(schema.agentThemes)
    .where(eq(schema.agentThemes.id, themeId))
    .get();
  if (!theme) {
    db.close();
    return false;
  }
  if (theme.builtin) {
    db.close();
    throw new Error('Cannot delete built-in themes');
  }

  drizzleDb.delete(schema.agentThemes)
    .where(eq(schema.agentThemes.id, themeId))
    .run();
  db.close();
  return true;
}

/**
 * Get names for a theme
 */
export function getThemeNames(workspacePath: string, themeId: string): AgentThemeName[] {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);
  const rows = drizzleDb.select().from(schema.agentThemeNames)
    .where(eq(schema.agentThemeNames.themeId, themeId))
    .orderBy(asc(schema.agentThemeNames.name))
    .all();
  db.close();
  return rows.map(row => ({ theme_id: row.themeId, name: row.name }));
}

/**
 * Get available names for a theme.
 * A name is available if:
 * 1. No staff agent exists in the database with that name (case-insensitive), OR
 * 2. The agent exists but its worktree directory is missing (manually deleted)
 */
export function getAvailableThemeNames(workspacePath: string, themeId: string): string[] {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);

  // Get all theme names
  const names = drizzleDb.select({ name: schema.agentThemeNames.name })
    .from(schema.agentThemeNames)
    .where(eq(schema.agentThemeNames.themeId, themeId))
    .orderBy(asc(schema.agentThemeNames.name))
    .all();

  // Get existing staff agents with their worktree paths (persistent type only)
  const existingAgents = drizzleDb.select({
    name: sql<string>`LOWER(${schema.agents.name})`,
    worktreePath: schema.agents.worktreePath,
  })
    .from(schema.agents)
    .where(
      and(
        eq(schema.agents.type, 'persistent'),
        or(eq(schema.agents.status, 'active'), isNull(schema.agents.status))
      )
    )
    .all();

  db.close();

  // Build a set of names that are truly in use (agent exists AND worktree exists)
  const inUseNames = new Set<string>();
  for (const agent of existingAgents) {
    if (agent.worktreePath) {
      const fullPath = path.join(workspacePath, agent.worktreePath);
      if (fs.existsSync(fullPath)) {
        inUseNames.add(agent.name);
      }
    } else {
      // No worktree path means we can't verify - treat as in use to be safe
      inUseNames.add(agent.name);
    }
  }

  // Filter out names that are truly in use
  return names
    .map(n => n.name)
    .filter(name => !inUseNames.has(name.toLowerCase()));
}

/**
 * Add names to a theme (case-insensitive uniqueness)
 */
export function addThemeNames(workspacePath: string, themeId: string, names: string[]): void {
  const { db, drizzle: drizzleDb } = openDrizzleWorkspaceDatabase(workspacePath);

  const transaction = db.transaction(() => {
    for (const name of names) {
      // Check for existing name (case-insensitive)
      const existing = drizzleDb.select({ name: schema.agentThemeNames.name })
        .from(schema.agentThemeNames)
        .where(
          and(
            eq(schema.agentThemeNames.themeId, themeId),
            sql`LOWER(${schema.agentThemeNames.name}) = LOWER(${name})`
          )
        )
        .get();
      if (existing) {
        continue;
      }
      drizzleDb.insert(schema.agentThemeNames).values({
        themeId,
        name,
      }).run();
    }
  });

  transaction();
  db.close();
}
