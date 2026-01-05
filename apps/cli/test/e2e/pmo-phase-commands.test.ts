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
 * End-to-end tests for PMO Phase Commands
 * Tests: prlt phase list, create, update, delete, move
 */
describe('PMO Phase Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-phase-e2e-'));
    process.chdir(testDir);

    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
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

  describe('prlt phase list', () => {
    it('should list all phases', () => {
      const output = exec('phase list');

      expect(output).to.contain('Idea');
      expect(output).to.contain('Planned');
      expect(output).to.contain('Active');
      expect(output).to.contain('Completed');
      expect(output).to.contain('Canceled');
    });

    it('should show phase categories', () => {
      const output = exec('phase list');

      // Categories are displayed in uppercase
      expect(output).to.contain('BACKLOG');
      expect(output).to.contain('UNSTARTED');
      expect(output).to.contain('STARTED');
      expect(output).to.contain('COMPLETED');
      expect(output).to.contain('CANCELED');
    });

    it('should indicate default phase', () => {
      const output = exec('phase list');

      expect(output).to.contain('default');
    });

    it('should filter by category', () => {
      const output = exec('phase list --category started');

      expect(output).to.contain('Active');
      expect(output).not.to.contain('Idea');
      expect(output).not.to.contain('Planned');
    });
  });

  describe('prlt phase create', () => {
    it('should create phase with name and category', () => {
      // Name is a positional argument, not a flag
      const output = exec('phase create "On Hold" --category unstarted');

      expect(output).to.contain('Created phase');
      expect(output).to.contain('On Hold');

      const phase = db.prepare('SELECT * FROM pmo_phases WHERE name = ?').get('On Hold') as { id: string; category: string };
      expect(phase).to.not.be.undefined;
      expect(phase.category).to.equal('unstarted');
    });

    it('should create phase with description', () => {
      exec('phase create "Review Phase" --category started --description "Projects under review"');

      const phase = db.prepare('SELECT description FROM pmo_phases WHERE name = ?').get('Review Phase') as { description: string };
      expect(phase).to.not.be.undefined;
      expect(phase.description).to.equal('Projects under review');
    });

    it('should create phase with color', () => {
      exec('phase create "Colored Phase" --category started --color "#FF5733"');

      const phase = db.prepare('SELECT color FROM pmo_phases WHERE name = ?').get('Colored Phase') as { color: string };
      expect(phase).to.not.be.undefined;
      expect(phase.color).to.equal('#FF5733');
    });

    it('should set as default when --default flag used', () => {
      exec('phase create "New Default" --category backlog --default');

      const phase = db.prepare('SELECT is_default FROM pmo_phases WHERE name = ?').get('New Default') as { is_default: number };
      expect(phase).to.not.be.undefined;
      expect(phase.is_default).to.equal(1);

      // Previous default should be unset
      const oldDefault = db.prepare('SELECT is_default FROM pmo_phases WHERE name = ?').get('Idea') as { is_default: number };
      expect(oldDefault.is_default).to.equal(0);
    });

    it('should error when phase name already exists', () => {
      // "Active" already exists in seed data
      const output = exec('phase create "Active" --category started');

      expect(output.toLowerCase()).to.contain('already exists');
    });

    it('should slugify phase ID from name', () => {
      exec('phase create "Phase With Spaces" --category started');

      const phase = db.prepare('SELECT id FROM pmo_phases WHERE name = ?').get('Phase With Spaces') as { id: string };
      expect(phase).to.not.be.undefined;
      expect(phase.id).to.equal('phase-with-spaces');
    });
  });

  describe('prlt phase update', () => {
    it('should update phase name', () => {
      exec('phase update idea --name "New Idea"');

      const phase = db.prepare('SELECT name FROM pmo_phases WHERE id = ?').get('idea') as { name: string };
      expect(phase.name).to.equal('New Idea');
    });

    it('should update phase category', () => {
      exec('phase update idea --category unstarted');

      const phase = db.prepare('SELECT category FROM pmo_phases WHERE id = ?').get('idea') as { category: string };
      expect(phase.category).to.equal('unstarted');
    });

    it('should update phase color', () => {
      exec('phase update active --color "#00FF00"');

      const phase = db.prepare('SELECT color FROM pmo_phases WHERE id = ?').get('active') as { color: string };
      expect(phase.color).to.equal('#00FF00');
    });

    it('should update phase description', () => {
      exec('phase update active --description "Updated description"');

      const phase = db.prepare('SELECT description FROM pmo_phases WHERE id = ?').get('active') as { description: string };
      expect(phase.description).to.equal('Updated description');
    });

    it('should set phase as default', () => {
      exec('phase update planned --default');

      const planned = db.prepare('SELECT is_default FROM pmo_phases WHERE id = ?').get('planned') as { is_default: number };
      expect(planned.is_default).to.equal(1);

      // Old default should be unset
      const idea = db.prepare('SELECT is_default FROM pmo_phases WHERE id = ?').get('idea') as { is_default: number };
      expect(idea.is_default).to.equal(0);
    });

    it('should error when phase not found', () => {
      const output = exec('phase update non-existent --name "New Name"');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error when no changes specified', () => {
      const output = exec('phase update active');

      expect(output.toLowerCase()).to.contain('no changes');
    });
  });

  describe('prlt phase delete', () => {
    it('should delete phase', () => {
      // Create a phase we can delete
      exec('phase create "Deletable" --category started');

      exec('phase delete deletable --force');

      const phase = db.prepare('SELECT * FROM pmo_phases WHERE id = ?').get('deletable');
      expect(phase).to.be.undefined;
    });

    it('should error when phase not found', () => {
      const output = exec('phase delete non-existent --force');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error when projects are using the phase', () => {
      // Create a project using the active phase
      db.prepare(`
        INSERT INTO pmo_projects (id, name, phase_id, is_archived)
        VALUES ('test-proj', 'Test Project', 'active', 0)
      `).run();

      const output = exec('phase delete active --force');

      expect(output.toLowerCase()).to.contain('using it');
    });

    it('should show success message', () => {
      exec('phase create "To Delete" --category canceled');
      const output = exec('phase delete to-delete --force');

      expect(output).to.contain('Deleted phase');
      expect(output).to.contain('To Delete');
    });
  });

  describe('prlt phase move', () => {
    beforeEach(() => {
      // Create multiple phases in the same category
      exec('phase create "Started A" --category started');
      exec('phase create "Started B" --category started');
      exec('phase create "Started C" --category started');
    });

    it('should change phase position', () => {
      // Move Started C to position 0
      const output = exec('phase move started-c --position 0');

      expect(output).to.contain('Moved phase');
      expect(output).to.contain('Started C');
      expect(output).to.contain('position 0');

      const phase = db.prepare('SELECT position FROM pmo_phases WHERE id = ?').get('started-c') as { position: number };
      expect(phase.position).to.equal(0);
    });

    it('should error when phase not found', () => {
      const output = exec('phase move non-existent --position 0');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });
});

