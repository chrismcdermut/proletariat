/**
 * Execution Storage
 *
 * Database operations for agent_work table.
 */

import type Database from 'better-sqlite3'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { PMO_TABLES } from '../pmo/schema.js'
import { type DatabaseDriver, wrapDatabase } from '../database/driver.js'
import { getEventBus } from '../events/event-bus.js'
import {
  AgentWork,
  ExecutionStatus,
  ExecutionRole,
  ExecutorType,
  ExecutionEnvironment,
  DisplayMode,
  PermissionMode,
  CleanupPolicy,
  LifecycleState,
} from './types.js'

// =============================================================================
// Cleaned Execution Info
// =============================================================================

/**
 * Details about a stale execution that was cleaned up.
 * Includes enough context for post-execution validation (commit checks).
 */
export interface CleanedExecution {
  ticketId: string
  executionId: string
  agentName: string
  branch?: string
  environment: ExecutionEnvironment
  containerId?: string
}

const T = PMO_TABLES

// =============================================================================
// Database Row Type
// =============================================================================

interface AgentWorkRow {
  id: string
  ticket_id: string
  agent_name: string
  executor: string
  environment: string
  display_mode: string
  permission_mode: string
  cleanup_policy: string
  role: string | null
  status: string
  branch: string | null
  pid: string | null
  container_id: string | null
  session_id: string | null
  host: string | null
  log_path: string | null
  external_source: string | null
  external_key: string | null
  external_id: string | null
  external_url: string | null
  started_at: number
  completed_at: number | null
  exit_code: number | null
  error_message: string | null
  last_heartbeat: string | null
  lifecycle_state: string | null
  retries: number | null
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
    environment: (row.environment || 'host') as ExecutionEnvironment,
    displayMode: (row.display_mode || 'terminal') as DisplayMode,
    permissionMode: (row.permission_mode || 'safe') as PermissionMode,
    cleanupPolicy: (row.cleanup_policy || 'on-exit') as CleanupPolicy,
    role: (row.role || 'worker') as ExecutionRole,
    status: row.status as ExecutionStatus,
    branch: row.branch || undefined,
    pid: row.pid || undefined,
    containerId: row.container_id || undefined,
    sessionId: row.session_id || undefined,
    host: row.host || undefined,
    logPath: row.log_path || undefined,
    externalSource: row.external_source || undefined,
    externalKey: row.external_key || undefined,
    externalId: row.external_id || undefined,
    externalUrl: row.external_url || undefined,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    exitCode: row.exit_code ?? undefined,
    errorMessage: row.error_message || undefined,
    lastHeartbeat: row.last_heartbeat ? new Date(row.last_heartbeat) : undefined,
    lifecycleState: (row.lifecycle_state as LifecycleState) || undefined,
    retries: row.retries ?? undefined,
  }
}

// =============================================================================
// Execution Storage Class
// =============================================================================

function toDriver(dbOrDriver: DatabaseDriver | Database.Database): DatabaseDriver {
  if ('prepare' in dbOrDriver && 'pragma' in dbOrDriver && !('raw' in dbOrDriver)) {
    return wrapDatabase(dbOrDriver as Database.Database)
  }
  return dbOrDriver as DatabaseDriver
}

export class ExecutionStorage {
  private db: DatabaseDriver

  constructor(dbOrDriver: DatabaseDriver | Database.Database) {
    this.db = toDriver(dbOrDriver)
  }

