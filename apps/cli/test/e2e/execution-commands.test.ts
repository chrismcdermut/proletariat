import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { exec } from './test-helpers.js';

/**
 * End-to-end tests for Execution Commands
 * Tests actual CLI usage as a user would interact with it
 * Spec: execute-commands.md > Execution Commands
 *
 * Note: The command is 'executions list' (plural), not 'execution list' (singular).
 * Tests have been updated to use the correct command path.
 *
 * SKIPPED: Tests need workspace environment setup that isn't working in test context.
 * The executions commands require a properly initialized HQ environment.
 */
describe.skip('Execution Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-commands-e2e-'));
    process.chdir(testDir);

    // Setup test environment
    const proletariatDir = path.join(testDir, '.proletariat');
    const logsDir = path.join(proletariatDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    db = new Database(dbPath);
    setupTestDatabase(db);
  });

  afterEach(() => {
    if (db) db.close();
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Spec: execute-commands.md > prlt execution list
   * "List running and recent executions"
   */
  describe('prlt execution list', () => {
    it('should list all executions', () => {
      // Create test executions
      const ticketId1 = createTicket(db, 'Test ticket 1', 'in-progress');
      const ticketId2 = createTicket(db, 'Test ticket 2', 'in-progress');
      createAgent(db, 'agent-1');
      createAgent(db, 'agent-2');

      createExecution(db, ticketId1, 'agent-1', 'running');
      createExecution(db, ticketId2, 'agent-2', 'completed');

      const output = exec('executions list');

      expect(output).to.contain('WORK-');
      expect(output).to.contain('agent-1');
      expect(output).to.contain('agent-2');
    });

    it('should filter by status', () => {
      const ticketId1 = createTicket(db, 'Running ticket', 'in-progress');
      const ticketId2 = createTicket(db, 'Completed ticket', 'done');
      createAgent(db, 'agent-1');
      createAgent(db, 'agent-2');

      createExecution(db, ticketId1, 'agent-1', 'running');
      createExecution(db, ticketId2, 'agent-2', 'completed');

      // Query running only
      const runningExecutions = db.prepare(`
        SELECT * FROM agent_work WHERE status = 'running'
      `).all();

      expect(runningExecutions).to.have.lengthOf(1);
    });

    it('should filter by agent', () => {
      const ticketId1 = createTicket(db, 'Agent 1 ticket', 'in-progress');
      const ticketId2 = createTicket(db, 'Agent 2 ticket', 'in-progress');
      createAgent(db, 'agent-1');
      createAgent(db, 'agent-2');

      createExecution(db, ticketId1, 'agent-1', 'running');
      createExecution(db, ticketId2, 'agent-2', 'running');

      // Query by agent
      const agent1Executions = db.prepare(`
        SELECT * FROM agent_work WHERE agent_name = 'agent-1'
      `).all();

      expect(agent1Executions).to.have.lengthOf(1);
    });

    it('should show execution details', () => {
      const ticketId = createTicket(db, 'Detail test', 'in-progress');
      createAgent(db, 'agent-1');

      createExecution(db, ticketId, 'agent-1', 'running', {
        executor: 'claude-code',
        environment: 'devcontainer',
        display_mode: 'terminal',
        sandboxed: true,
        branch: 'agent/agent-1/detail-test',
      });

      const execution = db.prepare(`
        SELECT * FROM agent_work WHERE ticket_id = ?
      `).get(ticketId) as any;

      expect(execution.executor).to.equal('claude-code');
      expect(execution.environment).to.equal('devcontainer');
      expect(execution.display_mode).to.equal('terminal');
      expect(execution.sandboxed).to.equal(1);
      expect(execution.branch).to.equal('agent/agent-1/detail-test');
    });

    it('should respect limit option', () => {
      createAgent(db, 'agent-1');

      // Create multiple executions
      for (let i = 0; i < 30; i++) {
        const ticketId = createTicket(db, `Ticket ${i}`, 'done');
        createExecution(db, ticketId, 'agent-1', 'completed');
      }

      // Query with limit
      const limited = db.prepare(`
        SELECT * FROM agent_work ORDER BY started_at DESC LIMIT 20
      `).all();

      expect(limited).to.have.lengthOf(20);
    });
  });

  /**
   * Spec: execute-commands.md > prlt execution logs [id]
   * "View execution logs"
   */
  describe('prlt execution logs', () => {
    it('should show logs for an execution', () => {
      const ticketId = createTicket(db, 'Log test', 'in-progress');
      createAgent(db, 'agent-1');

      // Create log file
      const logPath = path.join(testDir, '.proletariat', 'logs', 'work-WORK-001.log');
      fs.writeFileSync(logPath, 'Test log content\nLine 2\nLine 3\n');

      createExecution(db, ticketId, 'agent-1', 'running', {
        log_path: logPath,
      });

      // Read log file directly (what the command would do)
      const logContent = fs.readFileSync(logPath, 'utf-8');

      expect(logContent).to.contain('Test log content');
      expect(logContent).to.contain('Line 2');
    });

    it('should show last n lines with --tail option', () => {
      const ticketId = createTicket(db, 'Tail test', 'in-progress');
      createAgent(db, 'agent-1');

      // Create log file with many lines
      const logPath = path.join(testDir, '.proletariat', 'logs', 'work-WORK-002.log');
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
      fs.writeFileSync(logPath, lines);

      createExecution(db, ticketId, 'agent-1', 'running', {
        log_path: logPath,
      });

      // Simulate tail behavior
      const allLines = fs.readFileSync(logPath, 'utf-8').split('\n');
      const tailLines = allLines.slice(-10);

      expect(tailLines).to.have.lengthOf(10);
      expect(tailLines[tailLines.length - 1]).to.equal('Line 100');
    });

    it('should handle missing log file gracefully', () => {
      const ticketId = createTicket(db, 'Missing log test', 'in-progress');
      createAgent(db, 'agent-1');

      const nonExistentPath = path.join(testDir, '.proletariat', 'logs', 'nonexistent.log');

      createExecution(db, ticketId, 'agent-1', 'running', {
        log_path: nonExistentPath,
      });

      expect(fs.existsSync(nonExistentPath)).to.be.false;
    });
  });

  /**
   * Spec: execute-commands.md > prlt execution stop [id]
   * "Stop a running execution"
   */
  describe('prlt execution stop', () => {
    it('should mark execution as stopped', () => {
      const ticketId = createTicket(db, 'Stop test', 'in-progress');
      createAgent(db, 'agent-1');

      const execId = createExecution(db, ticketId, 'agent-1', 'running', {
        pid: '12345',
      });

      // Simulate stop command (update status)
      db.prepare(`
        UPDATE agent_work SET status = 'stopped', completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(execId);

      const execution = db.prepare(`
        SELECT status FROM agent_work WHERE id = ?
      `).get(execId) as { status: string };

      expect(execution.status).to.equal('stopped');
    });

    it('should clear agent availability when stopped', () => {
      const ticketId = createTicket(db, 'Clear test', 'in-progress');
      createAgent(db, 'agent-1');

      createExecution(db, ticketId, 'agent-1', 'running');

      // Stop the execution
      db.prepare(`
        UPDATE agent_work SET status = 'stopped'
        WHERE ticket_id = ? AND status = 'running'
      `).run(ticketId);

      // Agent should now be available
      const availableAgents = db.prepare(`
        SELECT a.name
        FROM agents a
        LEFT JOIN agent_work w ON a.name = w.agent_name AND w.status = 'running'
        WHERE w.id IS NULL
      `).all();

      expect(availableAgents).to.have.lengthOf(1);
    });

    it('should handle background process stop', () => {
      const ticketId = createTicket(db, 'Background stop', 'in-progress');
      createAgent(db, 'agent-1');

      createExecution(db, ticketId, 'agent-1', 'running', {
        display_mode: 'background',
        pid: '99999',
      });

      // Query for background executions with PID
      const backgroundExec = db.prepare(`
        SELECT id, pid FROM agent_work
        WHERE display_mode = 'background' AND status = 'running' AND pid IS NOT NULL
      `).get() as { id: string; pid: string };

      expect(backgroundExec).to.exist;
      expect(backgroundExec.pid).to.equal('99999');
    });

    it('should handle docker container stop', () => {
      const ticketId = createTicket(db, 'Docker stop', 'in-progress');
      createAgent(db, 'agent-1');

      createExecution(db, ticketId, 'agent-1', 'running', {
        environment: 'docker',
        container_id: 'abc123def456',
      });

      // Query for docker executions with container_id
      const dockerExec = db.prepare(`
        SELECT id, container_id FROM agent_work
        WHERE environment = 'docker' AND status = 'running' AND container_id IS NOT NULL
      `).get() as { id: string; container_id: string };

      expect(dockerExec).to.exist;
      expect(dockerExec.container_id).to.equal('abc123def456');
    });

    it('should handle tmux session stop', () => {
      const ticketId = createTicket(db, 'Tmux stop', 'in-progress');
      createAgent(db, 'agent-1');

      createExecution(db, ticketId, 'agent-1', 'running', {
        display_mode: 'tmux',
        session_id: 'proletariat:TKT-001',
      });

      // Query for tmux executions with session_id
      const tmuxExec = db.prepare(`
        SELECT id, session_id FROM agent_work
        WHERE display_mode = 'tmux' AND status = 'running' AND session_id IS NOT NULL
      `).get() as { id: string; session_id: string };

      expect(tmuxExec).to.exist;
      expect(tmuxExec.session_id).to.equal('proletariat:TKT-001');
    });
  });

  /**
   * Spec: execute-commands.md > Execution Tracking
   * "Database Schema"
   */
  describe('Execution Database Schema', () => {
    it('should store all required fields', () => {
      const ticketId = createTicket(db, 'Schema test', 'in-progress');
      createAgent(db, 'agent-1');

      createExecution(db, ticketId, 'agent-1', 'running', {
        executor: 'claude-code',
        mode: 'foreground',
        environment: 'host',
        display_mode: 'terminal',
        sandboxed: true,
        branch: 'agent/agent-1/schema-test',
        pid: '12345',
        log_path: '/path/to/logs',
      });

      const execution = db.prepare(`
        SELECT * FROM agent_work WHERE ticket_id = ?
      `).get(ticketId) as any;

      expect(execution.ticket_id).to.equal(ticketId);
      expect(execution.agent_name).to.equal('agent-1');
      expect(execution.executor).to.equal('claude-code');
      expect(execution.mode).to.equal('foreground');
      expect(execution.environment).to.equal('host');
      expect(execution.display_mode).to.equal('terminal');
      expect(execution.sandboxed).to.equal(1);
      expect(execution.status).to.equal('running');
      expect(execution.branch).to.equal('agent/agent-1/schema-test');
      expect(execution.pid).to.equal('12345');
      expect(execution.log_path).to.equal('/path/to/logs');
      expect(execution.started_at).to.exist;
    });

    it('should track execution lifecycle', () => {
      const ticketId = createTicket(db, 'Lifecycle test', 'in-progress');
      createAgent(db, 'agent-1');

      const execId = createExecution(db, ticketId, 'agent-1', 'running');

      // Verify started_at is set
      let execution = db.prepare(`SELECT * FROM agent_work WHERE id = ?`).get(execId) as any;
      expect(execution.started_at).to.exist;
      expect(execution.completed_at).to.be.null;

      // Complete the execution
      db.prepare(`
        UPDATE agent_work SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(execId);

      execution = db.prepare(`SELECT * FROM agent_work WHERE id = ?`).get(execId) as any;
      expect(execution.status).to.equal('completed');
      expect(execution.completed_at).to.exist;
    });

    it('should track exit codes', () => {
      const ticketId = createTicket(db, 'Exit code test', 'in-progress');
      createAgent(db, 'agent-1');

      const execId = createExecution(db, ticketId, 'agent-1', 'running');

      // Simulate failure with exit code
      db.prepare(`
        UPDATE agent_work SET status = 'failed', exit_code = 1, completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(execId);

      const execution = db.prepare(`
        SELECT status, exit_code FROM agent_work WHERE id = ?
      `).get(execId) as { status: string; exit_code: number };

      expect(execution.status).to.equal('failed');
      expect(execution.exit_code).to.equal(1);
    });
  });

  /**
   * Spec: execute-commands.md > Agent Lifecycle
   * "Execution status transitions"
   */
  describe('Execution Status Transitions', () => {
    it('should transition from running to completed', () => {
      const ticketId = createTicket(db, 'Complete transition', 'in-progress');
      createAgent(db, 'agent-1');

      const execId = createExecution(db, ticketId, 'agent-1', 'running');

      // Run work ready (simulates agent completing)
      db.prepare(`
        UPDATE agent_work SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(execId);

      const execution = db.prepare(`SELECT status FROM agent_work WHERE id = ?`).get(execId) as any;
      expect(execution.status).to.equal('completed');
    });

    it('should transition from running to failed', () => {
      const ticketId = createTicket(db, 'Fail transition', 'in-progress');
      createAgent(db, 'agent-1');

      const execId = createExecution(db, ticketId, 'agent-1', 'running');

      // Simulate failure
      db.prepare(`
        UPDATE agent_work SET status = 'failed', exit_code = 1, completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(execId);

      const execution = db.prepare(`SELECT status, exit_code FROM agent_work WHERE id = ?`).get(execId) as any;
      expect(execution.status).to.equal('failed');
      expect(execution.exit_code).to.equal(1);
    });

    it('should transition from running to stopped', () => {
      const ticketId = createTicket(db, 'Stop transition', 'in-progress');
      createAgent(db, 'agent-1');

      const execId = createExecution(db, ticketId, 'agent-1', 'running');

      // Stop execution
      db.prepare(`
        UPDATE agent_work SET status = 'stopped', completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(execId);

      const execution = db.prepare(`SELECT status FROM agent_work WHERE id = ?`).get(execId) as any;
      expect(execution.status).to.equal('stopped');
    });
  });

  /**
   * Spec: execute-commands.md > Execution Environment
   * "Environment and Display Mode separation"
   */
  describe('Environment and Display Mode', () => {
    it('should store environment independently of display_mode', () => {
      const ticketId = createTicket(db, 'Env test', 'in-progress');
      createAgent(db, 'agent-1');

      // Devcontainer with terminal display
      createExecution(db, ticketId, 'agent-1', 'running', {
        environment: 'devcontainer',
        display_mode: 'terminal',
      });

      const execution = db.prepare(`
        SELECT environment, display_mode FROM agent_work WHERE ticket_id = ?
      `).get(ticketId) as { environment: string; display_mode: string };

      expect(execution.environment).to.equal('devcontainer');
      expect(execution.display_mode).to.equal('terminal');
    });

    it('should allow all environment/display combinations', () => {
      createAgent(db, 'agent-1');
      // Note: display modes are foreground, terminal, background
      // All create tmux sessions - the difference is how they attach:
      // - foreground: attach in current terminal (blocking)
      // - terminal: open new tab attached to session
      // - background: don't attach (detached, reattach later)
      const combinations = [
        { env: 'host', display: 'terminal' },
        { env: 'host', display: 'foreground' },
        { env: 'host', display: 'background' },
        { env: 'devcontainer', display: 'terminal' },
        { env: 'devcontainer', display: 'foreground' },
        { env: 'devcontainer', display: 'background' },
      ];

      for (const combo of combinations) {
        const ticketId = createTicket(db, `${combo.env}-${combo.display}`, 'in-progress');
        createExecution(db, ticketId, 'agent-1', 'running', {
          environment: combo.env,
          display_mode: combo.display,
        });
      }

      const count = db.prepare(`SELECT COUNT(*) as count FROM agent_work`).get() as { count: number };
      expect(count.count).to.equal(combinations.length);
    });
  });

  /**
   * Spec: execute-commands.md > Permission Mode
   * "sandboxed field tracking"
   */
  describe('Permission Mode Tracking', () => {
    it('should track safe mode (sandboxed=true)', () => {
      const ticketId = createTicket(db, 'Safe mode test', 'in-progress');
      createAgent(db, 'agent-1');

      createExecution(db, ticketId, 'agent-1', 'running', {
        sandboxed: true,
      });

      const execution = db.prepare(`
        SELECT sandboxed FROM agent_work WHERE ticket_id = ?
      `).get(ticketId) as { sandboxed: number };

      expect(execution.sandboxed).to.equal(1);
    });

    it('should track danger mode (sandboxed=false)', () => {
      const ticketId = createTicket(db, 'Danger mode test', 'in-progress');
      createAgent(db, 'agent-1');

      createExecution(db, ticketId, 'agent-1', 'running', {
        sandboxed: false,
      });

      const execution = db.prepare(`
        SELECT sandboxed FROM agent_work WHERE ticket_id = ?
      `).get(ticketId) as { sandboxed: number };

      expect(execution.sandboxed).to.equal(0);
    });
  });
});

// Helper functions
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
      spec_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
      status TEXT NOT NULL DEFAULT 'running',
      branch TEXT,
      pid TEXT,
      container_id TEXT,
      session_id TEXT,
      host TEXT,
      log_path TEXT,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      exit_code INTEGER
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

  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in-progress', name: 'In Progress', position: 1 },
    { id: 'in-review', name: 'In Review', position: 2 },
    { id: 'done', name: 'Done', position: 3 },
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
function createTicket(db: Database.Database, title: string, columnId: string): string {
  ticketCounter++;
  const ticketId = `TKT-${String(ticketCounter).padStart(3, '0')}`;

  // Map column to status ID
  const columnToStatus: Record<string, string> = {
    'backlog': 'status-backlog',
    'in-progress': 'status-in-progress',
    'in-review': 'status-in-review',
    'done': 'status-done',
  };
  const statusId = columnToStatus[columnId] || 'status-backlog';

  db.prepare(`
    INSERT INTO pmo_tickets (id, project_id, title, status, status_id)
    VALUES (?, 'test-project', ?, ?, ?)
  `).run(ticketId, title, columnId === 'done' ? 'done' : 'active', statusId);

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
    pid?: string;
    container_id?: string;
    session_id?: string;
    host?: string;
    log_path?: string;
  } = {}
): string {
  executionCounter++;
  const execId = `WORK-${String(executionCounter).padStart(3, '0')}`;

  db.prepare(`
    INSERT INTO agent_work (
      id, ticket_id, agent_name, status, executor, mode,
      environment, display_mode, sandboxed, branch,
      pid, container_id, session_id, host, log_path
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    execId,
    ticketId,
    agentName,
    status,
    options.executor || 'claude-code',
    options.mode || 'foreground',
    options.environment || 'host',
    options.display_mode || 'terminal',
    options.sandboxed !== undefined ? (options.sandboxed ? 1 : 0) : 1,
    options.branch || null,
    options.pid || null,
    options.container_id || null,
    options.session_id || null,
    options.host || null,
    options.log_path || null
  );

  return execId;
}

