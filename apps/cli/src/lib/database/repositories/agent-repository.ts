/**
 * Agent Repository
 *
 * Typed data access for agents, agent worktrees, and themes.
 * All agent DB operations go through this repository.
 *
 * PRLT-1303: Data access layer — typed repository pattern.
 */

import { eq, and, or, isNull, sql, asc } from 'drizzle-orm'
import {
  agents as agentsTable,
  agentWorktrees as agentWorktreesTable,
  workspace as workspaceTable,
  repositories as repositoriesTable,
} from '../drizzle-schema.js'
import type {
  RepositoryContext,
  AgentRecord,
  AgentFilter,
  CreateAgentInput,
  AgentWorktreeRecord,
  CreateAgentWorktreeInput,
  AgentStatus,
} from './types.js'

// =============================================================================
// Row Mapping
// =============================================================================

function toAgentRecord(row: typeof agentsTable.$inferSelect): AgentRecord {
  return {
    name: row.name,
    type: (row.type || 'persistent') as AgentRecord['type'],
    status: (row.status || 'active') as AgentRecord['status'],
    baseName: row.baseName,
    themeId: row.themeId,
    worktreePath: row.worktreePath,
    mountMode: (row.mountMode || 'worktree') as AgentRecord['mountMode'],
    createdAt: row.createdAt,
    cleanedAt: row.cleanedAt,
  }
}

function toWorktreeRecord(row: typeof agentWorktreesTable.$inferSelect): AgentWorktreeRecord {
  return {
    agentName: row.agentName,
    repoName: row.repoName,
    worktreePath: row.worktreePath,
    branch: row.branch,
    createdAt: row.createdAt,
    lastCommitHash: row.lastCommitHash,
    commitsAhead: row.commitsAhead,
    isClean: row.isClean,
    lastChecked: row.lastChecked,
  }
}

// =============================================================================
// AgentRepository
// =============================================================================

export interface IAgentRepository {
  findByName(name: string): AgentRecord | null
  list(filter?: AgentFilter): AgentRecord[]
  create(input: CreateAgentInput): AgentRecord
  upsert(input: CreateAgentInput): AgentRecord
  updateStatus(name: string, status: AgentStatus): void
  remove(name: string): void

  // Worktree operations
  listWorktrees(agentName: string): AgentWorktreeRecord[]
  findWorktreesByBranch(branch: string): AgentWorktreeRecord[]
  getWorktreesForRepo(repoName: string): AgentWorktreeRecord[]
  upsertWorktree(input: CreateAgentWorktreeInput): void

  // Theme-aware operations
  getActiveThemeId(): string | null
  getRepositoryNames(): string[]
}

export class AgentRepository implements IAgentRepository {
  constructor(private ctx: RepositoryContext) {}

