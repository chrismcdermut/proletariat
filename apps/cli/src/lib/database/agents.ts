/**
 * Agent Database Operations
 *
 * CRUD operations for agents in the workspace database.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { eq, and, or, isNull, sql, asc } from 'drizzle-orm'
import { getThemePersistentDir, isEphemeralAgentName } from '../themes.js'
import { createDrizzleConnection } from './drizzle.js'
import {
  workspace as workspaceTable,
  repositories as repositoriesTable,
  agents as agentsTable,
  agentWorktrees as agentWorktreesTable,
} from './drizzle-schema.js'
import { withDrizzle, openWorkspaceDatabase } from './workspace.js'

export type AgentType = 'persistent' | 'ephemeral'
export type AgentStatus = 'active' | 'running' | 'completed' | 'dead' | 'cleaned'
export type MountMode = 'worktree' | 'clone'

/**
 * Statuses that indicate an agent's name is available for recycling.
 * These agents have finished their work or been cleaned up.
 */
export const RECYCLABLE_STATUSES: AgentStatus[] = ['completed', 'dead', 'cleaned']

/**
 * Statuses that indicate an agent is still "alive" (name is in use).
 */
export const ACTIVE_STATUSES: AgentStatus[] = ['active', 'running']

export interface Agent {
  name: string
  type: AgentType
  status: AgentStatus
  base_name: string | null
  theme_id: string | null
  worktree_path: string | null
  mount_mode: MountMode
  created_at: string
  cleaned_at: string | null
}

/**
 * Map a Drizzle agent row to the Agent interface.
 */
function toAgent(row: {
  name: string
  type: string | null
  status: string | null
  baseName: string | null
  themeId: string | null
  worktreePath: string | null
  mountMode: string | null
  createdAt: string
  cleanedAt: string | null
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
  }
}

/**
 * Add agents to database (case-insensitive uniqueness)
 */
export function addAgentsToDatabase(workspacePath: string, agentNames: string[], themeId?: string, mountMode: MountMode = 'worktree'): void {
  withDrizzle(workspacePath, (ddb, sqliteDb) => {
    const wsRow = ddb.select().from(workspaceTable).get()
    if (!wsRow) throw new Error('No workspace config found')

    const repos = ddb.select({ name: repositoriesTable.name }).from(repositoriesTable).all()

    const effectiveThemeId = themeId || wsRow.activeThemeId || undefined
    const persistentDir = getThemePersistentDir(effectiveThemeId)

    const transaction = sqliteDb.transaction(() => {
      for (const agentName of agentNames) {
        const existing = ddb.select({ name: agentsTable.name })
          .from(agentsTable)
          .where(sql`LOWER(${agentsTable.name}) = LOWER(${agentName})`)
          .get()
        if (existing) {
          continue
        }

        const now = new Date().toISOString()

        const agentWorktreePath = wsRow.type === 'hq'
          ? `agents/${persistentDir}/${agentName}`
          : agentName

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
        }).run()

        for (const repo of repos) {
          const worktreePath = wsRow.type === 'hq'
            ? `agents/${persistentDir}/${agentName}/${repo.name}`
            : `${agentName}/${repo.name}`

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
          }).run()
        }
      }
    })

    transaction()
  })
}

/**
 * Add an ephemeral agent to the database.
 * Throws on name collision.
 */
export function addEphemeralAgentToDatabase(
  workspacePath: string,
  agentName: string,
  baseName: string,
  themeId?: string,
  mountMode: MountMode = 'worktree'
): Agent {
  const result = tryAddEphemeralAgentToDatabase(workspacePath, agentName, baseName, themeId, mountMode)
  if (!result) {
    throw new Error(`Agent name "${agentName}" already exists (UNIQUE constraint failed: agents.name)`)
  }
  return result
}

/**
 * Try to add an ephemeral agent to the database.
 * Returns null if the name already exists and is in an active state (concurrency-safe).
 * If the name exists but is in a terminal state (completed/dead/cleaned), recycles it.
 */
