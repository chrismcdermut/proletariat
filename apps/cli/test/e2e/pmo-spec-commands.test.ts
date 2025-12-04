import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';

/**
 * End-to-end tests for PMO Spec Commands
 * Tests: prlt spec create, list, view, generate-tickets
 * Spec: pmo-spec-commands.md
 */
describe('PMO Spec Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;
  let specsDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-spec-e2e-'));
    process.chdir(testDir);

    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    specsDir = path.join(testDir, 'pmo/projects/test-project/specs/active');
    fs.mkdirSync(specsDir, { recursive: true });

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

  describe('prlt spec create', () => {
    it('should create spec file with frontmatter', () => {
      exec('spec create --title "Auth System" --status active');

      const specFiles = fs.readdirSync(specsDir);
      expect(specFiles).to.have.lengthOf.greaterThan(0);

      const specPath = path.join(specsDir, specFiles[0]);
      const content = fs.readFileSync(specPath, 'utf-8');

      expect(content).to.contain('---');
      expect(content).to.contain('title: Auth System');
      expect(content).to.contain('tickets:');
    });

    it('should register spec in database', () => {
      exec('spec create --title "Database Schema"');

      const specs = db.prepare('SELECT * FROM pmo_specs WHERE title = ?').all('Database Schema') as Array<{ status: string }>;
      expect(specs).to.have.lengthOf(1);
      expect(specs[0].status).to.equal('active');
    });
  });

  describe('prlt spec list', () => {
    it('should list all specs', () => {
      exec('spec create --title "Spec 1"');
      exec('spec create --title "Spec 2"');

      const output = exec('spec list');

      expect(output).to.contain('Spec 1');
      expect(output).to.contain('Spec 2');
    });

    it('should show spec status', () => {
      exec('spec create --title "Active Spec" --status active');

      const output = exec('spec list');

      expect(output).to.contain('active');
    });
  });

  describe('prlt spec view', () => {
    it('should display spec details and linked tickets', () => {
      // Create spec
      exec('spec create --title "View Test"');
      const spec = db.prepare('SELECT id FROM pmo_specs WHERE title = ?').get('View Test') as { id: string };

      const output = exec(`spec view ${spec.id}`);

      expect(output).to.contain('View Test');
      expect(output).to.contain('Spec');
    });
  });

  describe('prlt spec generate-tickets', () => {
    it('should generate tickets from spec frontmatter', () => {
      // Create spec file manually with tickets
      const specContent = `---
title: Test Spec
created: 2024-11-29
tickets:
  - id: test-spec-001
    title: First ticket
    description: Test ticket 1
    priority: HIGH
    category: feature
  - id: test-spec-002
    title: Second ticket
    description: Test ticket 2
    priority: MEDIUM
    category: feature
---

# Test Spec

Spec content here.
`;
      const specPath = path.join(specsDir, 'test-spec.md');
      fs.writeFileSync(specPath, specContent);

      // Register spec
      db.prepare(`
        INSERT INTO pmo_specs (id, project_id, title, file_path, status)
        VALUES ('test-spec', 'test-project', 'Test Spec', ?, 'active')
      `).run(specPath);

      // Generate tickets
      exec('spec generate-tickets test-spec');

      // Verify tickets created
      const tickets = db.prepare('SELECT * FROM pmo_tickets WHERE spec_id = ?').all('test-spec') as Array<{ id: string; title: string; priority: string }>;
      expect(tickets).to.have.lengthOf(2);
      expect(tickets[0].id).to.equal('test-spec-001');
      expect(tickets[0].title).to.equal('First ticket');
      expect(tickets[0].priority).to.equal('HIGH');
      expect(tickets[1].id).to.equal('test-spec-002');
    });

    it('should add generated tickets to board.md', () => {
      const specContent = `---
title: Board Test
tickets:
  - id: board-test-001
    title: Board ticket
    priority: HIGH
    category: feature
---

# Board Test
`;
      const specPath = path.join(specsDir, 'board-test.md');
      fs.writeFileSync(specPath, specContent);

      db.prepare(`
        INSERT INTO pmo_specs (id, project_id, title, file_path, status)
        VALUES ('board-test', 'test-project', 'Board Test', ?, 'active')
      `).run(specPath);

      exec('spec generate-tickets board-test');

      const boardPath = path.join(testDir, 'pmo/projects/test-project/board.md');
      const content = fs.readFileSync(boardPath, 'utf-8');

      expect(content).to.contain('board-test-001');
      expect(content).to.contain('Board ticket');
    });

    it('should handle dry-run flag', () => {
      const specContent = `---
title: Dry Run Test
tickets:
  - id: dry-run-001
    title: Test ticket
    priority: MEDIUM
    category: feature
---
`;
      const specPath = path.join(specsDir, 'dry-run.md');
      fs.writeFileSync(specPath, specContent);

      db.prepare(`
        INSERT INTO pmo_specs (id, project_id, title, file_path, status)
        VALUES ('dry-run', 'test-project', 'Dry Run Test', ?, 'active')
      `).run(specPath);

      const output = exec('spec generate-tickets dry-run --dry-run');

      // Should show what would be created
      expect(output).to.contain('dry-run-001');

      // Should NOT create tickets
      const tickets = db.prepare('SELECT * FROM pmo_tickets WHERE spec_id = ?').all('dry-run');
      expect(tickets).to.have.lengthOf(0);
    });
  });

  describe('prlt spec link', () => {
    it('should link existing ticket to spec', () => {
      // Create spec
      exec('spec create --title "Link Test"');
      const spec = db.prepare('SELECT id FROM pmo_specs WHERE title = ?').get('Link Test') as { id: string };

      // Create ticket
      db.prepare(`
        INSERT INTO pmo_tickets (id, project_id, title, description)
        VALUES ('LINK-001', 'test-project', 'Linkable', 'Test')
      `).run();

      // Link them
      exec(`spec link LINK-001 ${spec.id}`);

      // Verify link
      const ticket = db.prepare('SELECT spec_id FROM pmo_tickets WHERE id = ?').get('LINK-001') as { spec_id: string };
      expect(ticket.spec_id).to.equal(spec.id);
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

    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'MEDIUM',
      category TEXT DEFAULT 'feature',
      status TEXT DEFAULT 'backlog',
      owner TEXT,
      assignee TEXT,
      spec_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TEXT,
      last_synced_from_board TEXT,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL
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

  db.prepare(`
    INSERT INTO pmo_projects (id, name)
    VALUES ('test-project', 'Test Project')
  `).run();

  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', 'pmo'), ('current_project', 'test-project')
  `).run();

  const columns = [
    { id: 'backlog', name: 'BUILD BL', position: 0 },
    { id: 'ready', name: 'Ready', position: 1 },
    { id: 'merged', name: 'Merged', position: 2 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `).run(col.id, col.name, col.position);
  }

  const pmoPath = path.join(process.cwd(), 'pmo/projects/test-project');
  fs.mkdirSync(pmoPath, { recursive: true });
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
