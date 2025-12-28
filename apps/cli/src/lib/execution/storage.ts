/**
 * Execution Storage
 *
 * Database operations for agent_work table.
 */

import Database from 'better-sqlite3'
import { PMO_TABLES } from '../pmo/schema.js'
import {
  AgentWork,
  ExecutionStatus,
  RuntimeMode,
  ExecutorType,
  ExecutionEnvironment,
  DisplayMode,
} from './types.js'

const T = PMO_TABLES

// =============================================================================
// Database Row Type
// =============================================================================

interface AgentWorkRow {
  id: string
  ticket_id: string
  agent_name: string
  executor: string
  mode: string
  environment: string
  display_mode: string
  sandboxed: number
  status: string
  branch: string | null
  pid: string | null
  container_id: string | null
  session_id: string | null
  host: string | null
  log_path: string | null
  started_at: number
  completed_at: number | null
  exit_code: number | null
}

// =============================================================================
// Type Conversion
// =============================================================================

function rowToAgentWork(row: AgentWorkRow): AgentWork {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    agentName: row.agent_name,
    executor: row.executor as ExecutorType,
    mode: row.mode as RuntimeMode,
    environment: (row.environment || 'host') as ExecutionEnvironment,
    displayMode: (row.display_mode || 'terminal') as DisplayMode,
    sandboxed: row.sandboxed === 1,
    status: row.status as ExecutionStatus,
    branch: row.branch || undefined,
    pid: row.pid || undefined,
    containerId: row.container_id || undefined,
    sessionId: row.session_id || undefined,
    host: row.host || undefined,
    logPath: row.log_path || undefined,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    exitCode: row.exit_code ?? undefined,
  }
}

// =============================================================================
// ID Generation
// =============================================================================

function generateWorkId(db: Database.Database): string {
  const result = db
    .prepare(`SELECT COUNT(*) as count FROM ${T.agent_work}`)
    .get() as { count: number }
  const num = (result?.count || 0) + 1
  return `WORK-${String(num).padStart(3, '0')}`
}

// =============================================================================
// Execution Storage Class
// =============================================================================