export function tryAddEphemeralAgentToDatabase(
  workspacePath: string,
  agentName: string,
  baseName: string,
  themeId?: string,
  mountMode: MountMode = 'worktree'
): Agent | null {
  const sqliteDb = openWorkspaceDatabase(workspacePath)
  const ddb = createDrizzleConnection(sqliteDb)

  try {
    const now = new Date().toISOString()
    const worktreePath = `agents/temp/${agentName}`

    // Check if there's an existing record with this name
    const existing = ddb.select().from(agentsTable)
      .where(eq(agentsTable.name, agentName))
      .get()

    if (existing) {
      const existingAgent = toAgent(existing)
      // Only recycle names from terminal states
      if (existingAgent.status === 'completed' || existingAgent.status === 'dead' || existingAgent.status === 'cleaned') {
        // Recycle: update the existing record back to active
        ddb.update(agentsTable)
          .set({
            type: 'ephemeral',
            status: 'active',
            baseName,
            themeId: themeId || null,
            worktreePath,
            mountMode,
            createdAt: now,
            cleanedAt: null,
          })
          .where(eq(agentsTable.name, agentName))
          .run()

        const agent = ddb.select().from(agentsTable)
          .where(eq(agentsTable.name, agentName))
          .get()
        if (!agent) return null
        return toAgent(agent)
      }
      // Name is in use by an active/running agent — collision
      return null
    }

    // No existing record — insert new
    ddb.insert(agentsTable).values({
      name: agentName,
      type: 'ephemeral',
      status: 'active',
      baseName,
      themeId: themeId || null,
      worktreePath,
      mountMode,
      createdAt: now,
    }).run()

    const agent = ddb.select().from(agentsTable)
      .where(eq(agentsTable.name, agentName))
      .get()

    if (!agent) return null
    return toAgent(agent)
  } catch (err: unknown) {
    const sqliteErr = err as { code?: string }
    if (sqliteErr.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || sqliteErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return null
    }
    throw err
  } finally {
    sqliteDb.close()
  }
}

/**
 * Get ephemeral agent names that are still in use (active or running).
 * Names of completed/dead/cleaned agents are excluded to allow recycling.
 */
export function getEphemeralAgentNames(workspacePath: string): Set<string> {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select({ name: agentsTable.name })
      .from(agentsTable)
      .where(and(
        eq(agentsTable.type, 'ephemeral'),
        or(
          eq(agentsTable.status, 'active'),
          eq(agentsTable.status, 'running'),
        ),
      ))
      .all()
    return new Set(rows.map(a => a.name.toLowerCase()))
  })
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
      .run()
  })
}

/**
 * Get all agents in workspace.
 * By default returns agents with active lifecycle statuses (active, running).
 * Set includeCleanedUp=true to include completed, dead, and cleaned agents.
 */
export function getWorkspaceAgents(workspacePath: string, includeCleanedUp: boolean = false): Agent[] {
  return withDrizzle(workspacePath, (ddb) => {
    let rows
    if (includeCleanedUp) {
      rows = ddb.select().from(agentsTable)
        .orderBy(asc(agentsTable.createdAt))
        .all()
    } else {
      rows = ddb.select().from(agentsTable)
        .where(or(
          eq(agentsTable.status, 'active'),
          eq(agentsTable.status, 'running'),
          isNull(agentsTable.status),
        ))
        .orderBy(asc(agentsTable.createdAt))
        .all()
    }

    return rows.map(toAgent)
  })
}

/**
 * Get an agent by directory path.
 */
export function getAgentByPath(workspacePath: string, absolutePath: string): Agent | null {
  const normalizedWorkspace = path.resolve(workspacePath)
  const normalizedPath = path.resolve(absolutePath)

  if (!normalizedPath.startsWith(normalizedWorkspace)) {
    return null
  }

  const relativePath = path.relative(normalizedWorkspace, normalizedPath)

  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(agentsTable)
      .where(or(
        eq(agentsTable.status, 'active'),
        eq(agentsTable.status, 'running'),
        isNull(agentsTable.status),
      ))
      .all()

    for (const row of rows) {
      if (row.worktreePath) {
        if (relativePath === row.worktreePath || relativePath.startsWith(row.worktreePath + '/')) {
          return toAgent(row)
        }
      }
    }

    return null
  })
}

/**
 * Mark an agent as cleaned up
 */
export function markAgentCleaned(workspacePath: string, agentName: string): void {
  withDrizzle(workspacePath, (ddb) => {
    ddb.update(agentsTable)
      .set({ status: 'cleaned', cleanedAt: new Date().toISOString() })
      .where(eq(agentsTable.name, agentName))
      .run()
  })
}

/**
 * Sync agents in database with what exists on disk.
 * Agents whose directories no longer exist are transitioned:
 * - 'running' agents -> 'dead' (unexpected disappearance)
 * - 'active' agents -> 'cleaned' (normal cleanup)
 */
