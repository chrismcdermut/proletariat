/**
 * Global Session Store
 *
 * Tracks agent sessions across all repos on the machine.
 * Works without HQ / PMO — just needs ~/.proletariat/sessions.db.
 *
 * Schema: id, agentName, runner, task, workdir, sessionName,
 *         environment, permissionMode, status, startedAt, endedAt
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { type DatabaseDriver, openDriver } from './database/driver.js'
import { execSync } from 'node:child_process'

// =============================================================================
// Types
// =============================================================================

export type SessionRole = 'worker' | 'orchestrator' | 'daemon' | 'headless'

export interface SessionRecord {
  id: string
  agentName: string
  runner: string
  task: string
  workdir: string
  sessionName: string
  environment: 'host' | 'docker' | 'podman'
  permissionMode: 'danger' | 'safe'
  role: SessionRole
  status: 'running' | 'done' | 'error' | 'stopped'
  startedAt: Date
  endedAt?: Date
}

interface SessionRow {
  id: string
  agent_name: string
  runner: string
  task: string
  workdir: string
  session_name: string
  environment: string
  permission_mode: string
  role: string
  status: string
  started_at: number
  ended_at: number | null
}

// =============================================================================
// Helpers
// =============================================================================

function rowToSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    agentName: row.agent_name,
    runner: row.runner,
    task: row.task,
    workdir: row.workdir,
    sessionName: row.session_name,
    environment: row.environment as SessionRecord['environment'],
    permissionMode: row.permission_mode as SessionRecord['permissionMode'],
    role: (row.role || 'worker') as SessionRole,
    status: row.status as SessionRecord['status'],
    startedAt: new Date(row.started_at),
    endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
  }
}

function getDbPath(): string {
  const dir = path.join(os.homedir(), '.proletariat')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'sessions.db')
}

// =============================================================================
// Session Store
// =============================================================================

export class SessionStore {
  private db: DatabaseDriver

  constructor(dbPath?: string) {
    this.db = openDriver(dbPath ?? getDbPath(), { foreignKeys: false })
    this.ensureSchema()
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        runner TEXT NOT NULL,
        task TEXT NOT NULL,
        workdir TEXT NOT NULL,
        session_name TEXT NOT NULL,
        environment TEXT NOT NULL DEFAULT 'host',
        permission_mode TEXT NOT NULL DEFAULT 'safe',
        role TEXT NOT NULL DEFAULT 'worker',
        status TEXT NOT NULL DEFAULT 'running',
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      )
    `)

    // Migration: add role column to existing databases
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'worker'`)
    } catch {
      // Column already exists — expected for new databases
    }
  }

  /**
   * Create a new session record.
   */
  create(params: {
    agentName: string
    runner: string
    task: string
    workdir: string
    sessionName: string
    environment: SessionRecord['environment']
    permissionMode: SessionRecord['permissionMode']
    role?: SessionRole
  }): SessionRecord {
    const id = `SES-${Date.now().toString(36).toUpperCase()}`
    const now = Date.now()
    const role = params.role || 'worker'

    this.db.prepare(`
      INSERT INTO sessions (id, agent_name, runner, task, workdir, session_name, environment, permission_mode, role, status, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
    `).run(id, params.agentName, params.runner, params.task, params.workdir, params.sessionName, params.environment, params.permissionMode, role, now)

    return {
      id,
      agentName: params.agentName,
      runner: params.runner,
      task: params.task,
      workdir: params.workdir,
      sessionName: params.sessionName,
      environment: params.environment,
      permissionMode: params.permissionMode,
      role,
      status: 'running',
      startedAt: new Date(now),
    }
  }

  /**
   * Get a session by ID or agent name.
   */
  get(idOrName: string): SessionRecord | null {
    const row = this.db.prepare<SessionRow>(
      `SELECT * FROM sessions WHERE id = ? OR agent_name = ? ORDER BY started_at DESC LIMIT 1`
    ).get(idOrName, idOrName)

    return row ? rowToSession(row) : null
  }

  /**
   * Get a session by tmux session name.
   */
  getBySessionName(sessionName: string): SessionRecord | null {
    const row = this.db.prepare<SessionRow>(
      `SELECT * FROM sessions WHERE session_name = ? ORDER BY started_at DESC LIMIT 1`
    ).get(sessionName)

    return row ? rowToSession(row) : null
  }

  /**
   * List sessions, optionally filtered by status.
   */
  list(status?: SessionRecord['status']): SessionRecord[] {
    let rows: SessionRow[]
    if (status) {
      rows = this.db.prepare<SessionRow>(
        `SELECT * FROM sessions WHERE status = ? ORDER BY started_at DESC`
      ).all(status)
    } else {
      rows = this.db.prepare<SessionRow>(
        `SELECT * FROM sessions ORDER BY started_at DESC`
      ).all()
    }

    return rows.map(rowToSession)
  }

  /**
   * Update session status.
   */
  updateStatus(id: string, status: SessionRecord['status']): void {
    const endedAt = (status === 'done' || status === 'error' || status === 'stopped') ? Date.now() : null
    this.db.prepare(
      `UPDATE sessions SET status = ?, ended_at = COALESCE(?, ended_at) WHERE id = ?`
    ).run(status, endedAt, id)
  }

  /**
   * Reconcile session statuses with actual tmux sessions.
   * Marks sessions as 'done' if their tmux session no longer exists.
   */
  reconcile(): void {
    const running = this.list('running')
    for (const session of running) {
      if (!this.isTmuxSessionAlive(session.sessionName)) {
        this.updateStatus(session.id, 'done')
      }
    }
  }

  /**
   * Resolve an identifier to a session.
   * Tries: exact ID match, agent name, partial match on agent name or session name.
   */
  resolve(identifier: string): SessionRecord | null {
    // Exact ID match
    const byId = this.get(identifier)
    if (byId) return byId

    // Partial agent name match (prefer running sessions)
    const allSessions = this.list()
    const running = allSessions.filter(s => s.status === 'running')
    const pool = running.length > 0 ? running : allSessions

    const match = pool.find(s =>
      s.agentName.includes(identifier) ||
      s.sessionName.includes(identifier) ||
      s.id.includes(identifier.toUpperCase())
    )
    return match ?? null
  }

  /**
   * Check if a tmux session is alive.
   */
  private isTmuxSessionAlive(sessionName: string): boolean {
    try {
      execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`, { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  /**
   * List running sessions filtered by role.
   */
  listByRole(role: SessionRole): SessionRecord[] {
    const rows = this.db.prepare<SessionRow>(
      `SELECT * FROM sessions WHERE role = ? AND status = 'running' ORDER BY started_at DESC`
    ).all(role)
    return rows.map(rowToSession)
  }

  /**
   * Check if a daemon session with the given name is running.
   */
  isDaemonRunning(sessionName: string): boolean {
    const row = this.db.prepare<SessionRow>(
      `SELECT * FROM sessions WHERE session_name = ? AND role = 'daemon' AND status = 'running' ORDER BY started_at DESC LIMIT 1`
    ).get(sessionName)
    return !!row
  }

  close(): void {
    this.db.close()
  }
}
