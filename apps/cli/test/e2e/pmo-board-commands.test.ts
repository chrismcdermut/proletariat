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
 * Integration tests for PMO Board Commands
 * Tests: prlt board view, open, markdown, export, sync, watch
 * Spec: pmo-board-commands.md
 *
 * SKIPPED: These commands (board view, markdown, sync, export) are not yet implemented.
 * See ticket TKT-041 for implementation tracking.
 */
describe.skip('PMO Board Commands Integration Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let pmoPath: string;
  let boardPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-board-test-'));
    process.chdir(testDir);

    // Create .proletariat directory
    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    // Create PMO directory structure
    pmoPath = path.join(testDir, 'pmo');
    const projectPath = path.join(pmoPath, 'projects', 'test-project');
    fs.mkdirSync(projectPath, { recursive: true });
    boardPath = path.join(projectPath, 'board.md');

    // Initialize test database with schema
    db = new Database(dbPath);
    setupTestDatabase(db, testDir);
  });

  afterEach(() => {
    if (db) db.close();
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('prlt board view', () => {
    it('should display board with tickets organized by column', () => {
      // Create test tickets
      createTestTicket(db, 'TEST-001', 'Add login screen', 'backlog', 'HIGH');
      createTestTicket(db, 'TEST-002', 'Setup CI/CD', 'backlog', 'MEDIUM');
      createTestTicket(db, 'TEST-003', 'Implement navigation', 'in-progress', 'HIGH');

      const output = execCommand('board view');

      expect(output).to.contain('Board');
      expect(output).to.contain('TEST-001');
      expect(output).to.contain('Add login screen');
      expect(output).to.contain('P:HIGH');
    });

    it('should show ticket counts per column', () => {
      createTestTicket(db, 'TEST-001', 'Ticket 1', 'backlog', 'HIGH');
      createTestTicket(db, 'TEST-002', 'Ticket 2', 'backlog', 'LOW');

      const output = execCommand('board view');

      expect(output).to.match(/Backlog.*\(2\)/);
    });

    it('should handle empty board gracefully', () => {
      const output = execCommand('board view');

      expect(output).to.not.throw;
      expect(output).to.contain('Board');
    });
  });

  describe('prlt board markdown', () => {
    it('should output valid Obsidian Kanban markdown', () => {
      createTestTicket(db, 'TEST-001', 'Add login screen', 'backlog', 'HIGH');

      const output = execCommand('board markdown');

      expect(output).to.contain('## SHIP BL');
      expect(output).to.contain('**TEST-001**');
      expect(output).to.contain('[[TEST-001]]');
      expect(output).to.contain('Add login screen');
      expect(output).to.contain('**Priority:** HIGH');
    });

    it('should be pipeable to file', () => {
      createTestTicket(db, 'TEST-001', 'Test ticket', 'backlog', 'MEDIUM');

      const outputPath = path.join(testDir, 'board-export.md');
      execCommand(`board markdown > ${outputPath}`);

      expect(fs.existsSync(outputPath)).to.be.true;
      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).to.contain('**TEST-001**');
    });
  });

  describe('prlt board sync', () => {
    it('should sync from database to board.md when DB is newer', () => {
      createTestTicket(db, 'TEST-001', 'New ticket', 'backlog', 'HIGH');

      // Run sync (should export to board.md)
      execCommand('board sync --direction export');

      expect(fs.existsSync(boardPath)).to.be.true;
      const content = fs.readFileSync(boardPath, 'utf-8');
      expect(content).to.contain('TEST-001');
      expect(content).to.contain('New ticket');
    });

    it('should sync from board.md to database when board is newer', () => {
      // Create board.md manually
      const boardContent = `
## SHIP BL

- [ ] **TEST-002** [[TEST-002]] Manual ticket
      **Priority:** MEDIUM
      **Category:** feature
      ***
      Created manually in board.md
`;
      fs.writeFileSync(boardPath, boardContent);

      // Run sync (should import from board.md)
      execCommand('board sync --direction import');

      // Check database
      const ticket = db.prepare('SELECT * FROM pmo_tickets WHERE id = ?').get('TEST-002') as { title: string } | undefined;
      expect(ticket).to.exist;
      expect(ticket!.title).to.equal('Manual ticket');
    });

    it('should detect and show changes before syncing', () => {
      createTestTicket(db, 'TEST-001', 'Original', 'backlog', 'LOW');

      // Export first
      execCommand('board sync --direction export');

      // Modify ticket in DB
      db.prepare('UPDATE pmo_tickets SET title = ? WHERE id = ?').run('Modified', 'TEST-001');

      // Sync should show changes
      const output = execCommand('board sync --dry-run --direction export');

      expect(output).to.contain('Changes detected');
      expect(output).to.contain('TEST-001');
    });
  });

  describe('prlt board export', () => {
    it('should export to markdown format', () => {
      createTestTicket(db, 'TEST-001', 'Export test', 'backlog', 'HIGH');

      const outputPath = path.join(testDir, 'export.md');
      execCommand(`board export --format markdown -o ${outputPath}`);

      expect(fs.existsSync(outputPath)).to.be.true;
      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).to.contain('TEST-001');
    });

    it('should export to JSON format', () => {
      createTestTicket(db, 'TEST-001', 'JSON test', 'backlog', 'MEDIUM');

      const outputPath = path.join(testDir, 'export.json');
      execCommand(`board export --format json -o ${outputPath}`);

      expect(fs.existsSync(outputPath)).to.be.true;
      const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(data).to.have.property('columns');
    });

    it('should export to CSV format', () => {
      createTestTicket(db, 'TEST-001', 'CSV test', 'backlog', 'LOW');

      const outputPath = path.join(testDir, 'export.csv');
      execCommand(`board export --format csv -o ${outputPath}`);

      expect(fs.existsSync(outputPath)).to.be.true;
      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).to.contain('TEST-001');
    });
  });

  describe('prlt board open', () => {
    it('should attempt to open board in editor', () => {
      // This test is limited - we can't actually launch an editor
      // But we can verify the board.md file exists
      createTestTicket(db, 'TEST-001', 'Test', 'backlog', 'HIGH');
      execCommand('board sync --direction export');

      expect(fs.existsSync(boardPath)).to.be.true;
    });
  });
});