export function syncAgentsWithDisk(workspacePath: string): string[] {
  const agentList = getWorkspaceAgents(workspacePath, false)
  const cleanedAgents: string[] = []

  for (const agent of agentList) {
    let agentDir: string
    if (agent.worktree_path) {
      agentDir = path.join(workspacePath, agent.worktree_path)
    } else if (agent.type === 'ephemeral') {
      agentDir = path.join(workspacePath, 'agents', 'temp', agent.name)
    } else {
      agentDir = path.join(workspacePath, 'agents', 'staff', agent.name)
    }

    if (!fs.existsSync(agentDir)) {
      if (agent.status === 'running') {
        markAgentDead(workspacePath, agent.name)
      } else {
        markAgentCleaned(workspacePath, agent.name)
      }
      cleanedAgents.push(agent.name)
    }
  }

  return cleanedAgents
}

export interface DiscoverResult {
  discovered: { name: string; type: AgentType; path: string }[]
  cleaned: string[]
}

/**
 * Discover agents on disk that aren't in the database and register them.
 */
export function discoverAgentsOnDisk(workspacePath: string): DiscoverResult {
  const result: DiscoverResult = { discovered: [], cleaned: [] }

  result.cleaned = syncAgentsWithDisk(workspacePath)

  const activeAgents = getWorkspaceAgents(workspacePath, false)
  const activeNames = new Set(activeAgents.map(a => a.name.toLowerCase()))

  const allAgents = getWorkspaceAgents(workspacePath, true)
  const cleanedAgentsMap = new Map(
    allAgents.filter(a => a.status === 'cleaned' || a.status === 'completed' || a.status === 'dead').map(a => [a.name.toLowerCase(), a])
  )

  withDrizzle(workspacePath, (ddb) => {
    // Scan staff directory
    const staffDir = path.join(workspacePath, 'agents', 'staff')
    if (fs.existsSync(staffDir)) {
      const staffEntries = fs.readdirSync(staffDir, { withFileTypes: true })
      for (const entry of staffEntries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const nameLower = entry.name.toLowerCase()
          if (!activeNames.has(nameLower)) {
            const worktreePath = `agents/staff/${entry.name}`
            const now = new Date().toISOString()

            const cleanedAgent = cleanedAgentsMap.get(nameLower)
            if (cleanedAgent) {
              ddb.update(agentsTable)
                .set({ status: 'active', cleanedAt: null, worktreePath })
                .where(sql`LOWER(${agentsTable.name}) = LOWER(${entry.name})`)
                .run()
            } else {
              ddb.insert(agentsTable).values({
                name: entry.name,
                type: 'persistent',
                status: 'active',
                worktreePath,
                mountMode: 'worktree',
                createdAt: now,
              }).run()
            }
            result.discovered.push({ name: entry.name, type: 'persistent', path: worktreePath })
            activeNames.add(nameLower)
          }
        }
      }
    }

    // Scan temp directory
    const tempDir = path.join(workspacePath, 'agents', 'temp')
    if (fs.existsSync(tempDir)) {
      const tempEntries = fs.readdirSync(tempDir, { withFileTypes: true })
      for (const entry of tempEntries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const nameLower = entry.name.toLowerCase()
          if (!activeNames.has(nameLower)) {
            const worktreePath = `agents/temp/${entry.name}`
            const now = new Date().toISOString()

            const cleanedAgent = cleanedAgentsMap.get(nameLower)
            if (cleanedAgent) {
              ddb.update(agentsTable)
                .set({ status: 'active', cleanedAt: null, worktreePath })
                .where(sql`LOWER(${agentsTable.name}) = LOWER(${entry.name})`)
                .run()
            } else {
              ddb.insert(agentsTable).values({
                name: entry.name,
                type: 'ephemeral',
                status: 'active',
                worktreePath,
                mountMode: 'worktree',
                createdAt: now,
              }).run()
            }
            result.discovered.push({ name: entry.name, type: 'ephemeral', path: worktreePath })
            activeNames.add(nameLower)
          }
        }
      }
    }
  })

  return result
}

/**
 * Remove agents from database
 */
export function removeAgentsFromDatabase(workspacePath: string, agentNames: string[]): void {
  withDrizzle(workspacePath, (ddb, sqliteDb) => {
    const transaction = sqliteDb.transaction(() => {
      for (const agentName of agentNames) {
        ddb.delete(agentsTable)
          .where(eq(agentsTable.name, agentName))
          .run()
      }
    })

    transaction()
  })
}