  /**
   * Create a new execution record.
   * Uses UUID-based IDs to guarantee uniqueness without race conditions.
   */
  createExecution(params: {
    ticketId: string
    agentName: string
    executor: ExecutorType
    environment: ExecutionEnvironment
    displayMode: DisplayMode
    permissionMode: PermissionMode
    cleanupPolicy?: CleanupPolicy
    role?: ExecutionRole
    branch?: string
    pid?: string
    containerId?: string
    sessionId?: string
    host?: string
    logPath?: string
    externalSource?: string
    externalKey?: string
    externalId?: string
    externalUrl?: string
  }): AgentWork {
    const now = Date.now()

    // Generate a unique ID using UUID (first 8 chars, uppercase)
    // Format: WORK-A1B2C3D4 - guaranteed unique, no race conditions
    const id = `WORK-${randomUUID().substring(0, 8).toUpperCase()}`

    this.db.prepare(`
      INSERT INTO ${T.agent_work} (
        id, ticket_id, agent_name, executor, environment, display_mode, permission_mode,
        cleanup_policy, role, status, branch, pid, container_id, session_id, host, log_path,
        external_source, external_key, external_id, external_url, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'starting', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.ticketId,
      params.agentName,
      params.executor,
      params.environment,
      params.displayMode,
      params.permissionMode,
      params.cleanupPolicy || 'on-exit',
      params.role || 'worker',
      params.branch || null,
      params.pid || null,
      params.containerId || null,
      params.sessionId || null,
      params.host || null,
      params.logPath || null,
      params.externalSource || null,
      params.externalKey || null,
      params.externalId || null,
      params.externalUrl || null,
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
   * Try to update execution status, gracefully handling read-only databases.
   * Returns true if the update succeeded, false if skipped due to read-only DB.
   * Use this in container environments where the HQ database is mounted read-only.
   */
  tryUpdateStatus(id: string, status: ExecutionStatus, exitCode?: number, errorMessage?: string): boolean {
    try {
      this.updateStatus(id, status, exitCode, errorMessage)
      return true
    } catch (error: unknown) {
      const code = (error as { code?: string }).code
      if (code === 'SQLITE_READONLY') {
        return false
      }
      throw error
    }
  }

  /**
   * Update execution status
   */
  updateStatus(id: string, status: ExecutionStatus, exitCode?: number, errorMessage?: string): void {
    const completedAt = ['completed', 'failed', 'stopped'].includes(status) ? Date.now() : null

    if (exitCode !== undefined && errorMessage) {
      this.db.prepare(`
        UPDATE ${T.agent_work}
        SET status = ?, completed_at = ?, exit_code = ?, error_message = ?
        WHERE id = ?
      `).run(status, completedAt, exitCode, errorMessage, id)
    } else if (exitCode !== undefined) {
      this.db.prepare(`
        UPDATE ${T.agent_work}
        SET status = ?, completed_at = ?, exit_code = ?
        WHERE id = ?
      `).run(status, completedAt, exitCode, id)
    } else if (errorMessage) {
      this.db.prepare(`
        UPDATE ${T.agent_work}
        SET status = ?, completed_at = ?, error_message = ?
        WHERE id = ?
      `).run(status, completedAt, errorMessage, id)
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
    role?: ExecutionRole
    excludeRole?: ExecutionRole
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
      query += ` AND (ticket_id = ? OR external_key = ?)`
      params.push(filter.ticketId, filter.ticketId)
    }
    if (filter?.role) {
      query += ` AND COALESCE(role, 'worker') = ?`
      params.push(filter.role)
    }
    if (filter?.excludeRole) {
      query += ` AND COALESCE(role, 'worker') != ?`
      params.push(filter.excludeRole)
    }

    query += ` ORDER BY started_at DESC`

    if (filter?.limit) {
      query += ` LIMIT ?`
      params.push(filter.limit)
    }

    const rows = this.db.prepare(query).all(...params) as unknown as AgentWorkRow[]
    return rows.map(rowToAgentWork)
  }

  /**
   * Get running execution for a ticket (if any).
   * Matches by both internal ticket_id (TKT-xxx) and external_key (PRLT-xxx).
   */
  getRunningExecution(ticketId: string): AgentWork | null {
    const row = this.db
      .prepare(`
        SELECT * FROM ${T.agent_work}
        WHERE (ticket_id = ? OR external_key = ?) AND status IN ('starting', 'running')
        ORDER BY started_at DESC
        LIMIT 1
      `)
      .get(ticketId, ticketId) as AgentWorkRow | undefined

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
      .all(agentName) as unknown as AgentWorkRow[]

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
   * Clean up stale executions where the tmux session no longer exists.
   * This fixes the bug where agents appear "busy" after sessions terminate unexpectedly.
   * Returns the ticket IDs of cleaned-up executions (for post-execution hooks).
   */
  cleanupStaleExecutions(): number {
    return this.cleanupStaleExecutionsDetailed().length
  }

  /**
   * Clean up stale executions and return just ticket IDs.
   * Convenience method for callers that don't need full execution details.
   */
  cleanupStaleTicketIds(): string[] {
    return this.cleanupStaleExecutionsDetailed().map(e => e.ticketId)
  }

  /**
   * Clean up stale executions and return details about what was cleaned up.
   * Returns an array of cleaned execution details for post-execution hooks
   * (e.g., commit validation and implement→Review transition).
   */
  cleanupStaleExecutionsDetailed(): CleanedExecution[] {
    // Get all "running" or "starting" executions
    const activeExecutions = this.listExecutions({ status: 'running' })
      .concat(this.listExecutions({ status: 'starting' }))

    if (activeExecutions.length === 0) {
      return []
    }

    // Get list of actual tmux sessions on host
    const hostTmuxSessions = this.getHostTmuxSessionNames()

    // Get map of container -> tmux sessions
    const containerTmuxSessions = this.getContainerTmuxSessionMap()

    const cleanedExecutions: CleanedExecution[] = []
    const bus = getEventBus()

    for (const exec of activeExecutions) {
      // Never mark daemon executions as stale — they're supposed to run forever
      // and will be restarted by the orchestrator if they die
      if (exec.role === 'daemon') continue

      if (!exec.sessionId) {
        // Executions without sessionId might be stale from early termination
        // Check if they're older than 5 minutes and mark as stopped
        const ageMs = Date.now() - exec.startedAt.getTime()
        if (ageMs > 5 * 60 * 1000) {
          this.updateStatus(exec.id, 'stopped')
          const cleaned: CleanedExecution = {
            ticketId: exec.ticketId,
            executionId: exec.id,
            agentName: exec.agentName,
            branch: exec.branch,
            environment: exec.environment,
            containerId: exec.containerId,
          }
          cleanedExecutions.push(cleaned)

          // Emit agent:stopped so cleanup hooks fire for stale executions
          bus.emit('agent:stopped', {
            sessionId: exec.id,
            runner: 'stale-cleanup',
            reason: 'error' as const,
            timestamp: new Date(),
          })
        }
        continue
      }

      let sessionExists = false

      const isContainer = exec.environment === 'devcontainer' || exec.environment === 'docker'
      if (isContainer && exec.containerId) {
        // Check if session exists in container (use prefix matching for ID format differences)
        const containerSessions = this.findContainerSessionsByPrefix(containerTmuxSessions, exec.containerId)

        // PRLT-1077: If the container was unreachable (null), don't assume the session
        // is gone. The agent likely outlives the CLI process in background mode.
        // Only mark as stopped when we can positively confirm the session is absent.
        if (containerSessions === null) {
          continue
        }

        sessionExists = containerSessions.includes(exec.sessionId)
      } else {
        // Check if session exists on host
        sessionExists = hostTmuxSessions.includes(exec.sessionId)
      }

      if (!sessionExists) {
        // Session doesn't exist, mark execution as stopped
        this.updateStatus(exec.id, 'stopped')
        const cleaned: CleanedExecution = {
          ticketId: exec.ticketId,
          executionId: exec.id,
          agentName: exec.agentName,
          branch: exec.branch,
          environment: exec.environment,
          containerId: exec.containerId,
        }
        cleanedExecutions.push(cleaned)

        // Emit agent:stopped so cleanup hooks fire for stale executions
        bus.emit('agent:stopped', {
          sessionId: exec.sessionId,
          runner: 'stale-cleanup',
          reason: 'error' as const,
          timestamp: new Date(),
        })
      }
    }

    return cleanedExecutions
  }

  /**
   * Find container sessions using prefix matching.
   * Handles cases where the stored containerId format differs from docker ps output.
   * Returns null if the container was unreachable (couldn't verify sessions).
   * Returns empty array if container was reachable but has no sessions.
   */
  private findContainerSessionsByPrefix(
    containerTmuxSessions: Map<string, string[] | null>,
    containerId: string
  ): string[] | null {
    const exact = containerTmuxSessions.get(containerId)
    if (exact !== undefined) return exact

    for (const [key, sessions] of containerTmuxSessions) {
      if (key.startsWith(containerId) || containerId.startsWith(key)) {
        return sessions
      }
    }

    // Container not found in docker ps at all — it's not running
    return []
  }

  /**
   * Get list of host tmux session names
   */
  private getHostTmuxSessionNames(): string[] {
    try {
      execSync('which tmux', { stdio: 'pipe' })
      const output = execSync(
        'tmux list-sessions -F "#{session_name}"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()

      if (!output) return []
      return output.split('\n')
    } catch {
      return []
    }
  }

  /**
   * Result of probing containers for tmux sessions.
   * Distinguishes "no sessions" (empty array) from "unreachable" (null).
   */
  private getContainerTmuxSessionMap(): Map<string, string[] | null> {
    const sessionMap = new Map<string, string[] | null>()

    try {
      const containersOutput = execSync(
        'docker ps --filter "label=devcontainer.local_folder" --format "{{.ID}}"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim()

      if (!containersOutput) return sessionMap

      for (const containerId of containersOutput.split('\n')) {
        try {
          const tmuxOutput = execSync(
            `docker exec ${containerId} tmux list-sessions -F "#{session_name}" 2>/dev/null`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
          ).trim()

          // Empty string = tmux is installed but no sessions running
          sessionMap.set(containerId, tmuxOutput ? tmuxOutput.split('\n') : [])
        } catch {
          // PRLT-1077: Distinguish "no tmux sessions" from "container unreachable".
          // docker exec can fail due to timeout, container busy, or tmux not installed.
          // null = unreachable (don't assume sessions are gone).
          sessionMap.set(containerId, null)
        }
      }
    } catch {
      // Docker not available
    }

    return sessionMap
  }

  // ===========================================================================
  // Heartbeat Methods
  // ===========================================================================

  /**
   * Update the heartbeat timestamp for an execution.
   * Called when the agent is observed to be alive and active.
   */
  updateHeartbeat(id: string): void {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE ${T.agent_work}
      SET last_heartbeat = ?
      WHERE id = ?
    `).run(now, id)
  }

