/**
 * Dashboard Data Aggregation
 *
 * Gathers data from board, agents, sessions, and PRs into a unified interface
 * for the web dashboard.
 */

import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { type DatabaseDriver, openDriver } from '../database/driver.js'
import type { Board, Ticket, Column , PMOStorage } from '../pmo/types.js'
import { getWorkspaceInfo, getAllAgentsStatus, getAgentTmuxSessions } from '../agents/commands.js'
import type { WorkspaceInfo, AgentStatus } from '../agents/commands.js'
import { ExecutionStorage } from '../execution/index.js'
import {
  getHostTmuxSessionNames,
  parseSessionName,
  getContainerTmuxSessionMap,
  flattenContainerSessions,
  findContainerSessionsByPrefix,
  findSessionForExecution,
} from '../execution/session-utils.js'
import { listOpenPRs } from '../pr/index.js'
import type { PRInfo } from '../pr/index.js'

// =============================================================================
// Dashboard Data Interface
// =============================================================================

export interface DashboardColumn {
  id: string
  name: string
  position: number
  tickets: DashboardTicket[]
}

export interface DashboardTicket {
  id: string
  title: string
  priority?: string
  category?: string
  assignee?: string
  statusName?: string
  labels: string[]
}

export interface DashboardAgent {
  name: string
  exists: boolean
  branch?: string
  assignedTickets: string[]
  completedTickets: string[]
  hasActiveSessions: boolean
}

export interface DashboardSession {
  sessionId: string
  ticketId: string
  agentName: string
  status: string
  environment: 'host' | 'container'
  source: 'db' | 'discovered'
}

export interface DashboardPR {
  number: number
  url: string
  title: string
  headBranch: string
  isDraft: boolean
  ciStatus?: 'success' | 'failure' | 'pending' | 'unknown'
}

export interface DashboardData {
  projectId: string
  projectName: string
  timestamp: string
  board: {
    columns: DashboardColumn[]
  }
  agents: DashboardAgent[]
  sessions: DashboardSession[]
  prs: DashboardPR[]
}

// =============================================================================
// PR CI Status Cache (gh CLI is slow)
// =============================================================================

let prCacheData: { prs: DashboardPR[]; fetchedAt: number } | null = null
const PR_CACHE_TTL_MS = 30_000

// =============================================================================
// Data Gathering Functions
// =============================================================================

export async function gatherBoardData(
  storage: PMOStorage,
  projectId: string,
): Promise<{ columns: DashboardColumn[] }> {
  try {
    const board: Board = await storage.getBoard(projectId)
    const columns: DashboardColumn[] = board.columns.map((col: Column) => ({
      id: col.id,
      name: col.name,
      position: col.position,
      tickets: (col.tickets || []).map((t: Ticket) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        category: t.category,
        assignee: t.assignee,
        statusName: t.statusName,
        labels: t.labels || [],
      })),
    }))
    return { columns }
  } catch {
    return { columns: [] }
  }
}

export function gatherAgentData(): DashboardAgent[] {
  try {
    const workspaceInfo: WorkspaceInfo = getWorkspaceInfo()
    const statuses: AgentStatus[] = getAllAgentsStatus(workspaceInfo)
    return statuses.map((s) => {
      let hasActiveSessions = false
      try {
        hasActiveSessions = getAgentTmuxSessions(s.name).length > 0
      } catch {
        // tmux not available
      }
      return {
        name: s.name,
        exists: s.exists,
        branch: s.branch,
        assignedTickets: s.assignedTickets,
        completedTickets: s.completedTickets,
        hasActiveSessions,
      }
    })
  } catch {
    return []
  }
}