// =============================================================================
// Agent Lifecycle Transitions
// =============================================================================

/**
 * Mark an agent as running (actively executing work).
 * Valid transition from: active
 */
export function markAgentRunning(workspacePath: string, agentName: string): void {
  withDrizzle(workspacePath, (ddb) => {
    ddb.update(agentsTable)
      .set({ status: 'running' })
      .where(and(
        eq(agentsTable.name, agentName),
        eq(agentsTable.status, 'active'),
      ))
      .run()
  })
}

/**
 * Mark an agent as completed (work finished successfully).
 * Valid transition from: active, running
 */
export function markAgentCompleted(workspacePath: string, agentName: string): void {
  withDrizzle(workspacePath, (ddb) => {
    ddb.update(agentsTable)
      .set({ status: 'completed', cleanedAt: new Date().toISOString() })
      .where(and(
        eq(agentsTable.name, agentName),
        or(
          eq(agentsTable.status, 'active'),
          eq(agentsTable.status, 'running'),
        ),
      ))
      .run()
  })
}

/**
 * Mark an agent as dead (died unexpectedly / orphaned).
 * Valid transition from: active, running
 */
export function markAgentDead(workspacePath: string, agentName: string): void {
  withDrizzle(workspacePath, (ddb) => {
    ddb.update(agentsTable)
      .set({ status: 'dead', cleanedAt: new Date().toISOString() })
      .where(and(
        eq(agentsTable.name, agentName),
        or(
          eq(agentsTable.status, 'active'),
          eq(agentsTable.status, 'running'),
        ),
      ))
      .run()
  })
}

/**
 * Reactivate an agent (e.g., when its directory reappears on disk).
 * Valid transition from: completed, dead, cleaned
 */
export function reactivateAgent(workspacePath: string, agentName: string): void {
  withDrizzle(workspacePath, (ddb) => {
    ddb.update(agentsTable)
      .set({ status: 'active', cleanedAt: null })
      .where(and(
        eq(agentsTable.name, agentName),
        or(
          eq(agentsTable.status, 'completed'),
          eq(agentsTable.status, 'dead'),
          eq(agentsTable.status, 'cleaned'),
        ),
      ))
      .run()
  })
}

/**
 * Get agent record by name (any status).
 */
export function getAgent(workspacePath: string, agentName: string): Agent | null {
  return withDrizzle(workspacePath, (ddb) => {
    const row = ddb.select().from(agentsTable)
      .where(eq(agentsTable.name, agentName))
      .get()
    return row ? toAgent(row) : null
  })
}

// =============================================================================
// Agent Record Pruning (GC)
// =============================================================================

export interface PruneOptions {
  /** Only prune agents older than this many days (default: 30) */
  olderThanDays?: number
  /** Only prune agents with these statuses (default: completed, dead, cleaned) */
  statuses?: AgentStatus[]
  /** Dry run - return what would be pruned without actually deleting */
  dryRun?: boolean
}

export interface PruneResult {
  pruned: Agent[]
  dryRun: boolean
}

/**
 * Prune (permanently delete) stale agent records from the database.
 * Only removes agents in terminal states (completed, dead, cleaned) that
 * are older than the specified threshold.
 */
export function pruneAgentRecords(workspacePath: string, options?: PruneOptions): PruneResult {
  const olderThanDays = options?.olderThanDays ?? 30
  const statuses = options?.statuses ?? RECYCLABLE_STATUSES
  const dryRun = options?.dryRun ?? false

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)
  const cutoffIso = cutoffDate.toISOString()

  return withDrizzle(workspacePath, (ddb) => {
    // Find candidates for pruning
    const candidates = ddb.select().from(agentsTable)
      .where(and(
        // Only prune agents in the specified terminal statuses
        or(...statuses.map(s => eq(agentsTable.status, s))),
        // Only prune agents created before the cutoff
        sql`${agentsTable.createdAt} < ${cutoffIso}`,
      ))
      .all()
      .map(toAgent)

    if (dryRun) {
      return { pruned: candidates, dryRun: true }
    }

    // Delete the candidates and their worktree records
    for (const agent of candidates) {
      ddb.delete(agentWorktreesTable)
        .where(eq(agentWorktreesTable.agentName, agent.name))
        .run()
      ddb.delete(agentsTable)
        .where(eq(agentsTable.name, agent.name))
        .run()
    }

    return { pruned: candidates, dryRun: false }
  })
}
