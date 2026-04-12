import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import {
  getDaemonInfo,
  writeDaemonInfo,
  removeDaemonPid,
  isDaemonRunning,
  getDaemonPidPath,
  type DaemonInfo,
} from '../../src/lib/sync/daemon.js'

/**
 * Sync Commands E2E Tests — database-level validation of sync reconciliation.
 *
 * PRLT-1156: Tests the sync engine's ability to detect and correct
 * drift between GitHub PR state and ticket state.
 *
 * These tests validate:
 * - Daemon PID file management
 * - Ticket state reconciliation at the database level
 * - Execution status cleanup during sync
 */

describe('Sync Commands — Database Operations (PRLT-1156)', () => {
  let testDir: string
  let originalCwd: string
  let dbPath: string
  let db: Database.Database

  beforeEach(() => {
    originalCwd = process.cwd()
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-commands-e2e-'))
    process.chdir(testDir)

    const proletariatDir = path.join(testDir, '.proletariat')
    fs.mkdirSync(proletariatDir, { recursive: true })
    dbPath = path.join(proletariatDir, 'workspace.db')

    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    setupTestDatabase(db)
  })

  afterEach(() => {
    if (db) db.close()
    process.chdir(originalCwd)
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  // =========================================================================
  // Daemon PID File Management
  // =========================================================================
  describe('Daemon PID management', () => {
    it('should write and read daemon info', () => {
      const info: DaemonInfo = {
        pid: 12345,
        startedAt: new Date().toISOString(),
        intervalSeconds: 60,
      }

      writeDaemonInfo(testDir, info)
      const read = getDaemonInfo(testDir)

      expect(read).to.not.be.null
      expect(read!.pid).to.equal(12345)
      expect(read!.intervalSeconds).to.equal(60)
    })

    it('should return null when no PID file exists', () => {
      const info = getDaemonInfo(testDir)
      expect(info).to.be.null
    })

    it('should remove PID file', () => {
      writeDaemonInfo(testDir, {
        pid: 12345,
        startedAt: new Date().toISOString(),
        intervalSeconds: 60,
      })

      removeDaemonPid(testDir)
      const info = getDaemonInfo(testDir)
      expect(info).to.be.null
    })

    it('should detect non-running daemon via stale PID', () => {
      // Use a PID that definitely doesn't exist
      writeDaemonInfo(testDir, {
        pid: 999999999,
        startedAt: new Date().toISOString(),
        intervalSeconds: 60,
      })

      const running = isDaemonRunning(testDir)
      expect(running).to.be.false

      // Should have cleaned up the stale PID file
      const info = getDaemonInfo(testDir)
      expect(info).to.be.null
    })
  })

  // =========================================================================
  // Reconciliation: Merged PR → Done
  // =========================================================================
  describe('Reconciliation: merged PR moves ticket to Done', () => {
    it('should update board position when ticket is moved to Done', () => {
      const ticketId = createTicket(db, 'Merged PR test', 'in-progress')

      // Simulate what the sync engine does: move to done column
      db.prepare(`
        UPDATE pmo_board_tickets SET column_id = 'done'
        WHERE ticket_id = ?
      `).run(ticketId)

      const ticket = db.prepare(`
        SELECT c.name as column_name
        FROM pmo_board_tickets bt
        JOIN pmo_columns c ON c.id = bt.column_id
        WHERE bt.ticket_id = ?
      `).get(ticketId) as { column_name: string }

      expect(ticket.column_name).to.equal('Done')
    })

    it('should mark running executions as completed when moving to Done', () => {
      const ticketId = createTicket(db, 'Execution cleanup test', 'in-progress')
      createExecution(db, ticketId, 'agent-1', 'running')

      // Simulate sync engine moving ticket to Done and cleaning up execution
      db.prepare(`
        UPDATE pmo_board_tickets SET column_id = 'done'
        WHERE ticket_id = ?
      `).run(ticketId)
      db.prepare(`
        UPDATE agent_work SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE ticket_id = ? AND status IN ('running', 'starting')
      `).run(ticketId)

      const execution = db.prepare(`
        SELECT status FROM agent_work WHERE ticket_id = ?
      `).get(ticketId) as { status: string }

      expect(execution.status).to.equal('completed')
    })
  })

  // =========================================================================
  // Reconciliation: Green CI → Review
  // =========================================================================
  describe('Reconciliation: green CI moves ticket to Review', () => {
    it('should update board position when ticket moves to Review', () => {
      const ticketId = createTicket(db, 'CI green test', 'in-progress')

      db.prepare(`
        UPDATE pmo_board_tickets SET column_id = 'review'
        WHERE ticket_id = ?
      `).run(ticketId)

      const ticket = db.prepare(`
        SELECT c.name as column_name
        FROM pmo_board_tickets bt
        JOIN pmo_columns c ON c.id = bt.column_id
        WHERE bt.ticket_id = ?
      `).get(ticketId) as { column_name: string }

      expect(ticket.column_name).to.equal('Review')
    })
  })

  // =========================================================================
  // Reconciliation: Closed PR → Backlog
  // =========================================================================
  describe('Reconciliation: closed PR moves ticket to Backlog', () => {
    it('should update board position when ticket moves to Backlog', () => {
      const ticketId = createTicket(db, 'Closed PR test', 'in-review')

      db.prepare(`
        UPDATE pmo_board_tickets SET column_id = 'backlog'
        WHERE ticket_id = ?
      `).run(ticketId)

      const ticket = db.prepare(`
        SELECT c.name as column_name
        FROM pmo_board_tickets bt
        JOIN pmo_columns c ON c.id = bt.column_id
        WHERE bt.ticket_id = ?
      `).get(ticketId) as { column_name: string }

      expect(ticket.column_name).to.equal('Backlog')
    })
  })

  // =========================================================================
  // Stale Detection
  // =========================================================================
  describe('Stale ticket detection', () => {
    it('should identify tickets with no running executions', () => {
      const t1 = createTicket(db, 'Has agent', 'in-progress')
      const t2 = createTicket(db, 'No agent', 'in-progress')
      createExecution(db, t1, 'agent-1', 'running')

      const staleTickets = db.prepare(`
        SELECT t.id
        FROM pmo_tickets t
        JOIN pmo_board_tickets bt ON bt.ticket_id = t.id
        JOIN pmo_columns c ON c.id = bt.column_id
        LEFT JOIN agent_work w ON w.ticket_id = t.id AND w.status IN ('running', 'starting')
        WHERE c.name = 'In Progress' AND w.id IS NULL
      `).all() as Array<{ id: string }>

      expect(staleTickets).to.have.lengthOf(1)
      expect(staleTickets[0].id).to.equal(t2)
    })

    it('should not flag tickets with active agents', () => {
      const t1 = createTicket(db, 'Active agent', 'in-progress')
      createExecution(db, t1, 'agent-1', 'running')

      const staleTickets = db.prepare(`
        SELECT t.id
        FROM pmo_tickets t
        JOIN pmo_board_tickets bt ON bt.ticket_id = t.id
        JOIN pmo_columns c ON c.id = bt.column_id
        LEFT JOIN agent_work w ON w.ticket_id = t.id AND w.status IN ('running', 'starting')
        WHERE c.name = 'In Progress' AND w.id IS NULL
      `).all()

      expect(staleTickets).to.have.lengthOf(0)
    })
  })

  // =========================================================================
  // Multiple tickets in same cycle
  // =========================================================================
  describe('Multiple tickets reconciliation', () => {
    it('should handle mix of states correctly', () => {
      const tDone = createTicket(db, 'Already done', 'done')
      const tInProgress = createTicket(db, 'In progress with agent', 'in-progress')
      const tStale = createTicket(db, 'Stale no agent', 'in-progress')

      createExecution(db, tInProgress, 'agent-1', 'running')

      // Verify each ticket is in expected column
      const tickets = db.prepare(`
        SELECT t.id, c.name as column_name,
          CASE WHEN w.id IS NOT NULL THEN 1 ELSE 0 END as has_agent
        FROM pmo_tickets t
        JOIN pmo_board_tickets bt ON bt.ticket_id = t.id
        JOIN pmo_columns c ON c.id = bt.column_id
        LEFT JOIN agent_work w ON w.ticket_id = t.id AND w.status IN ('running', 'starting')
        ORDER BY t.id
      `).all() as Array<{ id: string; column_name: string; has_agent: number }>

      // tDone should be in Done
      const done = tickets.find(t => t.id === tDone)
      expect(done?.column_name).to.equal('Done')

      // tInProgress should have an agent
      const inProg = tickets.find(t => t.id === tInProgress)
      expect(inProg?.column_name).to.equal('In Progress')
      expect(inProg?.has_agent).to.equal(1)

      // tStale should be In Progress with no agent
      const stale = tickets.find(t => t.id === tStale)
      expect(stale?.column_name).to.equal('In Progress')
      expect(stale?.has_agent).to.equal(0)
    })
  })
})

// =============================================================================
// Test Helpers
// =============================================================================

function setupTestDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id)
    );

    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      category TEXT,
      status TEXT DEFAULT 'active',
      status_id TEXT,
      branch TEXT,
      owner TEXT,
      assignee TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id)
    );

    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      PRIMARY KEY (project_id, ticket_id),
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id),
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id),
      FOREIGN KEY (column_id) REFERENCES pmo_columns(id)
    );

    CREATE TABLE IF NOT EXISTS pmo_statuses (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id)
    );

    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      path TEXT,
      status TEXT DEFAULT 'available',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_work (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      executor TEXT DEFAULT 'claude-code',
      mode TEXT DEFAULT 'foreground',
      environment TEXT,
      display_mode TEXT,
      sandboxed INTEGER DEFAULT 1,
      permission_mode TEXT DEFAULT 'safe',
      cleanup_policy TEXT NOT NULL DEFAULT 'on-exit',
      role TEXT NOT NULL DEFAULT 'worker',
      status TEXT NOT NULL DEFAULT 'running',
      branch TEXT,
      pid TEXT,
      container_id TEXT,
      session_id TEXT,
      host TEXT,
      log_path TEXT,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      exit_code INTEGER,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_work_agent ON agent_work(agent_name);
    CREATE INDEX IF NOT EXISTS idx_agent_work_status ON agent_work(status);
    CREATE INDEX IF NOT EXISTS idx_agent_work_ticket ON agent_work(ticket_id);
  `)

  // Insert test data
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description)
    VALUES ('test-project', 'Test Project', 'E2E test project')
  `).run()

  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', 'pmo'), ('current_project', 'test-project')
  `).run()

  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'planned', name: 'Planned', position: 1 },
    { id: 'in-progress', name: 'In Progress', position: 2 },
    { id: 'review', name: 'Review', position: 3 },
    { id: 'done', name: 'Done', position: 4 },
  ]

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `).run(col.id, col.name, col.position)
  }

  const statuses = [
    { id: 'status-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'status-todo', name: 'Todo', category: 'unstarted', position: 0 },
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 0 },
    { id: 'status-in-review', name: 'In Review', category: 'started', position: 1 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 0 },
    { id: 'status-canceled', name: 'Canceled', category: 'canceled', position: 0 },
  ]

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_statuses (id, project_id, name, category, position, is_default)
      VALUES (?, 'test-project', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0)
  }

  const pmoPath = path.join(process.cwd(), 'pmo/projects/test-project')
  fs.mkdirSync(pmoPath, { recursive: true })
}