export class ExecutionStorage {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  /**
   * Create a new execution record
   */
  createExecution(params: {
    ticketId: string
    agentName: string
    executor: ExecutorType
    mode: RuntimeMode
    environment: ExecutionEnvironment
    displayMode: DisplayMode
    sandboxed: boolean
    branch?: string
    pid?: string
    containerId?: string
    sessionId?: string
    host?: string
    logPath?: string
  }): AgentWork {
    const id = generateWorkId(this.db)
    const now = Date.now()

    this.db.prepare(`
      INSERT INTO ${T.agent_work} (
        id, ticket_id, agent_name, executor, mode, environment, display_mode, sandboxed,
        status, branch, pid, container_id, session_id, host, log_path, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'starting', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.ticketId,
      params.agentName,
      params.executor,
      params.mode,
      params.environment,
      params.displayMode,
      params.sandboxed ? 1 : 0,
      params.branch || null,
      params.pid || null,
      params.containerId || null,
      params.sessionId || null,
      params.host || null,
      params.logPath || null,
      now
    )

    return this.getExecution(id)!
  }

  /**
   * Get execution by ID
   */
  getExecution(id: string): AgentWork | null {
    const row = this.db
      .prepare(`SELECT * FROM ${T.agent_work} WHERE id = ?`)
      .get(id) as AgentWorkRow | undefined

    return row ? rowToAgentWork(row) : null
  }

  /**
   * Update execution status
   */
  updateStatus(id: string, status: ExecutionStatus, exitCode?: number): void {
    const completedAt = ['completed', 'failed', 'stopped'].includes(status) ? Date.now() : null

    if (exitCode !== undefined) {
      this.db.prepare(`
        UPDATE ${T.agent_work}
        SET status = ?, completed_at = ?, exit_code = ?
        WHERE id = ?
      `).run(status, completedAt, exitCode, id)
    } else {
      this.db.prepare(`
        UPDATE ${T.agent_work}
        SET status = ?, completed_at = ?
        WHERE id = ?
      `).run(status, completedAt, id)
    }
  }

  /**
   * Update execution with process info
   */
  updateProcessInfo(id: string, info: {
    pid?: string
    containerId?: string
    sessionId?: string
    host?: string
    logPath?: string
  }): void {
    const updates: string[] = []
    const params: (string | null)[] = []

    if (info.pid !== undefined) {
      updates.push('pid = ?')
      params.push(info.pid)
    }
    if (info.containerId !== undefined) {
      updates.push('container_id = ?')
      params.push(info.containerId)
    }
    if (info.sessionId !== undefined) {
      updates.push('session_id = ?')
      params.push(info.sessionId)
    }
    if (info.host !== undefined) {
      updates.push('host = ?')
      params.push(info.host)
    }
    if (info.logPath !== undefined) {
      updates.push('log_path = ?')
      params.push(info.logPath)
    }

    if (updates.length > 0) {
      params.push(id)
      this.db.prepare(`
        UPDATE ${T.agent_work}
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...params)
    }
  }

  /**
   * List executions with optional filters
   */
  listExecutions(filter?: {
    status?: ExecutionStatus
    agentName?: string
    ticketId?: string
    limit?: number
  }): AgentWork[] {
    let query = `SELECT * FROM ${T.agent_work} WHERE 1=1`
    const params: (string | number)[] = []

    if (filter?.status) {
      query += ` AND status = ?`
      params.push(filter.status)
    }
    if (filter?.agentName) {
      query += ` AND agent_name = ?`
      params.push(filter.agentName)
    }
    if (filter?.ticketId) {
      query += ` AND ticket_id = ?`
      params.push(filter.ticketId)
    }

    query += ` ORDER BY started_at DESC`

    if (filter?.limit) {
      query += ` LIMIT ?`
      params.push(filter.limit)
    }

    const rows = this.db.prepare(query).all(...params) as AgentWorkRow[]
    return rows.map(rowToAgentWork)
  }

  /**
   * Get running execution for a ticket (if any)
   */
  getRunningExecution(ticketId: string): AgentWork | null {
    const row = this.db
      .prepare(`
        SELECT * FROM ${T.agent_work}
        WHERE ticket_id = ? AND status IN ('starting', 'running')
        ORDER BY started_at DESC
        LIMIT 1
      `)
      .get(ticketId) as AgentWorkRow | undefined

    return row ? rowToAgentWork(row) : null
  }

  /**
   * Get all running executions for an agent
   */
  getAgentRunningExecutions(agentName: string): AgentWork[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM ${T.agent_work}
        WHERE agent_name = ? AND status IN ('starting', 'running')
        ORDER BY started_at DESC
      `)
      .all(agentName) as AgentWorkRow[]

    return rows.map(rowToAgentWork)
  }

  /**
   * Check if agent is available (not running anything)
   */
  isAgentAvailable(agentName: string): boolean {
    const count = this.db
      .prepare(`
        SELECT COUNT(*) as count FROM ${T.agent_work}
        WHERE agent_name = ? AND status IN ('starting', 'running')
      `)
      .get(agentName) as { count: number }

    return count.count === 0
  }

  /**
   * Get total execution count for an agent (historical)
   * Used by least-busy agent selection strategy.
   */
  getAgentExecutionCount(agentName: string): number {
    const result = this.db
      .prepare(`
        SELECT COUNT(*) as count FROM ${T.agent_work}
        WHERE agent_name = ?
      `)
      .get(agentName) as { count: number }

    return result?.count || 0
  }

  /**
   * Delete execution record
   */
  deleteExecution(id: string): void {
    this.db.prepare(`DELETE FROM ${T.agent_work} WHERE id = ?`).run(id)
  }
}
