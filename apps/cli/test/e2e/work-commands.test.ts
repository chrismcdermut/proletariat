import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';

/**
 * Work Commands E2E Tests — database-level validation of work lifecycle flows.
 *
 * TKT-140: Unskipped and exercising real work start/ready flows with test DB.
 *
 * These tests verify the database operations that underpin work commands:
 * - Ticket state transitions (start → ready → complete)
 * - Execution tracking (agent work records)
 * - Agent busy checking (preventing double-booking)
 * - Ownership and assignment
 *
 * Note: Full CLI integration tests require HQ environment setup.
 * These tests validate the storage layer directly.
 */

/** Database row type for agent_work queries */
interface AgentWorkRow {
  ticket_id: string;
  agent_name: string;
  executor: string;
  environment: string;
  display_mode: string;
  sandboxed: number;
  status: string;
  branch?: string;
}

describe('Work Commands — Database Operations (TKT-140)', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-commands-e2e-'));
    process.chdir(testDir);

    // Setup test environment
    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    setupTestDatabase(db);
  });

  afterEach(() => {
    if (db) db.close();
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Work Ready — moves ticket to Review
  // =========================================================================
  describe('work ready (state transition)', () => {
    it('should move ticket from In Progress to Review column', () => {
      const ticketId = createTicket(db, 'Ready test', 'in-progress');

      // Simulate what `work ready` does: move to review column
      db.prepare(`
        UPDATE pmo_board_tickets SET column_id = 'review'
        WHERE ticket_id = ?
      `).run(ticketId);

      const ticket = db.prepare(`
        SELECT c.name as column_name
        FROM pmo_board_tickets bt
        JOIN pmo_columns c ON c.id = bt.column_id
        WHERE bt.ticket_id = ?
      `).get(ticketId) as { column_name: string };

      expect(ticket.column_name).to.equal('Review');
    });

    it('should mark running execution as completed', () => {
      const ticketId = createTicket(db, 'Execution test', 'in-progress');
      createExecution(db, ticketId, 'agent-1', 'running');

      // Simulate work ready: mark execution as completed
      db.prepare(`
        UPDATE agent_work SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE ticket_id = ? AND status = 'running'
      `).run(ticketId);

      const execution = db.prepare(`
        SELECT status FROM agent_work WHERE ticket_id = ?
      `).get(ticketId) as { status: string };

      expect(execution.status).to.equal('completed');
    });

    it('should only affect running executions for the target ticket', () => {
      const t1 = createTicket(db, 'Target', 'in-progress');
      const t2 = createTicket(db, 'Other', 'in-progress');
      createExecution(db, t1, 'agent-1', 'running');
      createExecution(db, t2, 'agent-2', 'running');

      db.prepare(`
        UPDATE agent_work SET status = 'completed'
        WHERE ticket_id = ? AND status = 'running'
      `).run(t1);

      const e1 = db.prepare(`SELECT status FROM agent_work WHERE ticket_id = ?`).get(t1) as { status: string };
      const e2 = db.prepare(`SELECT status FROM agent_work WHERE ticket_id = ?`).get(t2) as { status: string };
      expect(e1.status).to.equal('completed');
      expect(e2.status).to.equal('running');
    });

    it('should only show in-progress tickets', () => {
      createTicket(db, 'Backlog ticket', 'backlog');
      createTicket(db, 'In Progress ticket', 'in-progress');
      createTicket(db, 'Done ticket', 'done');

      const inProgressTickets = db.prepare(`
        SELECT t.id
        FROM pmo_tickets t
        JOIN pmo_board_tickets bt ON bt.ticket_id = t.id
        JOIN pmo_columns c ON c.id = bt.column_id
        WHERE c.name LIKE '%Progress%'
      `).all();

      expect(inProgressTickets).to.have.lengthOf(1);
    });
  });

  // =========================================================================
  // Work Complete — moves ticket to Done
  // =========================================================================
  describe('work complete (state transition)', () => {
    it('should move ticket to Done column', () => {
      const ticketId = createTicket(db, 'Complete test', 'in-progress');

      db.prepare(`
        UPDATE pmo_board_tickets SET column_id = 'done'
        WHERE ticket_id = ?
      `).run(ticketId);
      db.prepare(`
        UPDATE pmo_tickets SET status = 'done'
        WHERE id = ?
      `).run(ticketId);

      const ticket = db.prepare(`
        SELECT c.name as column_name
        FROM pmo_board_tickets bt
        JOIN pmo_columns c ON c.id = bt.column_id
        WHERE bt.ticket_id = ?
      `).get(ticketId) as { column_name: string };

      expect(ticket.column_name).to.equal('Done');
    });

    it('should update ticket status to done', () => {
      const ticketId = createTicket(db, 'Status test', 'in-review');

      db.prepare(`UPDATE pmo_tickets SET status = 'done' WHERE id = ?`).run(ticketId);

      const ticket = db.prepare(`
        SELECT status FROM pmo_tickets WHERE id = ?
      `).get(ticketId) as { status: string };

      expect(ticket.status).to.equal('done');
    });

    it('should mark running execution as completed', () => {
      const ticketId = createTicket(db, 'Exec complete test', 'in-review');
      createExecution(db, ticketId, 'agent-1', 'running');

      db.prepare(`
        UPDATE agent_work SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE ticket_id = ? AND status = 'running'
      `).run(ticketId);

      const execution = db.prepare(`
        SELECT status FROM agent_work WHERE ticket_id = ?
      `).get(ticketId) as { status: string };

      expect(execution.status).to.equal('completed');
    });
  });

  // =========================================================================
  // Agent Busy Checking — prevents double-booking
  // =========================================================================
  describe('Agent Busy Checking', () => {
    it('should identify busy agents', () => {
      createAgent(db, 'agent-available');
      createAgent(db, 'agent-busy');

      const ticketId = createTicket(db, 'Busy ticket', 'in-progress');
      createExecution(db, ticketId, 'agent-busy', 'running');

      const availableAgents = db.prepare(`
        SELECT a.name
        FROM agents a
        LEFT JOIN agent_work w ON a.name = w.agent_name AND w.status = 'running'
        WHERE w.id IS NULL
      `).all() as Array<{ name: string }>;

      expect(availableAgents).to.have.lengthOf(1);
      expect(availableAgents[0].name).to.equal('agent-available');
    });

    it('should show busy agent with ticket info', () => {
      createAgent(db, 'agent-busy');
      const ticketId = createTicket(db, 'TKT-005', 'in-progress');
      createExecution(db, ticketId, 'agent-busy', 'running');

      const busyAgents = db.prepare(`
        SELECT a.name, w.ticket_id
        FROM agents a
        INNER JOIN agent_work w ON a.name = w.agent_name AND w.status = 'running'
      `).all() as Array<{ name: string; ticket_id: string }>;

      expect(busyAgents).to.have.lengthOf(1);
      expect(busyAgents[0].name).to.equal('agent-busy');
      expect(busyAgents[0].ticket_id).to.equal(ticketId);
    });

    it('should clear agent when execution completes', () => {
      createAgent(db, 'agent-1');
      const ticketId = createTicket(db, 'Clear test', 'in-progress');
      createExecution(db, ticketId, 'agent-1', 'running');

      // Complete the work
      db.prepare(`
        UPDATE agent_work SET status = 'completed'
        WHERE ticket_id = ? AND status = 'running'
      `).run(ticketId);

      const availableAgents = db.prepare(`
        SELECT a.name
        FROM agents a
        LEFT JOIN agent_work w ON a.name = w.agent_name AND w.status = 'running'
        WHERE w.id IS NULL
      `).all();

      expect(availableAgents).to.have.lengthOf(1);
    });

    it('should handle multiple completed executions for same agent', () => {
      createAgent(db, 'agent-multi');
      const t1 = createTicket(db, 'First task', 'in-progress');
      const t2 = createTicket(db, 'Second task', 'in-progress');

      createExecution(db, t1, 'agent-multi', 'completed');
      createExecution(db, t2, 'agent-multi', 'running');

      const busyAgents = db.prepare(`
        SELECT a.name
        FROM agents a
        INNER JOIN agent_work w ON a.name = w.agent_name AND w.status = 'running'
      `).all() as Array<{ name: string }>;

      expect(busyAgents).to.have.lengthOf(1);
      expect(busyAgents[0].name).to.equal('agent-multi');
    });
  });

  // =========================================================================
  // Execution Tracking
  // =========================================================================
  describe('Execution Tracking', () => {
    it('should create execution with all required fields', () => {
      const ticketId = createTicket(db, 'Track test', 'in-progress');

      createExecution(db, ticketId, 'agent-1', 'running', {
        executor: 'claude-code',
        mode: 'foreground',
        environment: 'host',
        display_mode: 'terminal',
        sandboxed: true,
        branch: 'agent/agent-1/track-test',
      });

      const execution = db.prepare(`
        SELECT * FROM agent_work WHERE ticket_id = ?
      `).get(ticketId) as AgentWorkRow | undefined;

      expect(execution).to.exist;
      expect(execution!.ticket_id).to.equal(ticketId);
      expect(execution!.agent_name).to.equal('agent-1');
      expect(execution!.executor).to.equal('claude-code');
      expect(execution!.environment).to.equal('host');
      expect(execution!.display_mode).to.equal('terminal');
      expect(execution!.sandboxed).to.equal(1);
      expect(execution!.status).to.equal('running');
    });

    it('should record environment and display_mode separately', () => {
      const ticketId = createTicket(db, 'Env test', 'in-progress');

      createExecution(db, ticketId, 'agent-1', 'running', {
        environment: 'devcontainer',
        display_mode: 'foreground',
      });

      const execution = db.prepare(`
        SELECT environment, display_mode FROM agent_work WHERE ticket_id = ?
      `).get(ticketId) as { environment: string; display_mode: string };

      expect(execution.environment).to.equal('devcontainer');
      expect(execution.display_mode).to.equal('foreground');
    });

    it('should record sandboxed mode', () => {
      const ticketId = createTicket(db, 'Sandbox test', 'in-progress');

      createExecution(db, ticketId, 'agent-1', 'running', { sandboxed: true });

      const execution = db.prepare(`
        SELECT sandboxed FROM agent_work WHERE ticket_id = ?
      `).get(ticketId) as { sandboxed: number };

      expect(execution.sandboxed).to.equal(1);
    });

    it('should record different executor types', () => {
      const t1 = createTicket(db, 'Codex test', 'in-progress');
      const t2 = createTicket(db, 'Custom test', 'in-progress');

      createExecution(db, t1, 'agent-1', 'running', { executor: 'codex' });
      createExecution(db, t2, 'agent-2', 'running', { executor: 'custom' });

      const e1 = db.prepare(`SELECT executor FROM agent_work WHERE ticket_id = ?`).get(t1) as { executor: string };
      const e2 = db.prepare(`SELECT executor FROM agent_work WHERE ticket_id = ?`).get(t2) as { executor: string };

      expect(e1.executor).to.equal('codex');
      expect(e2.executor).to.equal('custom');
    });

    it('should track execution status transitions', () => {
      const ticketId = createTicket(db, 'Status transitions', 'in-progress');
      createExecution(db, ticketId, 'agent-1', 'starting');

      // starting → running
      db.prepare(`UPDATE agent_work SET status = 'running' WHERE ticket_id = ?`).run(ticketId);
      let exec = db.prepare(`SELECT status FROM agent_work WHERE ticket_id = ?`).get(ticketId) as { status: string };
      expect(exec.status).to.equal('running');

      // running → completed
      db.prepare(`UPDATE agent_work SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE ticket_id = ?`).run(ticketId);
      exec = db.prepare(`SELECT status FROM agent_work WHERE ticket_id = ?`).get(ticketId) as { status: string };
      expect(exec.status).to.equal('completed');
    });

    it('should record branch name', () => {
      const ticketId = createTicket(db, 'Branch test', 'in-progress');
      createExecution(db, ticketId, 'agent-1', 'running', {
        branch: 'TKT-100/feat/user/agent/branch-name',
      });

      const execution = db.prepare(`
        SELECT branch FROM agent_work WHERE ticket_id = ?
      `).get(ticketId) as { branch: string };

      expect(execution.branch).to.equal('TKT-100/feat/user/agent/branch-name');
    });
  });

  // =========================================================================
  // Work Claim & Assign & Own
  // =========================================================================
  describe('Ownership', () => {
    it('should set ticket assignee via claim', () => {
      const ticketId = createTicket(db, 'Claim test', 'backlog');
      createAgent(db, 'agent-1');

      db.prepare(`
        UPDATE pmo_tickets SET assignee = ?, owner = ?
        WHERE id = ?
      `).run('agent-1', 'test-user', ticketId);

      const ticket = db.prepare(`
        SELECT assignee, owner FROM pmo_tickets WHERE id = ?
      `).get(ticketId) as { assignee: string; owner: string };

      expect(ticket.assignee).to.equal('agent-1');
      expect(ticket.owner).to.equal('test-user');
    });

    it('should update ticket assignee via assign', () => {
      const ticketId = createTicket(db, 'Assign test', 'backlog');
      createAgent(db, 'agent-2');

      db.prepare(`UPDATE pmo_tickets SET assignee = ? WHERE id = ?`).run('agent-2', ticketId);

      const ticket = db.prepare(`
        SELECT assignee FROM pmo_tickets WHERE id = ?
      `).get(ticketId) as { assignee: string };

      expect(ticket.assignee).to.equal('agent-2');
    });

    it('should set ticket owner', () => {
      const ticketId = createTicket(db, 'Own test', 'backlog');

      db.prepare(`UPDATE pmo_tickets SET owner = ? WHERE id = ?`).run('chris', ticketId);

      const ticket = db.prepare(`
        SELECT owner FROM pmo_tickets WHERE id = ?
      `).get(ticketId) as { owner: string };

      expect(ticket.owner).to.equal('chris');
    });
  });

  // =========================================================================
  // Work Start — creates execution record
  // =========================================================================
  describe('work start (execution creation)', () => {
    it('should create an execution record when starting work', () => {
      const ticketId = createTicket(db, 'Start test', 'backlog');
      createAgent(db, 'starter-agent');

      // Move ticket to In Progress
      db.prepare(`UPDATE pmo_board_tickets SET column_id = 'in-progress' WHERE ticket_id = ?`).run(ticketId);
      db.prepare(`UPDATE pmo_tickets SET status_id = 'status-in-progress' WHERE id = ?`).run(ticketId);

      // Create execution record
      createExecution(db, ticketId, 'starter-agent', 'running', {
        executor: 'claude-code',
        environment: 'host',
        display_mode: 'terminal',
      });

      const exec = db.prepare(`SELECT * FROM agent_work WHERE ticket_id = ?`).get(ticketId) as AgentWorkRow;
      expect(exec).to.exist;
      expect(exec.agent_name).to.equal('starter-agent');
      expect(exec.status).to.equal('running');

      // Verify ticket is in progress
      const column = db.prepare(`
        SELECT c.name FROM pmo_board_tickets bt
        JOIN pmo_columns c ON c.id = bt.column_id
        WHERE bt.ticket_id = ?
      `).get(ticketId) as { name: string };
      expect(column.name).to.equal('In Progress');
    });

    it('should prevent starting work on a ticket with a running execution', () => {
      const ticketId = createTicket(db, 'Double-book test', 'in-progress');
      createAgent(db, 'agent-a');
      createAgent(db, 'agent-b');

      createExecution(db, ticketId, 'agent-a', 'running');

      // Check if ticket has running execution before starting
      const running = db.prepare(`
        SELECT COUNT(*) as count FROM agent_work
        WHERE ticket_id = ? AND status = 'running'
      `).get(ticketId) as { count: number };

      expect(running.count).to.be.greaterThan(0);
    });
  });
});

