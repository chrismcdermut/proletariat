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
export type MachineCleanupPolicy = 'on-exit' | 'persistent' | 'on-error-keep'

// =============================================================================
// Messaging gateway types (PRLT-1255)
// =============================================================================

/**
 * A registered messaging channel (Telegram, Slack, Discord, ...).
 * `configJson` is an adapter-specific blob stored as text.
 */
export interface MessagingChannelRow {
  name: string
  type: string
  config_json: string
  active: number
  last_message_at: number | null
}

export interface MessagingChannelRecord {
  name: string
  type: string
  configJson: string
  active: boolean
  lastMessageAt: Date | undefined
}

/**
 * A persistent binding of `(channel, userId)` to an agent session.
 * The router looks this up on every inbound message so a given user
 * always lands on the same agent.
 */
export interface MessagingRouteRow {
  channel: string
  user_id: string
  agent_session_id: string
  created_at: number
  last_used_at: number | null
}

export interface MessagingRouteRecord {
  channel: string
  userId: string
  agentSessionId: string
  createdAt: Date
  lastUsedAt: Date | undefined
}

// =============================================================================
// Orchestrator thread types (PRLT-1265)
// =============================================================================

export type OrchestratorThreadStatus = 'active' | 'inactive'

export interface OrchestratorThreadRow {
  name: string
  address: string
  routes: string | null
  status: string
  registered_at: number
  last_seen: number
}

export interface OrchestratorThreadRecord {
  name: string
  address: string
  routes: string[] | null
  status: OrchestratorThreadStatus
  registeredAt: Date
  lastSeen: Date
}

export interface PendingLlmDecisionRow {
  id: string
  event_name: string
  hook_name: string
  action: string
  context_json: string
  status: string
  orchestrator_name: string | null
  queued_at: number
  timeout_ms: number
  resolved_at: number | null
  decision: string | null
}

export type LlmDecisionStatus = 'pending' | 'approved' | 'denied' | 'escalated' | 'timed_out'

export interface PendingLlmDecisionRecord {
  id: string
  eventName: string
  hookName: string
  action: string
  contextJson: string
  status: LlmDecisionStatus
  orchestratorName: string | null
  queuedAt: Date
  timeoutMs: number
  resolvedAt: Date | null
  decision: string | null
}

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
  persistent: boolean
  cleanupPolicy: MachineCleanupPolicy
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
  persistent: number
  cleanup_policy: string
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
    persistent: row.persistent === 1,
    cleanupPolicy: (row.cleanup_policy || 'on-exit') as MachineCleanupPolicy,
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

/**
 * Ensure the machine-level database at ~/.proletariat/machine.db exists and
 * has its schema initialized.  Safe to call repeatedly (idempotent).
 *
 * Call this during `prlt init` / `prlt new` so the database is ready
 * before any command tries to read from it.
 */
export function ensureMachineDb(): void {
  const db = new MachineDB()
  db.close()
}

/**
 * Remove a stale 0-byte machine.db that was accidentally created at the
 * HQ root (the correct location is ~/.proletariat/machine.db).
 *
 * Returns true if a stale file was removed.
 */
