import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { exec, filterOutput } from './test-helpers.js';

/**
 * End-to-end tests for PMO Roadmap Commands
 * Tests: prlt roadmap create, list, view, update, delete, add-project, remove-project, reorder, generate
 */
describe('PMO Roadmap Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-roadmap-e2e-'));
    process.chdir(testDir);

    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    // Create pmo directory structure
    const pmoPath = path.join(testDir, 'pmo');
    fs.mkdirSync(path.join(pmoPath, 'projects', 'test-project'), { recursive: true });
    fs.mkdirSync(path.join(pmoPath, 'roadmaps'), { recursive: true });

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

  describe('prlt roadmap create', () => {
    it('should create roadmap with name argument', () => {
      const output = exec('roadmap create "Public Roadmap"');

      expect(filterOutput(output)).to.contain('Created roadmap');

      const roadmaps = db.prepare('SELECT * FROM pmo_roadmaps WHERE name = ?').all('Public Roadmap') as Array<{ id: string }>;
      expect(roadmaps).to.have.lengthOf(1);
    });

    it('should create roadmap with flags', () => {
      exec('roadmap create --name "Internal Roadmap" --description "Internal planning"');

      const roadmaps = db.prepare('SELECT * FROM pmo_roadmaps WHERE name = ?').all('Internal Roadmap') as Array<{ description: string }>;
      expect(roadmaps).to.have.lengthOf(1);
      expect(roadmaps[0].description).to.equal('Internal planning');
    });

    it('should auto-generate roadmap ID from name', () => {
      exec('roadmap create "My Test Roadmap"');

      const roadmaps = db.prepare('SELECT id FROM pmo_roadmaps WHERE name = ?').all('My Test Roadmap') as Array<{ id: string }>;
      expect(roadmaps).to.have.lengthOf(1);
      expect(roadmaps[0].id).to.equal('roadmap-my-test-roadmap');
    });

    it('should create roadmap with custom ID', () => {
      exec('roadmap create --name "Custom" --id my-custom-id');

      const roadmaps = db.prepare('SELECT id FROM pmo_roadmaps WHERE id = ?').all('my-custom-id') as Array<{ id: string }>;
      expect(roadmaps).to.have.lengthOf(1);
    });
  });

  describe('prlt roadmap list', () => {
    it('should list all roadmaps', () => {
      // Create roadmaps via CLI
      exec('roadmap create "Roadmap 1"');
      exec('roadmap create "Roadmap 2"');

      const output = exec('roadmap list');

      expect(filterOutput(output)).to.contain('Roadmap 1');
      expect(filterOutput(output)).to.contain('Roadmap 2');
    });
  });

  describe('prlt roadmap view', () => {
    it('should show roadmap details', () => {
      exec('roadmap create --name "Test Roadmap" --description "A test roadmap" --id test-roadmap');

      const output = exec('roadmap view test-roadmap');

      expect(filterOutput(output)).to.contain('Test Roadmap');
    });
  });

  describe('prlt roadmap update', () => {
    it('should update roadmap name', () => {
      exec('roadmap create --name "Original Name" --id update-test');

      exec('roadmap update update-test --name "Updated Name"');

      const roadmap = db.prepare('SELECT name FROM pmo_roadmaps WHERE id = ?').get('update-test') as { name: string };
      expect(roadmap.name).to.equal('Updated Name');
    });

    it('should update roadmap description', () => {
      exec('roadmap create --name "Test" --id update-test');

      exec('roadmap update update-test --description "Updated description"');

      const roadmap = db.prepare('SELECT description FROM pmo_roadmaps WHERE id = ?').get('update-test') as { description: string };
      expect(roadmap.description).to.equal('Updated description');
    });
  });

  describe('prlt roadmap delete', () => {
    it('should delete roadmap with force flag', () => {
      exec('roadmap create --name "To Delete" --id to-delete');

      exec('roadmap delete to-delete --force');

      const roadmap = db.prepare('SELECT * FROM pmo_roadmaps WHERE id = ?').get('to-delete');
      expect(roadmap).to.be.undefined;
    });
  });

  describe('prlt roadmap add-project', () => {
    it('should add project to roadmap', () => {
      exec('roadmap create --name "Roadmap" --id roadmap');

      exec('roadmap add-project roadmap test-project');

      const associations = db.prepare('SELECT * FROM pmo_roadmap_projects WHERE roadmap_id = ? AND project_id = ?').all('roadmap', 'test-project');
      expect(associations).to.have.lengthOf(1);
    });
  });

  describe('prlt roadmap remove-project', () => {
    it('should remove project from roadmap', () => {
      exec('roadmap create --name "Roadmap" --id roadmap');
      exec('roadmap add-project roadmap test-project');

      exec('roadmap remove-project roadmap test-project --force');

      const associations = db.prepare('SELECT * FROM pmo_roadmap_projects WHERE roadmap_id = ? AND project_id = ?').all('roadmap', 'test-project');
      expect(associations).to.have.lengthOf(0);
    });

    it('should not delete the project itself', () => {
      exec('roadmap create --name "Roadmap" --id roadmap');
      exec('roadmap add-project roadmap test-project');

      exec('roadmap remove-project roadmap test-project --force');

      const project = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('test-project');
      expect(project).to.not.be.undefined;
    });
  });

  describe('prlt roadmap reorder', () => {
    beforeEach(() => {
      // Create additional projects
      db.prepare(`INSERT INTO pmo_projects (id, name) VALUES ('project-2', 'Project 2')`).run();
      db.prepare(`INSERT INTO pmo_projects (id, name) VALUES ('project-3', 'Project 3')`).run();
    });

    it('should reorder project to new position', () => {
      exec('roadmap create --name "Roadmap" --id roadmap');
      exec('roadmap add-project roadmap test-project');
      exec('roadmap add-project roadmap project-2');
      exec('roadmap add-project roadmap project-3');

      exec('roadmap reorder roadmap --project project-3 --position 0');

      const projects = db.prepare('SELECT project_id FROM pmo_roadmap_projects WHERE roadmap_id = ? ORDER BY position').all('roadmap') as Array<{ project_id: string }>;
      expect(projects[0].project_id).to.equal('project-3');
    });
  });

  describe('prlt roadmap generate', () => {
    it('should generate markdown file', () => {
      exec('roadmap create --name "Generated Roadmap" --description "Test generation" --id gen-test');
      exec('roadmap add-project gen-test test-project');
      // Add a ticket for the project
      db.prepare(`INSERT INTO pmo_tickets (id, project_id, title, priority, status_id) VALUES ('TKT-001', 'test-project', 'Test Ticket', 'P0', 'backlog')`).run();

      const output = exec('roadmap generate gen-test');

      expect(filterOutput(output)).to.contain('Generated');

      const mdPath = path.join(testDir, 'pmo', 'roadmaps', 'generated-roadmap.md');
      expect(fs.existsSync(mdPath)).to.be.true;
    });

    it('should generate all roadmaps with --all flag', () => {
      exec('roadmap create --name "Roadmap One" --id r1');
      exec('roadmap create --name "Roadmap Two" --id r2');

      const output = exec('roadmap generate --all');

      expect(filterOutput(output)).to.contain('Generated 2 roadmap');
    });
  });
});

