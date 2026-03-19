import Database from 'better-sqlite3';
import { eq, and, or, isNull, sql, asc, desc, like } from 'drizzle-orm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getThemePersistentDir, isEphemeralAgentName } from '../themes.js';
import { throwIfNativeBindingError } from './native-validation.js';
import { runDrizzleMigrations } from './migrator.js';
import { ALL_MIGRATIONS } from './migrations/index.js';
import { createDrizzleConnection, type DrizzleDB } from './drizzle.js';
import {
  workspace as workspaceTable,
  repositories as repositoriesTable,
  agents as agentsTable,
  agentThemes as agentThemesTable,
  agentThemeNames as agentThemeNamesTable,
  agentWorktrees as agentWorktreesTable,
  workspaceSettings as workspaceSettingsTable,
  mediaItems as mediaItemsTable,
} from './drizzle-schema.js';

// Re-export CREATE_TABLES_SQL from its canonical location
export { CREATE_TABLES_SQL } from './workspace-schema.js';

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
// Internal helpers
// =============================================================================

/**
 * Open the workspace database, wrap it with Drizzle, run a function,
 * and close the connection. Handles the open/close lifecycle.
 */
function withDrizzle<T>(workspacePath: string, fn: (ddb: DrizzleDB, sqliteDb: Database.Database) => T): T {
  const sqliteDb = openWorkspaceDatabase(workspacePath);
  const ddb = createDrizzleConnection(sqliteDb);
  try {
    return fn(ddb, sqliteDb);
  } finally {
    sqliteDb.close();
  }
}

/**
 * Map a Drizzle agent row to the Agent interface.
 * Handles default values for backwards compatibility with old databases.
 */
