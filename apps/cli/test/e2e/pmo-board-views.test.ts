import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * End-to-end tests for PMO Board Views & Filtering
 * Tests: prlt board view with filters, grouping, and sorting
 * Spec: pmo-board-views.md
 *
 * SKIPPED: Board view command with filters is not yet implemented.
 * See ticket TKT-041 for implementation tracking.
 */
describe.skip('PMO Board Views E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-views-e2e-'));
    process.chdir(testDir);

    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    db = new Database(dbPath);
    setupTestDatabase(db);
    createTestTickets(db);
  });

  afterEach(() => {
    if (db) db.close();
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('prlt board view --assignee', () => {
    it('should filter by assignee', () => {
      const output = exec('board view --assignee alice');

      expect(output).to.contain('alice');
      expect(output).to.not.contain('bob');
      expect(output).to.contain('filtered: assignee=alice');
    });

    it('should show only unassigned tickets', () => {
      const output = exec('board view --assignee unassigned');

      expect(output).to.contain('unassigned');
      expect(output).to.not.contain('@alice');
      expect(output).to.not.contain('@bob');
    });

    it('should hide empty columns when filtering', () => {
      const output = exec('board view --assignee alice');

      // If alice has no tickets in a column, it shouldn't appear
      const columnCount = (output.match(/##/g) || []).length;
      expect(columnCount).to.be.lessThan(5); // Not all columns shown
    });
  });

  describe('prlt board view --priority', () => {
    it('should filter by HIGH priority', () => {
      const output = exec('board view --priority HIGH');

      expect(output).to.contain('P:HIGH');
      expect(output).to.not.contain('P:MEDIUM');
      expect(output).to.not.contain('P:LOW');
    });

    it('should filter by MEDIUM priority', () => {
      const output = exec('board view --priority MEDIUM');

      expect(output).to.contain('P:MEDIUM');
      expect(output).to.not.contain('P:HIGH');
    });

    it('should be case-insensitive', () => {
      const output1 = exec('board view --priority high');
      const output2 = exec('board view --priority HIGH');

      expect(output1).to.equal(output2);
    });
  });

  describe('prlt board view --column', () => {
    it('should show only specific column', () => {
      const output = exec('board view --column "In Progress"');

      expect(output).to.contain('In Progress');
      expect(output).to.not.contain('SHIP BL');
      expect(output).to.contain('showing: In Progress');
    });

    it('should support multiple columns', () => {
      const output = exec('board view --column "SHIP BL" --column "In Progress"');

      expect(output).to.contain('SHIP BL');
      expect(output).to.contain('In Progress');
      expect(output).to.not.contain('Merged');
    });
  });

  describe('prlt board view --status', () => {
    it('should filter by lifecycle status', () => {
      const output = exec('board view --status in_progress');

      expect(output).to.contain('[IN_PROGRESS]');
      expect(output).to.not.contain('[BACKLOG]');
    });

    it('should filter blocked tickets', () => {
      const output = exec('board view --status blocked');

      expect(output).to.contain('[BLOCKED]');
      expect(output).to.match(/\d+ blocked tickets/);
    });
  });

  describe('prlt board view with combined filters', () => {
    it('should apply multiple filters (AND)', () => {
      const output = exec('board view --assignee alice --priority HIGH');

      expect(output).to.contain('filtered: assignee=alice, priority=HIGH');
      expect(output).to.contain('@alice');
      expect(output).to.contain('P:HIGH');
      expect(output).to.not.contain('P:MEDIUM');
      expect(output).to.not.contain('@bob');
    });

    it('should combine assignee, priority, and column filters', () => {
      const output = exec('board view --assignee alice --priority HIGH --column "In Progress"');

      expect(output).to.contain('In Progress');
      expect(output).to.contain('@alice');
      expect(output).to.contain('P:HIGH');
    });

    it('should show filtered count vs total', () => {
      const output = exec('board view --priority HIGH');

      expect(output).to.match(/Showing \d+ of \d+ total tickets/);
    });
  });

  describe('prlt board view --group-by assignee', () => {
    it('should group tickets by assignee', () => {
      const output = exec('board view --group-by assignee');

      expect(output).to.contain('grouped by: assignee');
      expect(output).to.contain('👤 alice');
      expect(output).to.contain('👤 bob');
      expect(output).to.contain('👤 unassigned');
    });

    it('should show column in ticket details when grouped', () => {
      const output = exec('board view --group-by assignee');

      // When grouped by assignee, should show which column each ticket is in
      expect(output).to.contain('[SHIP BL]');
      expect(output).to.contain('[In Progress]');
    });

    it('should show ticket counts per assignee', () => {
      const output = exec('board view --group-by assignee');

      expect(output).to.match(/alice \(\d+ tickets\)/);
      expect(output).to.match(/bob \(\d+ tickets\)/);
    });
  });

  describe('prlt board view --group-by priority', () => {
    it('should group tickets by priority level', () => {
      const output = exec('board view --group-by priority');

      expect(output).to.contain('grouped by: priority');
      expect(output).to.contain('🔴 HIGH');
      expect(output).to.contain('🟡 MEDIUM');
      expect(output).to.contain('🟢 LOW');
    });

    it('should show assignee and column in grouped view', () => {
      const output = exec('board view --group-by priority');

      expect(output).to.contain('@alice');
      expect(output).to.contain('[SHIP BL]');
    });

    it('should show summary with priority breakdown', () => {
      const output = exec('board view --group-by priority');

      expect(output).to.match(/HIGH: \d+, MEDIUM: \d+, LOW: \d+/);
    });
  });

  describe('prlt board view --sort-by', () => {
    it('should sort by priority (highest first)', () => {
      const output = exec('board view --sort-by priority');

      expect(output).to.contain('sorted by: priority');

      // Verify HIGH tickets appear before MEDIUM
      const highIndex = output.indexOf('P:HIGH');
      const mediumIndex = output.indexOf('P:MEDIUM');
      if (highIndex !== -1 && mediumIndex !== -1) {
        expect(highIndex).to.be.lessThan(mediumIndex);
      }
    });

    it('should sort by created date', () => {
      const output = exec('board view --sort-by created');

      expect(output).to.contain('sorted by: created');
    });

    it('should sort by updated date (most recent first)', () => {
      const output = exec('board view --sort-by updated');

      expect(output).to.contain('sorted by: updated');
    });

    it('should sort alphabetically by title', () => {
      const output = exec('board view --sort-by title');

      expect(output).to.contain('sorted by: title');
    });

    it('should sort by assignee name', () => {
      const output = exec('board view --sort-by assignee');

      expect(output).to.contain('sorted by: assignee');
    });
  });

  describe('empty state handling', () => {
    it('should show message when no tickets match filters', () => {
      const output = exec('board view --assignee nonexistent');

      expect(output).to.contain('No tickets match filters');
    });

    it('should suggest removing filters if no results', () => {
      const output = exec('board view --assignee nobody --priority URGENT');

      expect(output).to.match(/No tickets match|remove filters/i);
    });
  });
});

function setupTestDatabase(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
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
  `);

  db.prepare(`
    INSERT INTO pmo_projects (id, name)
    VALUES ('test-project', 'Test Project')
  `).run();

  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', 'pmo'), ('current_project', 'test-project')
  `).run();

  const columns = [
    { id: 'backlog', name: 'SHIP BL', position: 0 },
    { id: 'ready', name: 'Ready', position: 1 },
    { id: 'in-progress', name: 'In Progress', position: 2 },
    { id: 'merged', name: 'Merged', position: 3 },
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
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 0 },
    { id: 'status-blocked', name: 'Blocked', category: 'started', position: 1 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 0 },
  ];

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_statuses (id, project_id, name, category, position, is_default)
      VALUES (?, 'test-project', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }
}