  findByName(name: string): AgentRecord | null {
    const row = this.ctx.drizzle
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.name, name))
      .get()
    return row ? toAgentRecord(row) : null
  }

  findByNameCaseInsensitive(name: string): AgentRecord | null {
    const row = this.ctx.drizzle
      .select()
      .from(agentsTable)
      .where(sql`LOWER(${agentsTable.name}) = LOWER(${name})`)
      .get()
    return row ? toAgentRecord(row) : null
  }

  list(filter?: AgentFilter): AgentRecord[] {
    const conditions = []

    if (filter?.includeCleanedUp) {
      // No status filter — return all
    } else if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
      conditions.push(or(...statuses.map(s => eq(agentsTable.status, s))))
    } else {
      // Default: active agents only
      conditions.push(or(
        eq(agentsTable.status, 'active'),
        eq(agentsTable.status, 'running'),
        isNull(agentsTable.status),
      ))
    }

    if (filter?.type) {
      conditions.push(eq(agentsTable.type, filter.type))
    }

    const rows = this.ctx.drizzle
      .select()
      .from(agentsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(agentsTable.createdAt))
      .all()

    return rows.map(toAgentRecord)
  }

  create(input: CreateAgentInput): AgentRecord {
    const now = new Date().toISOString()

    this.ctx.drizzle
      .insert(agentsTable)
      .values({
        name: input.name,
        type: input.type,
        status: 'active',
        baseName: input.baseName ?? null,
        themeId: input.themeId ?? null,
        worktreePath: input.worktreePath ?? null,
        mountMode: input.mountMode ?? 'worktree',
        createdAt: now,
      })
      .run()

    return this.findByName(input.name)!
  }

  upsert(input: CreateAgentInput): AgentRecord {
    const now = new Date().toISOString()

    this.ctx.drizzle
      .insert(agentsTable)
      .values({
        name: input.name,
        type: input.type,
        status: 'active',
        baseName: input.baseName ?? null,
        themeId: input.themeId ?? null,
        worktreePath: input.worktreePath ?? null,
        mountMode: input.mountMode ?? 'worktree',
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: agentsTable.name,
        set: {
          type: input.type,
          baseName: input.baseName ?? null,
          themeId: input.themeId ?? null,
          worktreePath: input.worktreePath ?? null,
          mountMode: input.mountMode ?? 'worktree',
          createdAt: now,
        },
      })
      .run()

    return this.findByName(input.name)!
  }

  updateStatus(name: string, status: AgentStatus): void {
    const cleanedAt = ['completed', 'dead', 'cleaned'].includes(status)
      ? new Date().toISOString()
      : null

    const update: Record<string, unknown> = { status }
    if (cleanedAt) {
      update.cleanedAt = cleanedAt
    } else if (status === 'active') {
      update.cleanedAt = null
    }

    this.ctx.drizzle
      .update(agentsTable)
      .set(update)
      .where(eq(agentsTable.name, name))
      .run()
  }

  remove(name: string): void {
    this.ctx.drizzle
      .delete(agentWorktreesTable)
      .where(eq(agentWorktreesTable.agentName, name))
      .run()

    this.ctx.drizzle
      .delete(agentsTable)
      .where(eq(agentsTable.name, name))
      .run()
  }

  // ===========================================================================
  // Worktree Operations
  // ===========================================================================

  listWorktrees(agentName: string): AgentWorktreeRecord[] {
    const rows = this.ctx.drizzle
      .select()
      .from(agentWorktreesTable)
      .where(eq(agentWorktreesTable.agentName, agentName))
      .all()
    return rows.map(toWorktreeRecord)
  }

  findWorktreesByBranch(branch: string): AgentWorktreeRecord[] {
    const rows = this.ctx.drizzle
      .select()
      .from(agentWorktreesTable)
      .where(eq(agentWorktreesTable.branch, branch))
      .all()
    return rows.map(toWorktreeRecord)
  }

  getWorktreesForRepo(repoName: string): AgentWorktreeRecord[] {
    const rows = this.ctx.drizzle
      .select()
      .from(agentWorktreesTable)
      .where(eq(agentWorktreesTable.repoName, repoName))
      .all()
    return rows.map(toWorktreeRecord)
  }

  upsertWorktree(input: CreateAgentWorktreeInput): void {
    const now = new Date().toISOString()

    this.ctx.drizzle
      .insert(agentWorktreesTable)
      .values({
        agentName: input.agentName,
        repoName: input.repoName,
        worktreePath: input.worktreePath,
        branch: input.branch,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [agentWorktreesTable.agentName, agentWorktreesTable.repoName],
        set: {
          worktreePath: input.worktreePath,
          branch: input.branch,
          createdAt: now,
        },
      })
      .run()
  }

  // ===========================================================================
  // Theme-aware helpers
  // ===========================================================================

  getActiveThemeId(): string | null {
    const ws = this.ctx.drizzle
      .select({ activeThemeId: workspaceTable.activeThemeId })
      .from(workspaceTable)
      .get()
    return ws?.activeThemeId ?? null
  }

  getRepositoryNames(): string[] {
    const repos = this.ctx.drizzle
      .select({ name: repositoriesTable.name })
      .from(repositoriesTable)
      .all()
    return repos.map(r => r.name)
  }
}