export function cleanupStaleMachineDb(hqPath: string): boolean {
  const staleDbPath = path.join(hqPath, 'machine.db')
  try {
    if (fs.existsSync(staleDbPath)) {
      const stat = fs.statSync(staleDbPath)
      if (stat.size === 0) {
        fs.unlinkSync(staleDbPath)
        return true
      }
    }
  } catch {
    // Non-fatal — best-effort cleanup
  }
  return false
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
        persistent INTEGER NOT NULL DEFAULT 0,
        cleanup_policy TEXT NOT NULL DEFAULT 'on-exit',
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        exit_code INTEGER,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
      CREATE INDEX IF NOT EXISTS idx_executions_repo ON executions(repo_path);
      CREATE INDEX IF NOT EXISTS idx_executions_agent ON executions(agent_name);
      CREATE INDEX IF NOT EXISTS idx_executions_persistent ON executions(persistent);

      CREATE TABLE IF NOT EXISTS agent_health (
        execution_id TEXT PRIMARY KEY REFERENCES executions(id) ON DELETE CASCADE,
        last_heartbeat TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT 'healthy',
        retries INTEGER NOT NULL DEFAULT 0
      );

      -- Messaging gateway (PRLT-1255) — bridges external messaging platforms
      -- (Telegram, Slack, ...) to agent sessions via prlt session poke.
      CREATE TABLE IF NOT EXISTS messaging_channels (
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        config_json TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        last_message_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS messaging_routes (
        channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        agent_session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        PRIMARY KEY (channel, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_messaging_routes_agent
        ON messaging_routes(agent_session_id);

      -- Orchestrator thread registry (PRLT-1265) — registers Claude/Codex
      -- sessions as LLM tier endpoints with event routing.
      CREATE TABLE IF NOT EXISTS orchestrator_threads (
        name TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        routes TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        registered_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );

      -- Pending LLM decisions (PRLT-1265) — persists tier-2 decisions
      -- that need orchestrator review. Survives daemon restarts.
      CREATE TABLE IF NOT EXISTS pending_llm_decisions (
        id TEXT PRIMARY KEY,
        event_name TEXT NOT NULL,
        hook_name TEXT NOT NULL,
        action TEXT NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        orchestrator_name TEXT,
        queued_at INTEGER NOT NULL,
        timeout_ms INTEGER NOT NULL DEFAULT 300000,
        resolved_at INTEGER,
        decision TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_pending_llm_status
        ON pending_llm_decisions(status);
    `)

    // Migrate existing databases that don't have the persistent columns
    this.addColumnIfMissing('executions', 'persistent', 'INTEGER NOT NULL DEFAULT 0')
    this.addColumnIfMissing('executions', 'cleanup_policy', "TEXT NOT NULL DEFAULT 'on-exit'")
  }

  /**
   * Safely add a column if it doesn't exist (for schema migration).
   */
  private addColumnIfMissing(table: string, column: string, definition: string): void {
    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    } catch {
      // Column already exists — ignore
    }
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
    persistent?: boolean
    cleanupPolicy?: MachineCleanupPolicy
  }): MachineExecution {
    const id = `MRUN-${randomUUID().substring(0, 8).toUpperCase()}`
    const now = Date.now()
    const persistent = params.persistent ?? false
    const cleanupPolicy = params.cleanupPolicy ?? (persistent ? 'persistent' : 'on-exit')

    this.db.prepare(`
      INSERT INTO executions (
        id, prompt, repo_path, branch, agent_name, executor, environment,
        status, ticket_id, create_pr, persistent, cleanup_policy, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'starting', ?, ?, ?, ?, ?)
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
      persistent ? 1 : 0,
      cleanupPolicy,
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
    persistent?: boolean
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
    if (filter?.persistent !== undefined) {
      query += ' AND persistent = ?'
      params.push(filter.persistent ? 1 : 0)
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
   * Get all active executions where the agent name starts with the given
   * prefix. Used by `prlt orchestrator status/attach/stop` to find all
   * orchestrator executions (`orchestrator-{name}`) machine-wide.
   */
  getActiveByAgentPrefix(prefix: string): MachineExecution[] {
    const rows = this.db.prepare(
      "SELECT * FROM executions WHERE status IN ('starting', 'running') AND agent_name LIKE ? ORDER BY started_at DESC"
    ).all(`${prefix}%`) as unknown as ExecutionRow[]
    return rows.map(rowToExecution)
  }

  /**
   * Find an execution by session ID (unique across the machine).
   * Returns the most recently started match, or null.
   */
  findBySessionId(sessionId: string): MachineExecution | null {
    const row = this.db.prepare<ExecutionRow>(
      'SELECT * FROM executions WHERE session_id = ? ORDER BY started_at DESC LIMIT 1'
    ).get(sessionId)
    return row ? rowToExecution(row) : null
  }

  /**
   * Delete an execution record.
   */
  deleteExecution(id: string): void {
    this.db.prepare('DELETE FROM executions WHERE id = ?').run(id)
  }

  // ===========================================================================
  // Persistent Agents
  // ===========================================================================

  /**
   * Get a persistent agent by name.
   * Returns the most recent execution for this agent name where persistent=1.
   * Used to detect if a named persistent agent already exists (for restart/reattach).
   */
  getPersistentAgent(agentName: string): MachineExecution | null {
    const row = this.db.prepare<ExecutionRow>(
      'SELECT * FROM executions WHERE agent_name = ? AND persistent = 1 ORDER BY started_at DESC LIMIT 1'
    ).get(agentName)
    return row ? rowToExecution(row) : null
  }

  /**
   * List all persistent agents.
   * Returns the most recent execution per unique agent name where persistent=1.
   */
  listPersistentAgents(): MachineExecution[] {
    const rows = this.db.prepare(
      `SELECT * FROM executions
       WHERE persistent = 1
         AND id IN (
           SELECT id FROM executions e2
           WHERE e2.agent_name = executions.agent_name AND e2.persistent = 1
           ORDER BY e2.started_at DESC
           LIMIT 1
         )
       ORDER BY started_at DESC`
    ).all() as unknown as ExecutionRow[]
    return rows.map(rowToExecution)
  }

  /**
   * Get all persistent agents that should be running but have died.
   * These are candidates for automatic restart.
   */
  getDiedPersistentAgents(): MachineExecution[] {
    const rows = this.db.prepare(
      `SELECT e.* FROM executions e
       LEFT JOIN agent_health h ON e.id = h.execution_id
       WHERE e.persistent = 1
         AND e.status IN ('failed', 'stopped')
         AND (h.lifecycle_state IS NULL OR h.lifecycle_state = 'died')
       ORDER BY e.started_at DESC`
    ).all() as unknown as ExecutionRow[]
    return rows.map(rowToExecution)
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

  // ===========================================================================
  // Messaging gateway (PRLT-1255)
  // ===========================================================================

  /**
   * Insert or replace a registered messaging channel.
   *
   * Channels are keyed by `name` (e.g. "telegram"). Re-registering the
   * same channel updates its config and marks it active — this is what
   * `prlt gateway connect` does on repeat calls.
   */
  upsertMessagingChannel(params: {
    name: string
    type: string
    configJson: string
    active?: boolean
  }): void {
    const active = params.active === false ? 0 : 1
    this.db.prepare(`
      INSERT INTO messaging_channels (name, type, config_json, active, last_message_at)
      VALUES (?, ?, ?, ?, NULL)
      ON CONFLICT(name) DO UPDATE SET
        type = excluded.type,
        config_json = excluded.config_json,
        active = excluded.active
    `).run(params.name, params.type, params.configJson, active)
  }

  /** Look up a single channel by name. */
  getMessagingChannel(name: string): MessagingChannelRecord | null {
    const row = this.db.prepare<MessagingChannelRow>(
      'SELECT * FROM messaging_channels WHERE name = ?'
    ).get(name)
    return row ? messagingChannelRowToRecord(row) : null
  }

  /**
   * List channels. When `onlyActive` is true (the default), only channels
   * with `active = 1` are returned — this is what the gateway daemon
   * uses at startup.
   */
  listMessagingChannels(options?: { onlyActive?: boolean }): MessagingChannelRecord[] {
    const onlyActive = options?.onlyActive !== false
    const rows = onlyActive
      ? (this.db.prepare(
          'SELECT * FROM messaging_channels WHERE active = 1 ORDER BY name ASC'
        ).all() as unknown as MessagingChannelRow[])
      : (this.db.prepare(
          'SELECT * FROM messaging_channels ORDER BY name ASC'
        ).all() as unknown as MessagingChannelRow[])
    return rows.map(messagingChannelRowToRecord)
  }

  /** Mark a channel inactive (keeps config around for re-enable). */
  setMessagingChannelActive(name: string, active: boolean): void {
    this.db.prepare(
      'UPDATE messaging_channels SET active = ? WHERE name = ?'
    ).run(active ? 1 : 0, name)
  }

  /** Remove a channel's registration entirely. */
  deleteMessagingChannel(name: string): void {
    this.db.prepare('DELETE FROM messaging_channels WHERE name = ?').run(name)
  }

  /**
   * Stamp a channel's `last_message_at` to now — called each time the
   * router successfully routes an inbound message. Used by
   * `prlt gateway status` to show channel activity.
   */
  touchMessagingChannel(name: string, timestamp: number = Date.now()): void {
    this.db.prepare(
      'UPDATE messaging_channels SET last_message_at = ? WHERE name = ?'
    ).run(timestamp, name)
  }

  // ---------------------------------------------------------------------------
  // Routes — (channel, user) → agent session
  // ---------------------------------------------------------------------------

  /** Look up an existing route, or null if this user has never been seen. */
  getMessagingRoute(channel: string, userId: string): MessagingRouteRecord | null {
    const row = this.db.prepare<MessagingRouteRow>(
      'SELECT * FROM messaging_routes WHERE channel = ? AND user_id = ?'
    ).get(channel, userId)
    return row ? messagingRouteRowToRecord(row) : null
  }

  /**
   * Bind a `(channel, user)` pair to an agent session. Idempotent — if a
   * binding already exists it is updated to point at the new agent.
   */
  upsertMessagingRoute(params: {
    channel: string
    userId: string
    agentSessionId: string
  }): MessagingRouteRecord {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO messaging_routes (channel, user_id, agent_session_id, created_at, last_used_at)
      VALUES (?, ?, ?, ?, NULL)
      ON CONFLICT(channel, user_id) DO UPDATE SET
        agent_session_id = excluded.agent_session_id
    `).run(params.channel, params.userId, params.agentSessionId, now)
    return this.getMessagingRoute(params.channel, params.userId)!
  }

  /** Stamp `last_used_at` to now — called every time a route is used. */
  touchMessagingRoute(channel: string, userId: string, timestamp: number = Date.now()): void {
    this.db.prepare(
      'UPDATE messaging_routes SET last_used_at = ? WHERE channel = ? AND user_id = ?'
    ).run(timestamp, channel, userId)
  }

  /** List routes for a channel (or all channels when `channel` omitted). */
  listMessagingRoutes(channel?: string): MessagingRouteRecord[] {
    const rows = channel
      ? (this.db.prepare(
          'SELECT * FROM messaging_routes WHERE channel = ? ORDER BY created_at DESC'
        ).all(channel) as unknown as MessagingRouteRow[])
      : (this.db.prepare(
          'SELECT * FROM messaging_routes ORDER BY created_at DESC'
        ).all() as unknown as MessagingRouteRow[])
    return rows.map(messagingRouteRowToRecord)
  }

  /** Count messages handled by a channel since `since` (for status output). */
  countMessagingRoutesForChannel(channel: string): number {
    const row = this.db.prepare<{ n: number }>(
      'SELECT COUNT(*) AS n FROM messaging_routes WHERE channel = ?'
    ).get(channel)
    return row?.n ?? 0
  }

  // ===========================================================================
  // Orchestrator threads (PRLT-1265)
  // ===========================================================================

  /**
   * Register an orchestrator thread. If one with the same name already exists,
   * it is replaced (the orchestrator was restarted).
   */
  registerThread(params: {
    name: string
    address: string
    routes?: string[]
    status?: OrchestratorThreadStatus
  }): OrchestratorThreadRecord {
    const now = Date.now()
    const routesStr = params.routes?.length ? params.routes.join(',') : null
    this.db.prepare(`
      INSERT INTO orchestrator_threads (name, address, routes, status, registered_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        address = excluded.address,
        routes = excluded.routes,
        status = excluded.status,
        last_seen = excluded.last_seen
    `).run(params.name, params.address, routesStr, params.status ?? 'active', now, now)
    return this.getThread(params.name)!
  }

  /** Get a single thread by name. */
  getThread(name: string): OrchestratorThreadRecord | null {
    const row = this.db.prepare<OrchestratorThreadRow>(
      'SELECT * FROM orchestrator_threads WHERE name = ?'
    ).get(name)
    return row ? threadRowToRecord(row) : null
  }

  /** List all threads, optionally filtering by status. */
  listThreads(filter?: { status?: OrchestratorThreadStatus }): OrchestratorThreadRecord[] {
    if (filter?.status) {
      const rows = this.db.prepare(
        'SELECT * FROM orchestrator_threads WHERE status = ? ORDER BY registered_at DESC'
      ).all(filter.status) as unknown as OrchestratorThreadRow[]
      return rows.map(threadRowToRecord)
    }
    const rows = this.db.prepare(
      'SELECT * FROM orchestrator_threads ORDER BY registered_at DESC'
    ).all() as unknown as OrchestratorThreadRow[]
    return rows.map(threadRowToRecord)
  }

  /** Update a thread's status (active/inactive). */
  updateThreadStatus(name: string, status: OrchestratorThreadStatus): void {
    this.db.prepare(
      'UPDATE orchestrator_threads SET status = ?, last_seen = ? WHERE name = ?'
    ).run(status, Date.now(), name)
  }

  /** Stamp a thread's last_seen to now — called on heartbeat/poke. */
  touchThread(name: string): void {
    this.db.prepare(
      'UPDATE orchestrator_threads SET last_seen = ? WHERE name = ?'
    ).run(Date.now(), name)
  }

  /** Remove a thread registration entirely. */
  removeThread(name: string): void {
    this.db.prepare('DELETE FROM orchestrator_threads WHERE name = ?').run(name)
  }

  /**
   * Find the orchestrator thread that handles a given event name.
   * Checks routes (comma-separated event lists). A thread with NULL routes
   * is the catch-all (matches any event not claimed by a specific thread).
   * Returns the most specific match first, falling back to catch-all.
   */
  findThreadForEvent(eventName: string): OrchestratorThreadRecord | null {
    // First try to find a thread with an explicit route for this event
    const rows = this.db.prepare(
      "SELECT * FROM orchestrator_threads WHERE status = 'active' ORDER BY registered_at ASC"
    ).all() as unknown as OrchestratorThreadRow[]

    let catchAll: OrchestratorThreadRow | null = null
    for (const row of rows) {
      if (!row.routes) {
        // NULL routes = catch-all
        if (!catchAll) catchAll = row
        continue
      }
      const routeList = row.routes.split(',').map(r => r.trim())
      if (routeList.includes(eventName)) {
        return threadRowToRecord(row)
      }
    }
    return catchAll ? threadRowToRecord(catchAll) : null
  }

  // ===========================================================================
  // Pending LLM decisions (PRLT-1265)
  // ===========================================================================

  /**
   * Queue a new pending LLM decision. Returns the created record.
   */
  createPendingLlmDecision(params: {
    eventName: string
    hookName: string
    action: string
    contextJson?: string
    orchestratorName?: string
    timeoutMs?: number
  }): PendingLlmDecisionRecord {
    const id = `LLMD-${randomUUID().substring(0, 8).toUpperCase()}`
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO pending_llm_decisions (
        id, event_name, hook_name, action, context_json,
        status, orchestrator_name, queued_at, timeout_ms
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      id,
      params.eventName,
      params.hookName,
      params.action,
      params.contextJson ?? '{}',
      params.orchestratorName ?? null,
      now,
      params.timeoutMs ?? 300000,
    )
    return this.getPendingLlmDecision(id)!
  }

  /** Get a single pending decision by ID. */
  getPendingLlmDecision(id: string): PendingLlmDecisionRecord | null {
    const row = this.db.prepare<PendingLlmDecisionRow>(
      'SELECT * FROM pending_llm_decisions WHERE id = ?'
    ).get(id)
    return row ? llmDecisionRowToRecord(row) : null
  }

  /** List pending decisions (optionally filtered by status). */
  listPendingLlmDecisions(filter?: { status?: LlmDecisionStatus }): PendingLlmDecisionRecord[] {
    if (filter?.status) {
      const rows = this.db.prepare(
        'SELECT * FROM pending_llm_decisions WHERE status = ? ORDER BY queued_at DESC'
      ).all(filter.status) as unknown as PendingLlmDecisionRow[]
      return rows.map(llmDecisionRowToRecord)
    }
    const rows = this.db.prepare(
      'SELECT * FROM pending_llm_decisions ORDER BY queued_at DESC'
    ).all() as unknown as PendingLlmDecisionRow[]
    return rows.map(llmDecisionRowToRecord)
  }

  /** Resolve a pending decision (approve, deny, escalate). */
  resolveLlmDecision(id: string, decision: LlmDecisionStatus): void {
    this.db.prepare(`
      UPDATE pending_llm_decisions
      SET status = ?, decision = ?, resolved_at = ?
      WHERE id = ?
    `).run(decision, decision, Date.now(), id)
  }

  /**
   * Find and mark timed-out pending decisions.
   * Returns the count of decisions that were escalated.
   */
  escalateTimedOutDecisions(): number {
    const now = Date.now()
    const result = this.db.prepare(`
      UPDATE pending_llm_decisions
      SET status = 'timed_out', resolved_at = ?
      WHERE status = 'pending' AND (queued_at + timeout_ms) < ?
    `).run(now, now)
    return (result as { changes: number }).changes ?? 0
  }

  close(): void {
    this.db.close()
  }
}

// =============================================================================
// Row → record converters for messaging tables
// =============================================================================

function messagingChannelRowToRecord(row: MessagingChannelRow): MessagingChannelRecord {
  return {
    name: row.name,
    type: row.type,
    configJson: row.config_json,
    active: row.active === 1,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : undefined,
  }
}

function messagingRouteRowToRecord(row: MessagingRouteRow): MessagingRouteRecord {
  return {
    channel: row.channel,
    userId: row.user_id,
    agentSessionId: row.agent_session_id,
    createdAt: new Date(row.created_at),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
  }
}

// =============================================================================
// Row → record converters for orchestrator tables (PRLT-1265)
// =============================================================================

function threadRowToRecord(row: OrchestratorThreadRow): OrchestratorThreadRecord {
  return {
    name: row.name,
    address: row.address,
    routes: row.routes ? row.routes.split(',').map(r => r.trim()).filter(Boolean) : null,
    status: row.status as OrchestratorThreadStatus,
    registeredAt: new Date(row.registered_at),
    lastSeen: new Date(row.last_seen),
  }
}

function llmDecisionRowToRecord(row: PendingLlmDecisionRow): PendingLlmDecisionRecord {
  return {
    id: row.id,
    eventName: row.event_name,
    hookName: row.hook_name,
    action: row.action,
    contextJson: row.context_json,
    status: row.status as LlmDecisionStatus,
    orchestratorName: row.orchestrator_name,
    queuedAt: new Date(row.queued_at),
    timeoutMs: row.timeout_ms,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
    decision: row.decision,
  }
}