  /**
   * Update lifecycle state for an execution.
   */
  updateLifecycleState(id: string, state: LifecycleState): void {
    this.db.prepare(`
      UPDATE ${T.agent_work}
      SET lifecycle_state = ?
      WHERE id = ?
    `).run(state, id)
  }

  /**
   * Get executions that have not sent a heartbeat within the timeout period.
   * These are likely hung or dead agents that need intervention.
   *
   * Returns executions where:
   * - status is 'running' or 'starting'
   * - last_heartbeat is older than timeoutMinutes (or null and started > timeout ago)
   * - lifecycle_state is not already 'died' or 'completed'
   */
  getStaleExecutions(timeoutMinutes: number): AgentWork[] {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString()
    const startedCutoff = Date.now() - timeoutMinutes * 60 * 1000

    const rows = this.db.prepare(`
      SELECT * FROM ${T.agent_work}
      WHERE status IN ('running', 'starting')
        AND (lifecycle_state IS NULL OR lifecycle_state NOT IN ('died', 'completed'))
        AND (
          (last_heartbeat IS NOT NULL AND last_heartbeat < ?)
          OR (last_heartbeat IS NULL AND started_at < ?)
        )
      ORDER BY started_at ASC
    `).all(cutoff, startedCutoff) as unknown as AgentWorkRow[]

    return rows.map(rowToAgentWork)
  }