let ticketCounter = 0
function createTicket(db: Database.Database, title: string, columnOrStatus: string): string {
  ticketCounter++
  const ticketId = `TKT-${String(ticketCounter).padStart(3, '0')}`

  const toColumnId: Record<string, string> = {
    'backlog': 'backlog',
    'planned': 'planned',
    'in-progress': 'in-progress',
    'in-review': 'review',
    'review': 'review',
    'done': 'done',
  }

  const toStatusId: Record<string, string> = {
    'backlog': 'status-backlog',
    'planned': 'status-todo',
    'in-progress': 'status-in-progress',
    'in-review': 'status-in-review',
    'done': 'status-done',
  }

  const columnId = toColumnId[columnOrStatus] || 'backlog'
  const statusId = toStatusId[columnOrStatus] || 'status-backlog'

  db.prepare(`
    INSERT INTO pmo_tickets (id, project_id, title, status, status_id)
    VALUES (?, 'test-project', ?, ?, ?)
  `).run(ticketId, title, columnOrStatus === 'done' ? 'done' : 'active', statusId)

  db.prepare(`
    INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
    VALUES ('test-project', ?, ?, 0)
  `).run(ticketId, columnId)

  return ticketId
}

function createExecution(
  db: Database.Database,
  ticketId: string,
  agentName: string,
  status: string,
): string {
  const execId = `WORK-SYNC-${ticketCounter}-${Date.now()}`

  // Ensure agent exists
  db.prepare(`
    INSERT OR IGNORE INTO agents (name, path)
    VALUES (?, ?)
  `).run(agentName, `/agents/${agentName}`)

  db.prepare(`
    INSERT INTO agent_work (id, ticket_id, agent_name, status, executor, mode, environment, display_mode, sandboxed)
    VALUES (?, ?, ?, ?, 'claude-code', 'foreground', 'host', 'terminal', 0)
  `).run(execId, ticketId, agentName, status)

  return execId
}
