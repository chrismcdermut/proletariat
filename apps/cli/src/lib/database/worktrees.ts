/**
 * Worktree Database Operations
 *
 * Query operations for agent worktrees.
 */

import { eq, like, sql } from 'drizzle-orm'
import {
  agentWorktrees as agentWorktreesTable,
} from './drizzle-schema.js'
import { withDrizzle } from './workspace.js'

export interface AgentWorktree {
  agent_name: string
  repo_name: string
  worktree_path: string
  branch: string
  created_at: string
  last_commit_hash?: string
  commits_ahead: number
  is_clean: boolean
  last_checked?: string
}

function toWorktree(row: {
  agentName: string
  repoName: string
  worktreePath: string
  branch: string
  createdAt: string
  lastCommitHash: string | null
  commitsAhead: number
  isClean: boolean | null
  lastChecked: string | null
}): AgentWorktree {
  return {
    agent_name: row.agentName,
    repo_name: row.repoName,
    worktree_path: row.worktreePath,
    branch: row.branch,
    created_at: row.createdAt,
    last_commit_hash: row.lastCommitHash ?? undefined,
    commits_ahead: row.commitsAhead,
    is_clean: Boolean(row.isClean),
    last_checked: row.lastChecked ?? undefined,
  }
}

/**
 * Get worktrees for a specific agent
 */
export function getAgentWorktrees(workspacePath: string, agentName: string): AgentWorktree[] {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(agentWorktreesTable)
      .where(eq(agentWorktreesTable.agentName, agentName))
      .all()
    return rows.map(toWorktree)
  })
}

/**
 * Find agent worktrees matching a branch pattern (case-insensitive LIKE).
 */
export function findWorktreesByBranch(workspacePath: string, branchPattern: string): AgentWorktree[] {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(agentWorktreesTable)
      .where(like(sql`LOWER(${agentWorktreesTable.branch})`, branchPattern))
      .all()
    return rows.map(toWorktree)
  })
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
      .all()
    return rows
  })
}