/**
 * Sets up the test database with required schema
 */
function setupTestDatabase(db: Database.Database) {
  db.exec(`
    -- Settings table
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Projects table
    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT,
      description TEXT,
      initiative_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Roadmaps table
    CREATE TABLE IF NOT EXISTS pmo_roadmaps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Roadmap Projects join table
    CREATE TABLE IF NOT EXISTS pmo_roadmap_projects (
      roadmap_id TEXT NOT NULL REFERENCES pmo_roadmaps(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES pmo_projects(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (roadmap_id, project_id)
    );

    -- Statuses table
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

    -- Tickets table
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

    -- Columns table (needed for board operations)
    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, id)
    );

    -- Board tickets table
    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL UNIQUE,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE
    );

    -- Indexes for roadmaps
    CREATE INDEX IF NOT EXISTS idx_pmo_roadmap_projects_roadmap ON pmo_roadmap_projects(roadmap_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_roadmap_projects_position ON pmo_roadmap_projects(roadmap_id, position);
    CREATE INDEX IF NOT EXISTS idx_pmo_roadmaps_default ON pmo_roadmaps(is_default);
  `);

  // Insert test project
  db.prepare(`
    INSERT INTO pmo_projects (id, name, template)
    VALUES ('test-project', 'Test Project', 'kanban')
  `).run();

  // Insert settings
  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', 'pmo'), ('current_project', 'test-project')
  `).run();

  // Insert statuses for test project
  const statuses = [
    { id: 'backlog', name: 'Backlog', category: 'backlog', position: 0 },
    { id: 'in-progress', name: 'In Progress', category: 'started', position: 1 },
    { id: 'done', name: 'Done', category: 'completed', position: 2 },
  ];

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_statuses (id, project_id, name, category, position, is_default)
      VALUES (?, 'test-project', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.position === 0 ? 1 : 0);
  }

  // Insert columns for test project
  const columns = [
    { id: 'backlog', name: 'SHIP BL', position: 0 },
    { id: 'in-progress', name: 'In Progress', position: 1 },
    { id: 'done', name: 'Done', position: 2 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `).run(col.id, col.name, col.position);
  }
}