// Helper functions

function setupTestDatabase(db: Database.Database) {
  db.exec(`
    -- Settings table
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Phases table (project lifecycle states)
    CREATE TABLE IF NOT EXISTS pmo_phases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Projects table
    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT,
      description TEXT,
      status TEXT DEFAULT 'active',
      phase_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      target_date TEXT,
      initiative_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (phase_id) REFERENCES pmo_phases(id) ON DELETE SET NULL
    );

    -- Columns table
    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, id)
    );

    -- Workflow statuses table
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
      project_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'backlog',
      status_id TEXT,
      branch TEXT,
      priority TEXT,
      category TEXT,
      description TEXT,
      owner TEXT,
      assignee TEXT,
      spec_id TEXT,
      epic_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (status_id) REFERENCES pmo_statuses(id)
    );

    -- Board tickets table
    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (project_id, ticket_id)
    );

    -- Workflow templates table
    CREATE TABLE IF NOT EXISTS pmo_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      statuses TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
  `);

  // Seed default phases
  const defaultPhases = [
    { id: 'idea', name: 'Idea', category: 'backlog', position: 0, description: 'Project concept', isDefault: 1 },
    { id: 'planned', name: 'Planned', category: 'unstarted', position: 0, description: 'Scheduled for work' },
    { id: 'active', name: 'Active', category: 'started', position: 0, description: 'Work in progress' },
    { id: 'completed', name: 'Completed', category: 'completed', position: 0, description: 'Finished' },
    { id: 'canceled', name: 'Canceled', category: 'canceled', position: 0, description: 'Won\'t be done' },
  ];

  for (const phase of defaultPhases) {
    db.prepare(`
      INSERT INTO pmo_phases (id, name, category, position, description, is_default)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(phase.id, phase.name, phase.category, phase.position, phase.description, phase.isDefault || 0);
  }

  // Create default project
  db.prepare(`
    INSERT INTO pmo_projects (id, name, phase_id, is_archived)
    VALUES ('default', 'Default Project', 'idea', 0)
  `).run();

  db.prepare(`INSERT INTO pmo_settings (key, value) VALUES ('pmo_path', 'pmo')`).run();
  db.prepare(`INSERT INTO pmo_settings (key, value) VALUES ('current_project', 'default')`).run();

  // Create default columns
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in_progress', name: 'In Progress', position: 1 },
    { id: 'done', name: 'Done', position: 2 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'default', ?, ?)
    `).run(col.id, col.name, col.position);
  }

  // Seed default statuses for test project
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
      VALUES (?, 'default', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }

  // Create HQ config file
  const proletariatDir = path.join(process.cwd(), '.proletariat');
  const configPath = path.join(proletariatDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    type: 'hq',
    name: 'test-hq',
    hasPmo: true,
  }), 'utf-8');

  // Create PMO directory structure
  const pmoPath = path.join(process.cwd(), 'pmo/projects/default');
  fs.mkdirSync(pmoPath, { recursive: true });
}

function exec(cmd: string): string {
  try {
    const binPath = path.join(__dirname, '../../bin/run.js');
    const result = execSync(`${binPath} ${cmd}`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });
    return result;
  } catch (error: any) {
    const stdout = error.stdout || '';
    const stderr = error.stderr || '';
    if (stdout.trim()) {
      return stdout;
    }
    const filteredStderr = stderr.split('\n').filter((line: string) =>
      !line.includes('[ERR_UNKNOWN_FILE_EXTENSION]') &&
      !line.includes('Warning:') &&
      !line.includes('module: @oclif')
    ).join('\n');
    return filteredStderr || error.message;
  }
}
