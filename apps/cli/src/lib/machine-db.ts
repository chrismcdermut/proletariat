/**
 * Machine DB — Machine-level runtime state database.
 *
 * Lives at ~/.proletariat/machine.db — always available, no HQ workspace needed.
 * Tracks agent executions and health across all repos on the machine.
 *
 * This is the primary runtime state store for ticketless work (`prlt work run`)
 * and also used alongside workspace.db for ticketed work (`prlt work start`).
 *
 * Tables:
 * - executions: work ID, prompt, repo path, branch, status, timestamps
 * - agent_health: heartbeat, lifecycle state per execution
 *
 * @see session-store.ts for the separate session tracking (sessions.db)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'
import { type DatabaseDriver, openDriver } from './database/driver.js'

// =============================================================================
// Types
// =============================================================================

export type MachineExecutionStatus = 'starting' | 'running' | 'completed' | 'failed' | 'stopped'
export type MachineLifecycleState = 'healthy' | 'idle' | 'died' | 'completed'

export interface MachineExecution {
  id: string
  prompt: string
  repoPath: string
  branch: string | undefined
  agentName: string
  executor: string
  environment: string
  containerId: string | undefined
  sessionId: string | undefined
  status: MachineExecutionStatus
  ticketId: string | undefined
  createPr: boolean
  startedAt: Date
  completedAt: Date | undefined
  exitCode: number | undefined
  errorMessage: string | undefined
}

export interface AgentHealth {
  executionId: string
  lastHeartbeat: Date
  lifecycleState: MachineLifecycleState
  retries: number
}

interface ExecutionRow {
  id: string
  prompt: string
  repo_path: string
  branch: string | null
  agent_name: string
  executor: string
  environment: string
  container_id: string | null
  session_id: string | null
  status: string
  ticket_id: string | null
  create_pr: number
  started_at: number
  completed_at: number | null
  exit_code: number | null
  error_message: string | null
}

interface AgentHealthRow {
  execution_id: string
  last_heartbeat: string
  lifecycle_state: string
  retries: number
}

// =============================================================================
// Helpers
// =============================================================================

function rowToExecution(row: ExecutionRow): MachineExecution {
  return {
    id: row.id,
    prompt: row.prompt,
    repoPath: row.repo_path,
    branch: row.branch || undefined,
    agentName: row.agent_name,
    executor: row.executor,
    environment: row.environment,
    containerId: row.container_id || undefined,
    sessionId: row.session_id || undefined,
    status: row.status as MachineExecutionStatus,
    ticketId: row.ticket_id || undefined,
    createPr: row.create_pr === 1,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    exitCode: row.exit_code ?? undefined,
    errorMessage: row.error_message || undefined,
  }
}

function rowToHealth(row: AgentHealthRow): AgentHealth {
  return {
    executionId: row.execution_id,
    lastHeartbeat: new Date(row.last_heartbeat),
    lifecycleState: row.lifecycle_state as MachineLifecycleState,
    retries: row.retries,
  }
}

/**
 * Get the default machine DB path: ~/.proletariat/machine.db
 */
export function getMachineDbPath(): string {
  const dir = path.join(os.homedir(), '.proletariat')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'machine.db')
}

// =============================================================================
// Machine DB
// =============================================================================

export class MachineDB {
  private db: DatabaseDriver