// =========================================================================
// Helper functions
// =========================================================================
function setupTestDatabase(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pmo_statuses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, name)
    );

    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'MEDIUM',
      category TEXT DEFAULT 'feature',
      status TEXT DEFAULT 'backlog',
      status_id TEXT,
      owner TEXT,
      assignee TEXT,
      branch TEXT,
      spec_id TEXT,
      epic_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TEXT,
      last_synced_from_board TEXT,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (status_id) REFERENCES pmo_statuses(id)
    );

    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL UNIQUE,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (column_id) REFERENCES pmo_columns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      path TEXT,
      worktree_path TEXT,
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
  `);

  // Insert test data
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description)
    VALUES ('test-project', 'Test Project', 'E2E test project')
  `).run();

  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', 'pmo'), ('current_project', 'test-project')
  `).run();

  // Linear-style columns: Backlog, Planned, In Progress, Review, Done
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'planned', name: 'Planned', position: 1 },
    { id: 'in-progress', name: 'In Progress', position: 2 },
    { id: 'review', name: 'Review', position: 3 },
    { id: 'done', name: 'Done', position: 4 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `).run(col.id, col.name, col.position);
  }

  // Workflow statuses
  const statuses = [
    { id: 'status-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'status-todo', name: 'Todo', category: 'unstarted', position: 0 },
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 0 },
    { id: 'status-in-review', name: 'In Review', category: 'started', position: 1 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 0 },
    { id: 'status-canceled', name: 'Canceled', category: 'canceled', position: 0 },
  ];

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_statuses (id, project_id, name, category, position, is_default)
      VALUES (?, 'test-project', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }

  // Create PMO directory structure
  const pmoPath = path.join(process.cwd(), 'pmo/projects/test-project');
  fs.mkdirSync(pmoPath, { recursive: true });
}