function createTestTickets(db: Database.Database) {
  const statusMap: Record<string, string> = {
    'backlog': 'status-backlog',
    'in_progress': 'status-in-progress',
    'blocked': 'status-blocked',
    'done': 'status-done',
  };

  const tickets = [
    { id: 'TEST-001', title: 'Add login', assignee: 'alice', priority: 'HIGH', column: 'backlog', status: 'backlog' },
    { id: 'TEST-002', title: 'Setup CI', assignee: 'bob', priority: 'MEDIUM', column: 'backlog', status: 'backlog' },
    { id: 'TEST-003', title: 'Navigation', assignee: 'alice', priority: 'HIGH', column: 'in-progress', status: 'in_progress' },
    { id: 'TEST-004', title: 'Database', assignee: 'bob', priority: 'HIGH', column: 'in-progress', status: 'in_progress' },
    { id: 'TEST-005', title: 'Linting', assignee: 'alice', priority: 'LOW', column: 'merged', status: 'done' },
    { id: 'TEST-006', title: 'Docs', assignee: null, priority: 'LOW', column: 'backlog', status: 'backlog' },
    { id: 'TEST-007', title: 'Blocked task', assignee: 'alice', priority: 'HIGH', column: 'in-progress', status: 'blocked' },
  ];

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    const statusId = statusMap[t.status] || 'status-backlog';
    db.prepare(`
      INSERT INTO pmo_tickets (id, project_id, title, assignee, priority, status, status_id)
      VALUES (?, 'test-project', ?, ?, ?, ?, ?)
    `).run(t.id, t.title, t.assignee, t.priority, t.status, statusId);

    db.prepare(`
      INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
      VALUES ('test-project', ?, ?, ?)
    `).run(t.id, t.column, i);
  }
}

function exec(cmd: string): string {
  try {
    const binPath = path.join(__dirname, '../../bin/run.js');
    return execSync(`node ${binPath} ${cmd}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
  } catch (error: any) {
    return error.stdout || error.stderr || error.message;
  }
}
