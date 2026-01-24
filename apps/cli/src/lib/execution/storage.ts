/**
 * Execution Storage
 *
 * Database operations for agent_work table.
 */

import Database from 'better-sqlite3'
import { execSync } from 'node:child_process'
import { PMO_TABLES } from '../pmo/schema.js'
import {
  AgentWork,
  ExecutionStatus,
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
        id, ticket_id, agent_name, executor, environment, display_mode, sandboxed,
        status, branch, pid, container_id, session_id, host, log_path, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'starting', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.ticketId,
      params.agentName,
      params.executor,
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
   * Clean up stale executions where the tmux session no longer exists.
   * This fixes the bug where agents appear "busy" after sessions terminate unexpectedly.
   * Returns the number of stale executions cleaned up.
   */
  cleanupStaleExecutions(): number {
    // Get all "running" or "starting" executions
    const activeExecutions = this.listExecutions({ status: 'running' })
      .concat(this.listExecutions({ status: 'starting' }))

    if (activeExecutions.length === 0) {
      return 0
    }

    // Get list of actual tmux sessions on host
    const hostTmuxSessions = this.getHostTmuxSessionNames()

    // Get map of container -> tmux sessions
    const containerTmuxSessions = this.getContainerTmuxSessionMap()

    let cleanedCount = 0

    for (const exec of activeExecutions) {
      if (!exec.sessionId) {
        // Executions without sessionId might be stale from early termination
        // Check if they're older than 5 minutes and mark as stopped
        const ageMs = Date.now() - exec.startedAt.getTime()
        if (ageMs > 5 * 60 * 1000) {
          this.updateStatus(exec.id, 'stopped')
          cleanedCount++
        }
        continue
      }

      let sessionExists = false

      if (exec.environment === 'devcontainer' && exec.containerId) {
        // Check if session exists in container
        const containerSessions = containerTmuxSessions.get(exec.containerId)
        sessionExists = containerSessions?.includes(exec.sessionId) ?? false
      } else {
        // Check if session exists on host
        sessionExists = hostTmuxSessions.includes(exec.sessionId)
      }

      if (!sessionExists) {
        // Session doesn't exist, mark execution as stopped
        this.updateStatus(exec.id, 'stopped')
        cleanedCount++
      }
    }

    return cleanedCount
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
   * Get map of containerId -> tmux session names
   */
  private getContainerTmuxSessionMap(): Map<string, string[]> {
    const sessionMap = new Map<string, string[]>()

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
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
          ).trim()

          if (tmuxOutput) {
            sessionMap.set(containerId, tmuxOutput.split('\n'))
          }
        } catch {
          // Container has no tmux sessions
        }
      }
    } catch {
      // Docker not available
    }

    return sessionMap
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

export type ContainerStatus = 'running' | 'exited' | 'paused' | 'unknown' | 'removed'

export interface Container {
  id: string
  agentName: string
  dockerId: string
  dockerName: string | null
  image: string | null
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

export class ContainerStorage {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
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
      CREATE INDEX IF NOT EXISTS idx_containers_status ON ${T.containers}(status);
    `)
  }

  /**
   * Upsert a container record (create or update by docker_id)
   */
  upsertContainer(params: {
    agentName: string
    dockerId: string
    dockerName?: string
    image?: string
    status?: ContainerStatus
    currentExecutionId?: string
  }): Container {
    const now = Date.now()

    // Check if container exists by docker_id
    const existing = this.getContainerByDockerId(params.dockerId)

    if (existing) {
      // Update existing container
      this.db.prepare(`
        UPDATE ${T.containers}
        SET agent_name = ?, docker_name = ?, image = ?, status = ?,
            current_execution_id = ?, last_seen_at = ?
        WHERE docker_id = ?
      `).run(
        params.agentName,
        params.dockerName || existing.dockerName,
        params.image || existing.image,
        params.status || existing.status,
        params.currentExecutionId ?? existing.currentExecutionId,
        now,
        params.dockerId
      )
      return this.getContainerByDockerId(params.dockerId)!
    } else {
      // Create new container
      const id = `CNT-${params.dockerId.substring(0, 12)}`
      this.db.prepare(`
        INSERT INTO ${T.containers} (
          id, agent_name, docker_id, docker_name, image, status,
          current_execution_id, created_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        params.agentName,
        params.dockerId,
        params.dockerName || null,
        params.image || null,
        params.status || 'unknown',
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
    status?: ContainerStatus
    limit?: number
  }): Container[] {
    let query = `SELECT * FROM ${T.containers} WHERE 1=1`
    const params: (string | number)[] = []

    if (filter?.agentName) {
      query += ` AND agent_name = ?`
      params.push(filter.agentName)
    }
    if (filter?.status) {
      query += ` AND status = ?`
      params.push(filter.status)
    }

    query += ` ORDER BY last_seen_at DESC`

    if (filter?.limit) {
      query += ` LIMIT ?`
      params.push(filter.limit)
    }

    const rows = this.db.prepare(query).all(...params) as ContainerRow[]
    return rows.map(rowToContainer)
  }

  /**
   * Update container status
   */
  updateStatus(dockerId: string, status: ContainerStatus): void {
    const now = Date.now()
    this.db.prepare(`
      UPDATE ${T.containers}
      SET status = ?, last_seen_at = ?
      WHERE docker_id LIKE ? || '%'
    `).run(status, now, dockerId)
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
   * Mark container as removed
   */
  markRemoved(dockerId: string): void {
    this.updateStatus(dockerId, 'removed')
  }

  /**
   * Delete container record
   */
  deleteContainer(id: string): void {
    this.db.prepare(`DELETE FROM ${T.containers} WHERE id = ?`).run(id)
  }

  /**
   * Sync container status from Docker
   * Updates status for all known containers based on Docker state
   * Wrapped in a transaction for consistency
   */
  syncFromDocker(dockerContainers: Array<{
    id: string
    name: string
    image: string
    status: string
    agentName: string
  }>): { added: number; updated: number; removed: number } {
    const now = Date.now()
    let added = 0, updated = 0, removed = 0

    // Create a set of docker IDs currently running
    const activeDockerIds = new Set(dockerContainers.map(c => c.id.substring(0, 12)))

    // Wrap all operations in a transaction for atomicity
    const syncTransaction = this.db.transaction(() => {
      // Update or add containers from Docker
      for (const dc of dockerContainers) {
        const status: ContainerStatus = dc.status.startsWith('Up') ? 'running' :
                                        dc.status.includes('Paused') ? 'paused' : 'exited'

        const existing = this.getContainerByDockerId(dc.id)
        if (existing) {
          this.db.prepare(`
            UPDATE ${T.containers}
            SET docker_name = ?, image = ?, status = ?, last_seen_at = ?
            WHERE docker_id LIKE ? || '%'
          `).run(dc.name, dc.image, status, now, dc.id)
          updated++
        } else {
          this.upsertContainer({
            agentName: dc.agentName,
            dockerId: dc.id,
            dockerName: dc.name,
            image: dc.image,
            status,
          })
          added++
        }
      }

      // Mark containers not in Docker as removed
      const knownContainers = this.listContainers()
      for (const container of knownContainers) {
        if (!activeDockerIds.has(container.dockerId.substring(0, 12)) &&
            container.status !== 'removed') {
          this.markRemoved(container.dockerId)
          removed++
        }
      }
    })

    syncTransaction()

    return { added, updated, removed }
  }
}