// Helper functions
function setupTestDatabase(db: Database.Database, testDir: string) {
  // Create PMO tables
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
      branch TEXT,
      owner TEXT,
      assignee TEXT,
      spec_id TEXT,
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

    CREATE TABLE IF NOT EXISTS pmo_specs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
    );
  `);

  // Insert test project and columns
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description)
    VALUES ('test-project', 'Test Project', 'Integration test project')
  `).run();

  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', 'pmo')
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

  const statuses = [
    { id: 'status-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'status-todo', name: 'Todo', category: 'unstarted', position: 0 },
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 0 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 0 },
    { id: 'status-canceled', name: 'Canceled', category: 'canceled', position: 0 },
  ];

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_statuses (id, project_id, name, category, position, is_default)
      VALUES (?, 'test-project', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }
}

function createTestTicket(
  db: Database.Database,
  id: string,
  title: string,
  columnId: string,
  priority: string
) {
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO pmo_tickets (
      id, project_id, title, description, priority, category,
      status, created_at, updated_at
    )
    VALUES (?, 'test-project', ?, ?, ?, 'feature', 'backlog', ?, ?)
  `).run(id, title, `Description for ${title}`, priority, now, now);

  // Get max position in column
  const maxPos = db.prepare(`
    SELECT COALESCE(MAX(position), -1) as max_pos
    FROM pmo_board_tickets
    WHERE column_id = ?
  `).get(columnId) as { max_pos: number };

  db.prepare(`
    INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
    VALUES ('test-project', ?, ?, ?)
  `).run(id, columnId, maxPos.max_pos + 1);
}

function execCommand(cmd: string): string {
  try {
    const binPath = path.join(__dirname, '../../bin/run.js');
    return execSync(`node ${binPath} ${cmd}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error: any) {
    // Command may fail in test environment - return output anyway
    return error.stdout || error.message;
  }
}