function toAgent(row: {
  name: string;
  type: string | null;
  status: string | null;
  baseName: string | null;
  themeId: string | null;
  worktreePath: string | null;
  mountMode: string | null;
  createdAt: string;
  cleanedAt: string | null;
}): Agent {
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

/**
 * Map a Drizzle theme row to the AgentTheme interface.
 */
function toAgentTheme(row: {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  builtin: boolean | null;
  createdAt: string;
}): AgentTheme {
  return {
    id: row.id,
    name: row.name,
    display_name: row.displayName,
    description: row.description,
    builtin: Boolean(row.builtin),
    created_at: row.createdAt,
  };
}

/**
 * Ensure ephemeral agents are correctly typed based on their worktree path or naming pattern.
 * Uses raw SQL because it relies on SQLite-specific GLOB operator and sqlite_master introspection.
 */
function ensureEphemeralAgentTypes(db: Database.Database): void {
  // Check if agents table exists (sqlite_master introspection — no Drizzle equivalent)
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").get();
  if (!tableExists) {
    return;
  }

  // Agents in temp directory should be ephemeral
  db.exec("UPDATE agents SET type = 'ephemeral' WHERE worktree_path LIKE 'agents/temp/%' AND type != 'ephemeral'");

  // Detect ephemeral agents by naming pattern using SQLite GLOB (no Drizzle equivalent)
  db.exec(`
    UPDATE agents SET type = 'ephemeral'
    WHERE type != 'ephemeral'
    AND name GLOB '*-*-[0-9]*'
  `);

  // Also detect numberless ephemeral names (e.g., bold-bezos) using isEphemeralAgentName()
  const potentialEphemeral = db.prepare(`
    SELECT name FROM agents
    WHERE type != 'ephemeral'
    AND name LIKE '%-%'
    AND name NOT GLOB '*-*-[0-9]*'
  `).all() as { name: string }[];

  const updateStmt = db.prepare("UPDATE agents SET type = 'ephemeral' WHERE name = ?");
  for (const agent of potentialEphemeral) {
    if (isEphemeralAgentName(agent.name)) {
      updateStmt.run(agent.name);
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
 * Open workspace database connection
 */
export function openWorkspaceDatabase(workspacePath: string): Database.Database {
  const dbPath = getDatabasePath(workspacePath);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}. Run 'prlt new' first.`);
  }

  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch (error) {
    throwIfNativeBindingError(error, 'openWorkspaceDatabase');
    throw error;
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');  // Wait up to 5 seconds if database is locked

  // Run Drizzle migrations (creates tracking table, applies pending migrations)
  runDrizzleMigrations(db, ALL_MIGRATIONS);

  // Ensure ephemeral agents are correctly typed (raw SQL — uses SQLite GLOB)
  ensureEphemeralAgentTypes(db);

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
  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch (error) {
    throwIfNativeBindingError(error, 'createWorkspaceDatabase');
    throw error;
  }

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Run all migrations (baseline creates core workspace + PMO tables)
  runDrizzleMigrations(db, ALL_MIGRATIONS);

  // Insert workspace data using Drizzle
  const ddb = createDrizzleConnection(db);
  ddb.insert(workspaceTable).values({
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
    return withDrizzle(workspacePath, (ddb) => {
      const row = ddb.select().from(workspaceTable).limit(1).get();
      if (!row) return null;
      return {
        id: row.id ?? 1,
        type: row.type,
        workspace_name: row.workspaceName,
        has_pmo: Boolean(row.hasPmo),
        active_theme_id: row.activeThemeId,
        created_at: row.createdAt,
      };
    });
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
  const agentList = getWorkspaceAgents(workspacePath);
  if (agentList.length === 0) {
    return null;
  }

  // Check if any agent has a theme_id set
  const themedAgent = agentList.find(a => a.theme_id);
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
    const matchingAgent = agentList.find(a => themeNameSet.has(a.name.toLowerCase()));
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
  withDrizzle(workspacePath, (ddb) => {
    if (themeId) {
      // Validate theme exists
      const theme = ddb.select({ id: agentThemesTable.id })
        .from(agentThemesTable)
        .where(eq(agentThemesTable.id, themeId))
        .get();
      if (!theme) {
        throw new Error(`Theme "${themeId}" not found`);
      }
    }

    ddb.update(workspaceTable)
      .set({ activeThemeId: themeId })
      .where(eq(workspaceTable.id, 1))
      .run();
  });
}

/**
 * Add repositories to database
 */
export function addRepositoriesToDatabase(workspacePath: string, repos: { name: string; path: string; source_url?: string; action?: 'clone' | 'move' | 'link' }[]): void {
  withDrizzle(workspacePath, (ddb) => {
    for (const repo of repos) {
      ddb.insert(repositoriesTable)
        .values({
          name: repo.name,
          path: repo.path,
          type: 'main',
          sourceUrl: repo.source_url || null,
          action: repo.action || null,
          addedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: repositoriesTable.name,
          set: {
            path: repo.path,
            type: 'main',
            sourceUrl: repo.source_url || null,
            action: repo.action || null,
            addedAt: new Date().toISOString(),
          },
        })
        .run();
    }
  });
}

/**
 * Add agents to database (case-insensitive uniqueness)
 */
export function addAgentsToDatabase(workspacePath: string, agentNames: string[], themeId?: string, mountMode: MountMode = 'worktree'): void {
  withDrizzle(workspacePath, (ddb, sqliteDb) => {
    // Get workspace config to determine paths
    const wsRow = ddb.select().from(workspaceTable).get();
    if (!wsRow) throw new Error('No workspace config found');

    // Get all repos for this workspace
    const repos = ddb.select({ name: repositoriesTable.name }).from(repositoriesTable).all();

    // Determine the effective theme ID (provided or active theme)
    const effectiveThemeId = themeId || wsRow.activeThemeId || undefined;
    const persistentDir = getThemePersistentDir(effectiveThemeId);

    const transaction = sqliteDb.transaction(() => {
      for (const agentName of agentNames) {
        // Check for existing agents (case-insensitive) via Drizzle sql
        const existing = ddb.select({ name: agentsTable.name })
          .from(agentsTable)
          .where(sql`LOWER(${agentsTable.name}) = LOWER(${agentName})`)
          .get();
        if (existing) {
          continue; // Agent already exists with same name (different case)
        }

        const now = new Date().toISOString();

        // Determine worktree path for the agent
        const agentWorktreePath = wsRow.type === 'hq'
          ? `agents/${persistentDir}/${agentName}`
          : agentName;

        // Add agent (persistent type for manually added agents)
        ddb.insert(agentsTable).values({
          name: agentName,
          type: 'persistent',
          baseName: null,
          themeId: effectiveThemeId || null,
          worktreePath: agentWorktreePath,
          mountMode,
          createdAt: now,
        }).onConflictDoUpdate({
          target: agentsTable.name,
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
          const worktreePath = wsRow.type === 'hq'
            ? `agents/${persistentDir}/${agentName}/${repo.name}`
            : `${agentName}/${repo.name}`;

          ddb.insert(agentWorktreesTable).values({
            agentName,
            repoName: repo.name,
            worktreePath,
            branch: `agent-${agentName}`,
            createdAt: now,
          }).onConflictDoUpdate({
            target: [agentWorktreesTable.agentName, agentWorktreesTable.repoName],
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
  });
}

/**
 * Add an ephemeral agent to the database.
 * Throws on name collision — use tryAddEphemeralAgentToDatabase for
 * concurrency-safe insertion with conflict detection.
 */
export function addEphemeralAgentToDatabase(
  workspacePath: string,
  agentName: string,
  baseName: string,
  themeId?: string,
  mountMode: MountMode = 'worktree'
): Agent {
  const result = tryAddEphemeralAgentToDatabase(workspacePath, agentName, baseName, themeId, mountMode);
  if (!result) {
    throw new Error(`Agent name "${agentName}" already exists (UNIQUE constraint failed: agents.name)`);
  }
  return result;
}

/**
 * Try to add an ephemeral agent to the database.
 * Returns the Agent on success, or null if the name already exists
 * (SQLITE_CONSTRAINT_PRIMARYKEY). This is concurrency-safe: parallel
 * processes that generate the same name will not crash — the loser
 * simply gets null and can retry with a different name.
 */
export function tryAddEphemeralAgentToDatabase(
  workspacePath: string,
  agentName: string,
  baseName: string,
  themeId?: string,
  mountMode: MountMode = 'worktree'
): Agent | null {
  const sqliteDb = openWorkspaceDatabase(workspacePath);
  const ddb = createDrizzleConnection(sqliteDb);

  try {
    const now = new Date().toISOString();
    const worktreePath = `agents/temp/${agentName}`;

    ddb.insert(agentsTable).values({
      name: agentName,
      type: 'ephemeral',
      status: 'active',
      baseName,
      themeId: themeId || null,
      worktreePath,
      mountMode,
      createdAt: now,
    }).run();

    const agent = ddb.select().from(agentsTable)
      .where(eq(agentsTable.name, agentName))
      .get();

    if (!agent) return null;
    return toAgent(agent);
  } catch (err: unknown) {
    const sqliteErr = err as { code?: string };
    if (sqliteErr.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || sqliteErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return null;
    }
    throw err;
  } finally {
    sqliteDb.close();
  }
}

/**
 * Get all ephemeral agent names from the database
 */
export function getEphemeralAgentNames(workspacePath: string): Set<string> {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select({ name: agentsTable.name })
      .from(agentsTable)
      .where(eq(agentsTable.type, 'ephemeral'))
      .all();
    return new Set(rows.map(a => a.name.toLowerCase()));
  });
}

/**
 * Remove an ephemeral agent from the database
 */
export function removeEphemeralAgent(workspacePath: string, agentName: string): void {
  withDrizzle(workspacePath, (ddb) => {
    ddb.delete(agentsTable)
      .where(and(
        eq(agentsTable.name, agentName),
        eq(agentsTable.type, 'ephemeral'),
      ))
      .run();
  });
}

/**
 * Get all agents in workspace
 */
export function getWorkspaceAgents(workspacePath: string, includeCleanedUp: boolean = false): Agent[] {
  return withDrizzle(workspacePath, (ddb) => {
    let rows;
    if (includeCleanedUp) {
      rows = ddb.select().from(agentsTable)
        .orderBy(asc(agentsTable.createdAt))
        .all();
    } else {
      rows = ddb.select().from(agentsTable)
        .where(or(
          eq(agentsTable.status, 'active'),
          isNull(agentsTable.status),
        ))
        .orderBy(asc(agentsTable.createdAt))
        .all();
    }

    return rows.map(toAgent);
  });
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

  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(agentsTable)
      .where(or(
        eq(agentsTable.status, 'active'),
        isNull(agentsTable.status),
      ))
      .all();

    // Find agent whose worktree_path matches or contains the relative path
    for (const row of rows) {
      if (row.worktreePath) {
        if (relativePath === row.worktreePath || relativePath.startsWith(row.worktreePath + '/')) {
          return toAgent(row);
        }
      }
    }

    return null;
  });
}

/**
 * Mark an agent as cleaned up (keeps the record for history)
 */
export function markAgentCleaned(workspacePath: string, agentName: string): void {
  withDrizzle(workspacePath, (ddb) => {
    ddb.update(agentsTable)
      .set({ status: 'cleaned', cleanedAt: new Date().toISOString() })
      .where(eq(agentsTable.name, agentName))
      .run();
  });
}

/**
 * Sync agents in database with what exists on disk.
 * Marks agents as 'cleaned' if their directory no longer exists.
 * Returns list of agents that were cleaned up.
 */
export function syncAgentsWithDisk(workspacePath: string): string[] {
  const agentList = getWorkspaceAgents(workspacePath, false); // Only active agents
  const cleanedAgents: string[] = [];

  for (const agent of agentList) {
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

  withDrizzle(workspacePath, (ddb) => {
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
              ddb.update(agentsTable)
                .set({ status: 'active', cleanedAt: null, worktreePath })
                .where(sql`LOWER(${agentsTable.name}) = LOWER(${entry.name})`)
                .run();
            } else {
              // Register new agent
              ddb.insert(agentsTable).values({
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
              ddb.update(agentsTable)
                .set({ status: 'active', cleanedAt: null, worktreePath })
                .where(sql`LOWER(${agentsTable.name}) = LOWER(${entry.name})`)
                .run();
            } else {
              // Register new agent
              ddb.insert(agentsTable).values({
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
  });

  return result;
}

/**
 * Get all repositories in workspace
 */
export function getWorkspaceRepositories(workspacePath: string): Repository[] {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(repositoriesTable)
      .orderBy(asc(repositoriesTable.addedAt))
      .all();
    return rows.map(row => ({
      name: row.name,
      path: row.path,
      type: (row.type || 'main') as 'main' | 'dependency',
      source_url: row.sourceUrl ?? undefined,
      action: (row.action ?? undefined) as 'clone' | 'move' | 'link' | undefined,
      added_at: row.addedAt,
    }));
  });
}

/**
 * Get worktrees for a specific agent
 */
export function getAgentWorktrees(workspacePath: string, agentName: string): AgentWorktree[] {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(agentWorktreesTable)
      .where(eq(agentWorktreesTable.agentName, agentName))
      .all();
    return rows.map(row => ({
      agent_name: row.agentName,
      repo_name: row.repoName,
      worktree_path: row.worktreePath,
      branch: row.branch,
      created_at: row.createdAt,
      last_commit_hash: row.lastCommitHash ?? undefined,
      commits_ahead: row.commitsAhead,
      is_clean: Boolean(row.isClean),
      last_checked: row.lastChecked ?? undefined,
    }));
  });
}

/**
 * Find agent worktrees matching a branch pattern (case-insensitive LIKE).
 */
export function findWorktreesByBranch(workspacePath: string, branchPattern: string): AgentWorktree[] {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(agentWorktreesTable)
      .where(like(sql`LOWER(${agentWorktreesTable.branch})`, branchPattern))
      .all();
    return rows.map(row => ({
      agent_name: row.agentName,
      repo_name: row.repoName,
      worktree_path: row.worktreePath,
      branch: row.branch,
      created_at: row.createdAt,
      last_commit_hash: row.lastCommitHash ?? undefined,
      commits_ahead: row.commitsAhead,
      is_clean: Boolean(row.isClean),
      last_checked: row.lastChecked ?? undefined,
    }));
  });
}

/**
 * Get agent worktrees for a specific repository.
 */
export function getWorktreesForRepo(workspacePath: string, repoName: string): Array<{ agent_name: string; is_clean: number; commits_ahead: number; branch: string }> {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select({
      agent_name: agentWorktreesTable.agentName,
      is_clean: sql<number>`${agentWorktreesTable.isClean}`,
      commits_ahead: agentWorktreesTable.commitsAhead,
      branch: agentWorktreesTable.branch,
    }).from(agentWorktreesTable)
      .where(eq(agentWorktreesTable.repoName, repoName))
      .all();
    return rows;
  });
}

/**
 * Upsert a workspace setting (key-value pair).
 */
export function upsertWorkspaceSetting(db: Database.Database, key: string, value: string): void {
  const ddb = createDrizzleConnection(db);
  ddb.insert(workspaceSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: workspaceSettingsTable.key,
      set: { value },
    })
    .run();
}

/**
 * Remove agents from database
 */
export function removeAgentsFromDatabase(workspacePath: string, agentNames: string[]): void {
  withDrizzle(workspacePath, (ddb, sqliteDb) => {
    // Note: agent_worktrees will be deleted automatically due to CASCADE
    const transaction = sqliteDb.transaction(() => {
      for (const agentName of agentNames) {
        ddb.delete(agentsTable)
          .where(eq(agentsTable.name, agentName))
          .run();
      }
    });

    transaction();
  });
}

// =============================================================================
// PMO Bootstrapping Operations
// Raw SQL is required here because these operate before migrations run
// or perform DDL operations that Drizzle doesn't support.
// =============================================================================

/**
 * Check if PMO tables exist and get basic stats.
 * Used by pmo init to detect existing PMO before storage layer is available.
 * Raw SQL: uses sqlite_master introspection (pre-migration bootstrap).
 */
export function checkPMOExists(dbPath: string): { exists: boolean; projectCount: number; ticketCount: number } {
  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch (error) {
    throwIfNativeBindingError(error, 'checkPMOExists');
    throw error;
  }
  try {
    const result = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
    ).get();

    if (result === undefined) {
      return { exists: false, projectCount: 0, ticketCount: 0 };
    }

    const projectCountResult = db.prepare('SELECT COUNT(*) as count FROM pmo_projects').get() as { count: number };
    const ticketCountResult = db.prepare('SELECT COUNT(*) as count FROM pmo_tickets').get() as { count: number };

    return {
      exists: true,
      projectCount: projectCountResult.count,
      ticketCount: ticketCountResult.count,
    };
  } finally {
    db.close();
  }
}

/**
 * Get a PMO setting from the pmo_settings table.
 * Used for bootstrapping queries before storage layer is available.
 * Raw SQL: pre-migration bootstrap query.
 */
export function getPMOSetting(dbPath: string, key: string): string | null {
  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch (error) {
    throwIfNativeBindingError(error, 'getPMOSetting');
    throw error;
  }
  try {
    const result = db.prepare('SELECT value FROM pmo_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return result?.value ?? null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Drop PMO tables from the database.
 * Used during PMO reinitialization.
 * Raw SQL: DDL operations (DROP TABLE) are not supported by Drizzle.
 */
export function dropPMOTables(dbPath: string, tables: string[]): void {
  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch (error) {
    throwIfNativeBindingError(error, 'dropPMOTables');
    throw error;
  }
  try {
    for (const table of tables) {
      try {
        db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
      } catch {
        // Ignore errors - table might not exist
      }
    }
  } finally {
    db.close();
  }
}

// =============================================================================
// Theme CRUD Operations
// =============================================================================

/**
 * Get all themes
 */
export function getThemes(workspacePath: string): AgentTheme[] {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(agentThemesTable)
      .orderBy(desc(agentThemesTable.builtin), asc(agentThemesTable.name))
      .all();
    return rows.map(toAgentTheme);
  });
}

/**
 * Get a theme by ID
 */
export function getTheme(workspacePath: string, themeId: string): AgentTheme | null {
  return withDrizzle(workspacePath, (ddb) => {
    const row = ddb.select().from(agentThemesTable)
      .where(eq(agentThemesTable.id, themeId))
      .get();
    return row ? toAgentTheme(row) : null;
  });
}

/**
 * Create a new theme
 */
export function createTheme(
  workspacePath: string,
  theme: { id: string; name: string; displayName: string; description?: string; builtin?: boolean }
): AgentTheme {
  return withDrizzle(workspacePath, (ddb) => {
    const now = new Date().toISOString();

    ddb.insert(agentThemesTable).values({
      id: theme.id,
      name: theme.name,
      displayName: theme.displayName,
      description: theme.description || null,
      builtin: theme.builtin || false,
      createdAt: now,
    }).run();

    const created = ddb.select().from(agentThemesTable)
      .where(eq(agentThemesTable.id, theme.id))
      .get();
    return toAgentTheme(created!);
  });
}

/**
 * Delete a theme (cannot delete builtin themes)
 */
export function deleteTheme(workspacePath: string, themeId: string): boolean {
  return withDrizzle(workspacePath, (ddb) => {
    const theme = ddb.select({ builtin: agentThemesTable.builtin })
      .from(agentThemesTable)
      .where(eq(agentThemesTable.id, themeId))
      .get();

    if (!theme) {
      return false;
    }
    if (theme.builtin) {
      throw new Error('Cannot delete built-in themes');
    }

    ddb.delete(agentThemesTable)
      .where(eq(agentThemesTable.id, themeId))
      .run();
    return true;
  });
}

/**
 * Get names for a theme
 */
export function getThemeNames(workspacePath: string, themeId: string): AgentThemeName[] {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(agentThemeNamesTable)
      .where(eq(agentThemeNamesTable.themeId, themeId))
      .orderBy(asc(agentThemeNamesTable.name))
      .all();
    return rows.map(row => ({
      theme_id: row.themeId,
      name: row.name,
    }));
  });
}

/**
 * Get available names for a theme.
 * A name is available if:
 * 1. No staff agent exists in the database with that name (case-insensitive), OR
 * 2. The agent exists but its worktree directory is missing (manually deleted)
 */
export function getAvailableThemeNames(workspacePath: string, themeId: string): string[] {
  return withDrizzle(workspacePath, (ddb) => {
    // Get all theme names
    const names = ddb.select({ name: agentThemeNamesTable.name })
      .from(agentThemeNamesTable)
      .where(eq(agentThemeNamesTable.themeId, themeId))
      .orderBy(asc(agentThemeNamesTable.name))
      .all();

    // Get existing staff agents with their worktree paths (persistent type only)
    const existingAgents = ddb.select({
      name: sql<string>`LOWER(${agentsTable.name})`,
      worktreePath: agentsTable.worktreePath,
    })
      .from(agentsTable)
      .where(and(
        eq(agentsTable.type, 'persistent'),
        or(
          eq(agentsTable.status, 'active'),
          isNull(agentsTable.status),
        ),
      ))
      .all();

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
  });
}

/**
 * Add names to a theme (case-insensitive uniqueness)
 */
export function addThemeNames(workspacePath: string, themeId: string, names: string[]): void {
  withDrizzle(workspacePath, (ddb, sqliteDb) => {
    const transaction = sqliteDb.transaction(() => {
      for (const name of names) {
        // Check for existing name (case-insensitive)
        const existing = ddb.select({ name: agentThemeNamesTable.name })
          .from(agentThemeNamesTable)
          .where(and(
            eq(agentThemeNamesTable.themeId, themeId),
            sql`LOWER(${agentThemeNamesTable.name}) = LOWER(${name})`,
          ))
          .get();
        if (existing) {
          continue;
        }
        ddb.insert(agentThemeNamesTable).values({
          themeId,
          name,
        }).run();
      }
    });

    transaction();
  });
}

// =============================================================================
// Media Item Operations (TKT-077)
// =============================================================================

export interface MediaItem {
  name: string;
  path: string;
  source_path: string | null;
  media_type: 'video' | 'audio';
  duration_seconds: number | null;
  resolution: string | null;
  frame_count: number;
  has_transcript: boolean;
  frame_interval: number;
  status: 'pending' | 'processing' | 'ready' | 'error';
  error_message: string | null;
  added_at: string;
  processed_at: string | null;
}

/**
 * Add a media item to the database
 */
export function addMediaItemToDatabase(
  workspacePath: string,
  item: { name: string; path: string; source_path?: string; media_type: 'video' | 'audio'; frame_interval?: number }
): void {
  withDrizzle(workspacePath, (ddb) => {
    const now = new Date().toISOString();
    ddb.insert(mediaItemsTable)
      .values({
        name: item.name,
        path: item.path,
        sourcePath: item.source_path || null,
        mediaType: item.media_type,
        frameInterval: item.frame_interval || 30,
        addedAt: now,
      })
      .onConflictDoUpdate({
        target: mediaItemsTable.name,
        set: {
          path: item.path,
          sourcePath: item.source_path || null,
          mediaType: item.media_type,
          frameInterval: item.frame_interval || 30,
          addedAt: now,
        },
      })
      .run();
  });
}

/**
 * Update media item after preprocessing
 */
export function updateMediaItemStatus(
  workspacePath: string,
  name: string,
  updates: {
    status: 'pending' | 'processing' | 'ready' | 'error';
    duration_seconds?: number;
    resolution?: string;
    frame_count?: number;
    has_transcript?: boolean;
    error_message?: string;
  }
): void {
  withDrizzle(workspacePath, (ddb) => {
    const setValues: Record<string, unknown> = { status: updates.status };

    if (updates.duration_seconds !== undefined) {
      setValues.durationSeconds = updates.duration_seconds;
    }
    if (updates.resolution !== undefined) {
      setValues.resolution = updates.resolution;
    }
    if (updates.frame_count !== undefined) {
      setValues.frameCount = updates.frame_count;
    }
    if (updates.has_transcript !== undefined) {
      setValues.hasTranscript = updates.has_transcript;
    }
    if (updates.error_message !== undefined) {
      setValues.errorMessage = updates.error_message;
    }
    if (updates.status === 'ready' || updates.status === 'error') {
      setValues.processedAt = new Date().toISOString();
    }

    ddb.update(mediaItemsTable)
      .set(setValues)
      .where(eq(mediaItemsTable.name, name))
      .run();
  });
}

/**
 * Get all media items in workspace
 */
export function getWorkspaceMediaItems(workspacePath: string): MediaItem[] {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(mediaItemsTable)
      .orderBy(asc(mediaItemsTable.addedAt))
      .all();
    return rows.map(row => ({
      name: row.name,
      path: row.path,
      source_path: row.sourcePath,
      media_type: row.mediaType as 'video' | 'audio',
      duration_seconds: row.durationSeconds,
      resolution: row.resolution,
      frame_count: row.frameCount,
      has_transcript: Boolean(row.hasTranscript),
      frame_interval: row.frameInterval,
      status: row.status as MediaItem['status'],
      error_message: row.errorMessage,
      added_at: row.addedAt,
      processed_at: row.processedAt,
    }));
  });
}

/**
 * Get a single media item by name
 */
export function getMediaItem(workspacePath: string, name: string): MediaItem | null {
  return withDrizzle(workspacePath, (ddb) => {
    const row = ddb.select().from(mediaItemsTable)
      .where(eq(mediaItemsTable.name, name))
      .get();
    if (!row) return null;
    return {
      name: row.name,
      path: row.path,
      source_path: row.sourcePath,
      media_type: row.mediaType as 'video' | 'audio',
      duration_seconds: row.durationSeconds,
      resolution: row.resolution,
      frame_count: row.frameCount,
      has_transcript: Boolean(row.hasTranscript),
      frame_interval: row.frameInterval,
      status: row.status as MediaItem['status'],
      error_message: row.errorMessage,
      added_at: row.addedAt,
      processed_at: row.processedAt,
    };
  });
}

/**
 * Remove a media item from the database
 */
export function removeMediaItemFromDatabase(workspacePath: string, name: string): void {
  withDrizzle(workspacePath, (ddb) => {
    ddb.delete(mediaItemsTable)
      .where(eq(mediaItemsTable.name, name))
      .run();
  });
}