  /**
   * Mark an execution as failed due to heartbeat timeout.
   * Updates status to 'failed', lifecycle_state to 'died', and sets error message.
   */
  markHeartbeatTimeout(id: string): void {
    const now = Date.now()
    this.db.prepare(`
      UPDATE ${T.agent_work}
      SET status = 'failed',
          lifecycle_state = 'died',
          completed_at = ?,
          error_message = 'Heartbeat timeout — agent unresponsive, auto-terminated'
      WHERE id = ?
    `).run(now, id)
  }

  /**
   * Increment the retry counter for an execution.
   */
  incrementRetries(id: string): void {
    this.db.prepare(`
      UPDATE ${T.agent_work}
      SET retries = COALESCE(retries, 0) + 1
      WHERE id = ?
    `).run(id)
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

// =============================================================================
// Container Types
// =============================================================================

/**
 * @deprecated PRLT-1077: Container status should not be used for agent lifecycle decisions.
 * Agent lifecycle state lives solely on agent_work (ExecutionStatus).
 * This type is kept for schema backwards compatibility but should not be relied upon.
 */
export type ContainerStatus = 'running' | 'exited' | 'paused' | 'unknown' | 'removed'

/**
 * Container record — tracks Docker infrastructure only.
 *
 * PRLT-1077: The containers table is infrastructure metadata (docker ID, image, resource
 * limits). Agent lifecycle status belongs solely on agent_work. Do NOT use container
 * records to determine whether an agent is running — check agent_work.status instead.
 */
export interface Container {
  id: string
  agentName: string
  dockerId: string
  dockerName: string | null
  image: string | null
  /** @deprecated PRLT-1077: Do not use for agent lifecycle. Check agent_work.status instead. */
  status: ContainerStatus
  currentExecutionId: string | null
  createdAt: Date
  lastSeenAt: Date
}

interface ContainerRow {
  id: string
  agent_name: string
  docker_id: string
  docker_name: string | null
  image: string | null
  status: string
  current_execution_id: string | null
  created_at: number
  last_seen_at: number
}

function rowToContainer(row: ContainerRow): Container {
  return {
    id: row.id,
    agentName: row.agent_name,
    dockerId: row.docker_id,
    dockerName: row.docker_name,
    image: row.image,
    status: row.status as ContainerStatus,
    currentExecutionId: row.current_execution_id,
    createdAt: new Date(row.created_at),
    lastSeenAt: new Date(row.last_seen_at),
  }
}

// =============================================================================
// Container Storage Class
// =============================================================================

/**
 * ContainerStorage — Infrastructure-only tracking for Docker containers.
 *
 * PRLT-1077: This table tracks Docker infrastructure metadata (docker ID, image,
 * agent association). It is NOT a source of truth for agent lifecycle state.
 * Agent lifecycle status lives solely on agent_work (ExecutionStatus).
 *
 * The `status` column is retained for schema backwards compatibility but is
 * always set to 'unknown'. To check if a container is running, query Docker
 * directly. To check if an agent is running, check agent_work.status.
 */
export class ContainerStorage {
  private db: DatabaseDriver

  constructor(dbOrDriver: DatabaseDriver | Database.Database) {
    this.db = toDriver(dbOrDriver)
    this.ensureTable()
  }

  /**
   * Ensure containers table exists (for existing databases)
   */
  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${T.containers} (
        id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        docker_id TEXT NOT NULL,
        docker_name TEXT,
        image TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        current_execution_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE,
        FOREIGN KEY (current_execution_id) REFERENCES ${T.agent_work}(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_containers_agent ON ${T.containers}(agent_name);
      CREATE INDEX IF NOT EXISTS idx_containers_docker_id ON ${T.containers}(docker_id);
    `)
  }

  /**
   * Upsert a container record (create or update by docker_id).
   * PRLT-1077: status param is ignored — container status is not tracked in DB.
   * Agent lifecycle state comes from agent_work, Docker state from docker CLI.
   */
  upsertContainer(params: {
    agentName: string
    dockerId: string
    dockerName?: string
    image?: string
    /** @deprecated PRLT-1077: Ignored. Container status is not tracked in DB. */
    status?: ContainerStatus
    currentExecutionId?: string
  }): Container {
    const now = Date.now()

    // Check if container exists by docker_id
    const existing = this.getContainerByDockerId(params.dockerId)

    if (existing) {
      // Update existing container — do not write status
      this.db.prepare(`
        UPDATE ${T.containers}
        SET agent_name = ?, docker_name = ?, image = ?,
            current_execution_id = ?, last_seen_at = ?
        WHERE docker_id = ?
      `).run(
        params.agentName,
        params.dockerName || existing.dockerName,
        params.image || existing.image,
        params.currentExecutionId ?? existing.currentExecutionId,
        now,
        params.dockerId
      )
      return this.getContainerByDockerId(params.dockerId)!
    } else {
      // Create new container — status defaults to 'unknown' (not used for lifecycle)
      const id = `CNT-${params.dockerId.substring(0, 12)}`
      this.db.prepare(`
        INSERT INTO ${T.containers} (
          id, agent_name, docker_id, docker_name, image, status,
          current_execution_id, created_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, 'unknown', ?, ?, ?)
      `).run(
        id,
        params.agentName,
        params.dockerId,
        params.dockerName || null,
        params.image || null,
        params.currentExecutionId || null,
        now,
        now
      )
      return this.getContainer(id)!
    }
  }

  /**
   * Get container by ID
   */
  getContainer(id: string): Container | null {
    const row = this.db
      .prepare(`SELECT * FROM ${T.containers} WHERE id = ?`)
      .get(id) as ContainerRow | undefined
    return row ? rowToContainer(row) : null
  }

  /**
   * Get container by Docker ID (full or short)
   */
  getContainerByDockerId(dockerId: string): Container | null {
    // Match by prefix (supports short IDs like 226eda1721d3)
    const row = this.db
      .prepare(`SELECT * FROM ${T.containers} WHERE docker_id LIKE ? || '%'`)
      .get(dockerId) as ContainerRow | undefined
    return row ? rowToContainer(row) : null
  }

  /**
   * Get container for an agent (most recent)
   */
  getContainerForAgent(agentName: string): Container | null {
    const row = this.db
      .prepare(`
        SELECT * FROM ${T.containers}
        WHERE agent_name = ?
        ORDER BY last_seen_at DESC
        LIMIT 1
      `)
      .get(agentName) as ContainerRow | undefined
    return row ? rowToContainer(row) : null
  }

  /**
   * List all containers
   */
  listContainers(filter?: {
    agentName?: string
    /** @deprecated PRLT-1077: Container status is not tracked. Filter has no effect. */
    status?: ContainerStatus
    limit?: number
  }): Container[] {
    let query = `SELECT * FROM ${T.containers} WHERE 1=1`
    const params: (string | number)[] = []

    if (filter?.agentName) {
      query += ` AND agent_name = ?`
      params.push(filter.agentName)
    }

    query += ` ORDER BY last_seen_at DESC`

    if (filter?.limit) {
      query += ` LIMIT ?`
      params.push(filter.limit)
    }

    const rows = this.db.prepare(query).all(...params) as unknown as ContainerRow[]
    return rows.map(rowToContainer)
  }

  /**
   * @deprecated PRLT-1077: Container status is not tracked in DB.
   * Agent lifecycle state comes from agent_work. Docker state from docker CLI.
   * This method is a no-op kept for backwards compatibility.
   */
  updateStatus(_dockerId: string, _status: ContainerStatus): void {
    // No-op: PRLT-1077 — container status is not the source of truth for agent lifecycle.
  }

  /**
   * Update container's current execution
   */
  setCurrentExecution(dockerId: string, executionId: string | null): void {
    const now = Date.now()
    this.db.prepare(`
      UPDATE ${T.containers}
      SET current_execution_id = ?, last_seen_at = ?
      WHERE docker_id LIKE ? || '%'
    `).run(executionId, now, dockerId)
  }

  /**
   * @deprecated PRLT-1077: Container status is not tracked in DB.
   * This method is a no-op kept for backwards compatibility.
   */
  markRemoved(_dockerId: string): void {
    // No-op: PRLT-1077 — container status is not the source of truth.
  }

  /**
   * Delete container record
   */
  deleteContainer(id: string): void {
    this.db.prepare(`DELETE FROM ${T.containers} WHERE id = ?`).run(id)
  }

  /**
   * Sync container infrastructure metadata from Docker.
   * PRLT-1077: Only syncs infrastructure info (docker ID, name, image, agent association).
   * Does NOT track container status — agent lifecycle state comes from agent_work.
   */
  syncFromDocker(dockerContainers: Array<{
    id: string
    name: string
    image: string
    status: string
    agentName: string
  }>): { added: number; updated: number; removed: number } {
    const now = Date.now()
    let added = 0; let updated = 0; let removed = 0

    // Create a set of docker IDs currently active
    const activeDockerIds = new Set(dockerContainers.map(c => c.id.substring(0, 12)))

    // Wrap all operations in a transaction for atomicity
    const syncTransaction = this.db.transaction(() => {
      // Update or add containers from Docker
      for (const dc of dockerContainers) {
        const existing = this.getContainerByDockerId(dc.id)
        if (existing) {
          // PRLT-1077: Only update infrastructure metadata, not status
          this.db.prepare(`
            UPDATE ${T.containers}
            SET docker_name = ?, image = ?, last_seen_at = ?
            WHERE docker_id LIKE ? || '%'
          `).run(dc.name, dc.image, now, dc.id)
          updated++
        } else {
          this.upsertContainer({
            agentName: dc.agentName,
            dockerId: dc.id,
            dockerName: dc.name,
            image: dc.image,
          })
          added++
        }
      }

      // Remove container records no longer in Docker
      const knownContainers = this.listContainers()
      for (const container of knownContainers) {
        if (!activeDockerIds.has(container.dockerId.substring(0, 12))) {
          this.db.prepare(`DELETE FROM ${T.containers} WHERE id = ?`).run(container.id)
          removed++
        }
      }
    })

    syncTransaction()

    return { added, updated, removed }
  }
}
