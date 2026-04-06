/**
 * Machine-level Agent Registry
 *
 * Tracks all agents across all projects in a single SQLite database
 * at ~/.prlt/agents.db. This provides a global view of agent activity
 * regardless of which workspace they belong to.
 */

import { type DatabaseDriver, openDriver } from '../database/driver.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { throwIfNativeBindingError } from '../database/native-validation.js'

// =============================================================================
// Types
// =============================================================================

export type MachineAgentStatus = 'running' | 'idle' | 'completed'

export interface MachineAgent {
  agentName: string
  projectPath: string
  sessionId: string | null
  ticketId: string | null
  status: MachineAgentStatus
  spawnedAt: string
  lastSeenAt: string
}

interface MachineAgentRow {
  agent_name: string
  project_path: string
  session_id: string | null
  ticket_id: string | null
  status: string
  spawned_at: string
  last_seen_at: string
}

// =============================================================================
// Schema
// =============================================================================

const REGISTRY_SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  agent_name TEXT NOT NULL,
  project_path TEXT NOT NULL,
  session_id TEXT,
  ticket_id TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'idle', 'completed')),
  spawned_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (agent_name, project_path)
);

CREATE INDEX IF NOT EXISTS idx_registry_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_registry_project ON agents(project_path);
`

// =============================================================================
// Helpers
// =============================================================================

function rowToMachineAgent(row: MachineAgentRow): MachineAgent {
  return {
    agentName: row.agent_name,
    projectPath: row.project_path,
    sessionId: row.session_id,
    ticketId: row.ticket_id,
    status: row.status as MachineAgentStatus,
    spawnedAt: row.spawned_at,
    lastSeenAt: row.last_seen_at,
  }
}

function getMachineRegistryPath(): string {
  return path.join(os.homedir(), '.prlt', 'agents.db')
}

// =============================================================================
// Database Access
// =============================================================================

/**
 * Open (or create) the machine-level agent registry at ~/.prlt/agents.db.
 * Ensures the ~/.prlt directory and schema exist.
 */
export function openMachineRegistry(): DatabaseDriver {
  const dbPath = getMachineRegistryPath()
  const dir = path.dirname(dbPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  try {
    const driver = openDriver(dbPath, { foreignKeys: false, busyTimeout: 3000 })
    driver.exec(REGISTRY_SCHEMA)
    return driver
  } catch (error) {
    throwIfNativeBindingError(error, 'machine agent registry')
    throw error
  }
}

// =============================================================================
// Write Operations
// =============================================================================

/**
 * Register an agent spawn in the machine registry.
 * Uses INSERT OR REPLACE so re-spawning the same agent updates the record.
 */
export function registerAgent(params: {
  agentName: string
  projectPath: string
  sessionId?: string
  ticketId?: string
}): void {
  const db = openMachineRegistry()
  try {
    const now = new Date().toISOString()
    db.prepare(`
      INSERT OR REPLACE INTO agents (agent_name, project_path, session_id, ticket_id, status, spawned_at, last_seen_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?)
    `).run(
      params.agentName,
      params.projectPath,
      params.sessionId ?? null,
      params.ticketId ?? null,
      now,
      now,
    )
  } finally {
    db.close()
  }
}

/**
 * Update the status of an agent in the machine registry.
 */
export function updateAgentStatus(
  agentName: string,
  projectPath: string,
  status: MachineAgentStatus,
): void {
  const db = openMachineRegistry()
  try {
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE agents SET status = ?, last_seen_at = ?
      WHERE agent_name = ? AND project_path = ?
    `).run(status, now, agentName, projectPath)
  } finally {
    db.close()
  }
}

/**
 * Touch the last_seen_at timestamp for a running agent.
 */
export function touchAgentLastSeen(
  agentName: string,
  projectPath: string,
): void {
  const db = openMachineRegistry()
  try {
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE agents SET last_seen_at = ?
      WHERE agent_name = ? AND project_path = ?
    `).run(now, agentName, projectPath)
  } finally {
    db.close()
  }
}

// =============================================================================
// Read Operations
// =============================================================================

/**
 * Get all agents in the machine registry, optionally filtered.
 */
export function getMachineAgents(filters?: {
  status?: MachineAgentStatus
  projectPath?: string
}): MachineAgent[] {
  const db = openMachineRegistry()
  try {
    let sql = 'SELECT * FROM agents'
    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.status) {
      conditions.push('status = ?')
      params.push(filters.status)
    }
    if (filters?.projectPath) {
      conditions.push('project_path = ?')
      params.push(filters.projectPath)
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    sql += ' ORDER BY last_seen_at DESC'

    const rows = db.prepare<MachineAgentRow>(sql).all(...params)
    return rows.map(rowToMachineAgent)
  } finally {
    db.close()
  }
}

/**
 * Get a single agent by name and project path.
 */
export function getMachineAgent(
  agentName: string,
  projectPath: string,
): MachineAgent | undefined {
  const db = openMachineRegistry()
  try {
    const row = db.prepare<MachineAgentRow>(
      'SELECT * FROM agents WHERE agent_name = ? AND project_path = ?'
    ).get(agentName, projectPath)
    return row ? rowToMachineAgent(row) : undefined
  } finally {
    db.close()
  }
}