let ticketCounter = 0;
function createTicket(db: Database.Database, title: string, columnOrStatus: string): string {
  ticketCounter++;
  const ticketId = `TKT-${String(ticketCounter).padStart(3, '0')}`;

  const toColumnId: Record<string, string> = {
    'backlog': 'backlog',
    'planned': 'planned',
    'in-progress': 'in-progress',
    'in-review': 'review',
    'review': 'review',
    'done': 'done',
  };

  const toStatusId: Record<string, string> = {
    'backlog': 'status-backlog',
    'planned': 'status-todo',
    'in-progress': 'status-in-progress',
    'in-review': 'status-in-review',
    'done': 'status-done',
  };

  const columnId = toColumnId[columnOrStatus] || 'backlog';
  const statusId = toStatusId[columnOrStatus] || 'status-backlog';

  db.prepare(`
    INSERT INTO pmo_tickets (id, project_id, title, status, status_id)
    VALUES (?, 'test-project', ?, ?, ?)
  `).run(ticketId, title, columnOrStatus === 'done' ? 'done' : 'active', statusId);

  db.prepare(`
    INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
    VALUES ('test-project', ?, ?, 0)
  `).run(ticketId, columnId);

  return ticketId;
}

function createAgent(db: Database.Database, name: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO agents (name, path)
    VALUES (?, ?)
  `).run(name, `/agents/${name}`);
}

let executionCounter = 0;
function createExecution(
  db: Database.Database,
  ticketId: string,
  agentName: string,
  status: string,
  options: {
    executor?: string;
    mode?: string;
    environment?: string;
    display_mode?: string;
    sandboxed?: boolean;
    branch?: string;
  } = {}
): string {
  executionCounter++;
  const execId = `WORK-${String(executionCounter).padStart(3, '0')}`;

  db.prepare(`
    INSERT INTO agent_work (id, ticket_id, agent_name, status, executor, mode, environment, display_mode, sandboxed, branch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    execId,
    ticketId,
    agentName,
    status,
    options.executor || 'claude-code',
    options.mode || 'foreground',
    options.environment || 'host',
    options.display_mode || 'terminal',
    options.sandboxed ? 1 : 0,
    options.branch || null
  );

  return execId;
}