export function gatherSessionData(): DashboardSession[] {
  let executionStorage: ExecutionStorage | null = null
  let db: DatabaseDriver | null = null
  const sessions: DashboardSession[] = []

  try {
    const workspaceInfo = getWorkspaceInfo()
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    db = openDriver(dbPath, { foreignKeys: false })
    executionStorage = new ExecutionStorage(db)
  } catch {
    // Not in workspace — still discover tmux sessions below
  }

  try {
    const runningExecutions = executionStorage?.listExecutions({ status: 'running' }) || []
    const startingExecutions = executionStorage?.listExecutions({ status: 'starting' }) || []
    const activeExecutions = [...runningExecutions, ...startingExecutions]

    executionStorage?.cleanupStaleExecutions()

    const hostTmuxSessions = getHostTmuxSessionNames()
    const containerTmuxSessions = getContainerTmuxSessionMap()
    const allContainerSessions = flattenContainerSessions(containerTmuxSessions)

    const matchedHostSessions = new Set<string>()
    const matchedContainerSessions = new Set<string>()

    for (const exec of activeExecutions) {
      const isContainer = exec.environment === 'devcontainer' || exec.environment === 'docker'
      let exists = false
      let containerId: string | undefined
      let actualSessionId = exec.sessionId

      if (!exec.sessionId) {
        if (isContainer && exec.containerId) {
          const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
          const match = findSessionForExecution(exec.ticketId, exec.agentName, containerSessions)
          if (match) { actualSessionId = match; exists = true; containerId = exec.containerId }
        } else {
          const match = findSessionForExecution(exec.ticketId, exec.agentName, hostTmuxSessions)
          if (match) { actualSessionId = match; exists = true }
        }
        if (!actualSessionId) continue
      } else {
        if (isContainer && exec.containerId) {
          const containerSessions = findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)
          exists = containerSessions.includes(exec.sessionId)
          containerId = exec.containerId
        } else {
          exists = hostTmuxSessions.includes(exec.sessionId)
        }
      }

      if (exists && actualSessionId) {
        if (isContainer && containerId) {
          matchedContainerSessions.add(`${containerId}:${actualSessionId}`)
        } else {
          matchedHostSessions.add(actualSessionId)
        }
      }

      if (actualSessionId && exists) {
        sessions.push({
          sessionId: actualSessionId,
          ticketId: exec.ticketId,
          agentName: exec.agentName,
          status: exec.status,
          environment: isContainer ? 'container' : 'host',
          source: 'db',
        })
      }
    }

    // Discover orphan sessions
    for (const sessionName of hostTmuxSessions) {
      if (matchedHostSessions.has(sessionName)) continue
      const parsed = parseSessionName(sessionName)
      if (parsed) {
        sessions.push({
          sessionId: sessionName,
          ticketId: parsed.ticketId,
          agentName: parsed.agentName,
          status: 'orphan',
          environment: 'host',
          source: 'discovered',
        })
      }
    }

    for (const { sessionName } of allContainerSessions) {
      const key = `${sessionName}`
      // Check all container session entries
      let matched = false
      for (const k of matchedContainerSessions) {
        if (k.endsWith(`:${sessionName}`)) { matched = true; break }
      }
      if (matched) continue
      const parsed = parseSessionName(sessionName)
      if (parsed) {
        sessions.push({
          sessionId: sessionName,
          ticketId: parsed.ticketId,
          agentName: parsed.agentName,
          status: 'orphan',
          environment: 'container',
          source: 'discovered',
        })
      }
    }
  } finally {
    db?.close()
  }

  return sessions
}

export function gatherPRData(): DashboardPR[] {
  const now = Date.now()
  if (prCacheData && (now - prCacheData.fetchedAt) < PR_CACHE_TTL_MS) {
    return prCacheData.prs
  }

  try {
    const openPRs: PRInfo[] = listOpenPRs()

    // Try to get CI status
    const ciMap: Map<number, string> = new Map()
    try {
      const ciResult = execSync(
        'gh pr list --json number,statusCheckRollup',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000 },
      )
      const ciData = JSON.parse(ciResult) as Array<{
        number: number
        statusCheckRollup: Array<{ conclusion: string; state: string }> | null
      }>
      for (const pr of ciData) {
        if (!pr.statusCheckRollup || pr.statusCheckRollup.length === 0) {
          ciMap.set(pr.number, 'unknown')
          continue
        }
        const hasFailure = pr.statusCheckRollup.some(
          (c) => c.conclusion === 'FAILURE' || c.state === 'FAILURE',
        )
        const allSuccess = pr.statusCheckRollup.every(
          (c) => c.conclusion === 'SUCCESS' || c.state === 'SUCCESS',
        )
        const hasPending = pr.statusCheckRollup.some(
          (c) => c.state === 'PENDING' || c.conclusion === '',
        )
        if (hasFailure) ciMap.set(pr.number, 'failure')
        else if (allSuccess) ciMap.set(pr.number, 'success')
        else if (hasPending) ciMap.set(pr.number, 'pending')
        else ciMap.set(pr.number, 'unknown')
      }
    } catch {
      // CI status unavailable
    }

    const prs: DashboardPR[] = openPRs.map((pr) => ({
      number: pr.number,
      url: pr.url,
      title: pr.title,
      headBranch: pr.headBranch,
      isDraft: pr.isDraft,
      ciStatus: (ciMap.get(pr.number) as DashboardPR['ciStatus']) || 'unknown',
    }))

    prCacheData = { prs, fetchedAt: now }
    return prs
  } catch {
    return prCacheData?.prs || []
  }
}

export async function gatherDashboardData(
  storage: PMOStorage,
  projectId: string,
  projectName: string,
): Promise<DashboardData> {
  const [board, agents, sessions, prs] = await Promise.all([
    gatherBoardData(storage, projectId),
    Promise.resolve(gatherAgentData()),
    Promise.resolve(gatherSessionData()),
    Promise.resolve(gatherPRData()),
  ])

  return {
    projectId,
    projectName,
    timestamp: new Date().toISOString(),
    board,
    agents,
    sessions,
    prs,
  }
}