  constructor(dbPath?: string) {
    this.db = openDriver(dbPath ?? getMachineDbPath(), { foreignKeys: true })
    this.ensureSchema()
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        branch TEXT,
        agent_name TEXT NOT NULL,
        executor TEXT NOT NULL DEFAULT 'claude-code',
        environment TEXT NOT NULL DEFAULT 'host',
        container_id TEXT,
        session_id TEXT,
        status TEXT NOT NULL DEFAULT 'starting',
        ticket_id TEXT,
        create_pr INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        exit_code INTEGER,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
      CREATE INDEX IF NOT EXISTS idx_executions_repo ON executions(repo_path);
      CREATE INDEX IF NOT EXISTS idx_executions_agent ON executions(agent_name);

      CREATE TABLE IF NOT EXISTS agent_health (
        execution_id TEXT PRIMARY KEY REFERENCES executions(id) ON DELETE CASCADE,
        last_heartbeat TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT 'healthy',
        retries INTEGER NOT NULL DEFAULT 0
      );
    `)
  }

  // ===========================================================================
  // Execution CRUD
  // ===========================================================================

  /**
   * Create a new execution record.
   * Returns the created execution with a unique MRUN-xxxx ID.
   */
  createExecution(params: {
    prompt: string
    repoPath: string
    agentName: string
    executor?: string
    environment?: string
    branch?: string
    ticketId?: string
    createPr?: boolean
  }): MachineExecution {
    const id = `MRUN-${randomUUID().substring(0, 8).toUpperCase()}`
    const now = Date.now()

    this.db.prepare(`
      INSERT INTO executions (
        id, prompt, repo_path, branch, agent_name, executor, environment,
        status, ticket_id, create_pr, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'starting', ?, ?, ?)
    `).run(
      id,
      params.prompt,
      params.repoPath,
      params.branch || null,
      params.agentName,
      params.executor || 'claude-code',
      params.environment || 'host',
      params.ticketId || null,
      params.createPr ? 1 : 0,
      now,
    )

    return this.getExecution(id)!
  }

  /**
   * Get an execution by ID.
   */
  getExecution(id: string): MachineExecution | null {
    const row = this.db.prepare<ExecutionRow>(
      'SELECT * FROM executions WHERE id = ?'
    ).get(id)
    return row ? rowToExecution(row) : null
  }

  /**
   * List executions with optional filters.
   */
  listExecutions(filter?: {
    status?: MachineExecutionStatus
    repoPath?: string
    agentName?: string
    limit?: number
  }): MachineExecution[] {
    let query = 'SELECT * FROM executions WHERE 1=1'
    const params: (string | number)[] = []

    if (filter?.status) {
      query += ' AND status = ?'
      params.push(filter.status)
    }
    if (filter?.repoPath) {
      query += ' AND repo_path = ?'
      params.push(filter.repoPath)
    }
    if (filter?.agentName) {
      query += ' AND agent_name = ?'
      params.push(filter.agentName)
    }

    query += ' ORDER BY started_at DESC'

    if (filter?.limit) {
      query += ' LIMIT ?'
      params.push(filter.limit)
    }

    const rows = this.db.prepare(query).all(...params) as unknown as ExecutionRow[]
    return rows.map(rowToExecution)
  }

  /**
   * Update execution status. Sets completed_at for terminal statuses.
   */
  updateStatus(id: string, status: MachineExecutionStatus, exitCode?: number, errorMessage?: string): void {
    const completedAt = ['completed', 'failed', 'stopped'].includes(status) ? Date.now() : null
    const updates: string[] = ['status = ?']
    const params: (string | number | null)[] = [status]

    updates.push('completed_at = ?')
    params.push(completedAt)

    if (exitCode !== undefined) {
      updates.push('exit_code = ?')
      params.push(exitCode)
    }
    if (errorMessage) {
      updates.push('error_message = ?')
      params.push(errorMessage)
    }

    params.push(id)
    this.db.prepare(`
      UPDATE executions SET ${updates.join(', ')} WHERE id = ?
    `).run(...params)
  }

  /**
   * Update execution with process/session info after launch.
   */
  updateProcessInfo(id: string, info: {
    containerId?: string
    sessionId?: string
    branch?: string
  }): void {
    const updates: string[] = []
    const params: (string | null)[] = []

    if (info.containerId !== undefined) {
      updates.push('container_id = ?')
      params.push(info.containerId)
    }
    if (info.sessionId !== undefined) {
      updates.push('session_id = ?')
      params.push(info.sessionId)
    }
    if (info.branch !== undefined) {
      updates.push('branch = ?')
      params.push(info.branch)
    }

    if (updates.length > 0) {
      params.push(id)
      this.db.prepare(`UPDATE executions SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }
  }

  /**
   * Get all active (starting/running) executions.
   */
  getActiveExecutions(): MachineExecution[] {
    const rows = this.db.prepare(
      "SELECT * FROM executions WHERE status IN ('starting', 'running') ORDER BY started_at DESC"
    ).all() as unknown as ExecutionRow[]
    return rows.map(rowToExecution)
  }

  /**
   * Delete an execution record.
   */
  deleteExecution(id: string): void {
    this.db.prepare('DELETE FROM executions WHERE id = ?').run(id)
  }

  // ===========================================================================
  // Agent Health
  // ===========================================================================

  /**
   * Update heartbeat for an execution. Creates or updates the health record.
   */
  updateHeartbeat(executionId: string): void {
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO agent_health (execution_id, last_heartbeat, lifecycle_state, retries)
      VALUES (?, ?, 'healthy', 0)
      ON CONFLICT(execution_id) DO UPDATE SET last_heartbeat = ?
    `).run(executionId, now, now)
  }

  /**
   * Update lifecycle state for an execution.
   */
  updateLifecycleState(executionId: string, state: MachineLifecycleState): void {
    this.db.prepare(`
      INSERT INTO agent_health (execution_id, last_heartbeat, lifecycle_state, retries)
      VALUES (?, datetime('now'), ?, 0)
      ON CONFLICT(execution_id) DO UPDATE SET lifecycle_state = ?
    `).run(executionId, state, state)
  }

  /**
   * Get health info for an execution.
   */
  getHealth(executionId: string): AgentHealth | null {
    const row = this.db.prepare<AgentHealthRow>(
      'SELECT * FROM agent_health WHERE execution_id = ?'
    ).get(executionId)
    return row ? rowToHealth(row) : null
  }

  /**
   * Increment retry counter for an execution.
   */
  incrementRetries(executionId: string): void {
    this.db.prepare(`
      UPDATE agent_health SET retries = retries + 1 WHERE execution_id = ?
    `).run(executionId)
  }

  /**
   * Get executions with stale heartbeats (older than timeoutMinutes).
   */
  getStaleExecutions(timeoutMinutes: number): MachineExecution[] {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString()

    const rows = this.db.prepare(`
      SELECT e.* FROM executions e
      LEFT JOIN agent_health h ON e.id = h.execution_id
      WHERE e.status IN ('running', 'starting')
        AND (h.lifecycle_state IS NULL OR h.lifecycle_state NOT IN ('died', 'completed'))
        AND (
          (h.last_heartbeat IS NOT NULL AND h.last_heartbeat < ?)
          OR (h.last_heartbeat IS NULL AND e.started_at < ?)
        )
      ORDER BY e.started_at ASC
    `).all(cutoff, Date.now() - timeoutMinutes * 60 * 1000) as unknown as ExecutionRow[]

    return rows.map(rowToExecution)
  }

  close(): void {
    this.db.close()
  }
}
