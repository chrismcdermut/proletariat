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
 * End-to-end tests for PMO Project Commands
 * Tests: prlt project create, list, view, delete
 */
describe('PMO Project Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-project-e2e-'));
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

  describe('prlt project create', () => {
    it('should create project with positional name argument', () => {
      const output = exec('project create "My New Project"');

      const projects = db.prepare('SELECT * FROM pmo_projects WHERE name = ?').all('My New Project') as Array<{ id: string; name: string }>;
      expect(projects).to.have.lengthOf(1);
      expect(projects[0].id).to.equal('my-new-project');
      expect(output).to.contain('Created project');
      expect(output).to.contain('My New Project');
    });

    it('should create project with --name flag', () => {
      exec('project create --name "Flag Project"');

      const projects = db.prepare('SELECT * FROM pmo_projects WHERE name = ?').all('Flag Project') as Array<{ id: string }>;
      expect(projects).to.have.lengthOf(1);
      expect(projects[0].id).to.equal('flag-project');
    });

    it('should create project with custom ID', () => {
      exec('project create --name "Custom ID" --id custom-proj');

      const projects = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').all('custom-proj') as Array<{ name: string }>;
      expect(projects).to.have.lengthOf(1);
      expect(projects[0].name).to.equal('Custom ID');
    });

    it('should create project with description', () => {
      exec('project create --name "Described Project" --description "A project with a description"');

      const project = db.prepare('SELECT description FROM pmo_projects WHERE name = ?').get('Described Project') as { description: string };
      expect(project.description).to.equal('A project with a description');
    });

    it('should create project folder structure', () => {
      exec('project create --name "Folder Test"');

      const projectPath = path.join(testDir, 'pmo/projects/folder-test');
      expect(fs.existsSync(projectPath)).to.be.true;
    });

    it('should create kanban.md board file', () => {
      exec('project create --name "Board Test"');

      const boardPath = path.join(testDir, 'pmo/projects/board-test/kanban.md');
      expect(fs.existsSync(boardPath)).to.be.true;

      const content = fs.readFileSync(boardPath, 'utf-8');
      expect(content).to.contain('kanban-plugin');
    });

    it('should create epics folders', () => {
      exec('project create --name "Epic Folders"');

      const epicsPath = path.join(testDir, 'pmo/projects/epic-folders/epics');
      expect(fs.existsSync(path.join(epicsPath, 'draft'))).to.be.true;
      expect(fs.existsSync(path.join(epicsPath, 'active'))).to.be.true;
      expect(fs.existsSync(path.join(epicsPath, 'complete'))).to.be.true;
    });

    it('should use kanban template by default', () => {
      exec('project create --name "Default Template"');

      const boardPath = path.join(testDir, 'pmo/projects/default-template/kanban.md');
      const content = fs.readFileSync(boardPath, 'utf-8');

      // Kanban template has Backlog, In Progress, Done
      expect(content).to.contain('Backlog');
      expect(content).to.contain('In Progress');
      expect(content).to.contain('Done');
    });

    it('should use scrum template when specified', () => {
      exec('project create --name "Scrum Project" --template scrum');

      const boardPath = path.join(testDir, 'pmo/projects/scrum-project/kanban.md');
      const content = fs.readFileSync(boardPath, 'utf-8');

      // Scrum template has additional columns
      expect(content).to.contain('Backlog');
      expect(content).to.contain('In Review');
    });

    it('should error when project already exists', () => {
      exec('project create --name "Duplicate"');
      const output = exec('project create --name "Duplicate"');

      expect(output.toLowerCase()).to.contain('already exists');
    });

    it('should slugify project ID from name', () => {
      exec('project create --name "Project With Spaces"');

      const projects = db.prepare('SELECT id FROM pmo_projects WHERE name = ?').all('Project With Spaces') as Array<{ id: string }>;
      expect(projects[0].id).to.equal('project-with-spaces');
    });
  });

  describe('prlt project list', () => {
    it('should list all projects', () => {
      createTestProject(db, 'proj-1', 'Project One');
      createTestProject(db, 'proj-2', 'Project Two');

      const output = exec('project list');

      expect(output).to.contain('Project One');
      expect(output).to.contain('proj-1');
      expect(output).to.contain('Project Two');
      expect(output).to.contain('proj-2');
    });

    it('should show project ticket counts', () => {
      createTestProject(db, 'proj-with-tickets', 'Project With Tickets');
      createTestColumns(db, 'proj-with-tickets');
      createTestTicket(db, 'TKT-001', 'Ticket 1', 'proj-with-tickets');
      createTestTicket(db, 'TKT-002', 'Ticket 2', 'proj-with-tickets');

      const output = exec('project list');

      expect(output).to.contain('Tickets: 2');
    });

    it('should show project descriptions', () => {
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description)
        VALUES ('desc-proj', 'Described', 'This is a description')
      `).run();

      const output = exec('project list');

      expect(output).to.contain('This is a description');
    });

    it('should mark default project', () => {
      // The default project is already created by setupTestDatabase
      const output = exec('project list');

      expect(output).to.contain('default');
    });

    it('should show empty message when no projects', () => {
      // Clear all projects
      db.prepare('DELETE FROM pmo_projects').run();

      const output = exec('project list');

      expect(output.toLowerCase()).to.match(/no projects|create one/i);
    });
  });

  describe('prlt project view', () => {
    beforeEach(() => {
      createTestProject(db, 'view-project', 'View Test Project');
      createTestColumns(db, 'view-project');
    });

    it('should display project name and id', () => {
      const output = exec('project view view-project');

      expect(output).to.contain('View Test Project');
      expect(output).to.contain('view-project');
    });

    it('should display column names', () => {
      const output = exec('project view view-project');

      expect(output).to.contain('Backlog');
      expect(output).to.contain('In Progress');
      expect(output).to.contain('Done');
    });

    it('should show tickets in columns', () => {
      createTestTicket(db, 'TKT-001', 'First Ticket', 'view-project', 'backlog');
      createTestTicket(db, 'TKT-002', 'Second Ticket', 'view-project', 'in_progress');

      const output = exec('project view view-project');

      expect(output).to.contain('TKT-001');
      expect(output).to.contain('First Ticket');
      expect(output).to.contain('TKT-002');
      expect(output).to.contain('Second Ticket');
    });

    it('should show empty columns', () => {
      const output = exec('project view view-project');

      expect(output).to.contain('(empty)');
    });

    it('should show ticket priority and category', () => {
      db.prepare(`
        INSERT INTO pmo_tickets (id, project_id, title, priority, category, status)
        VALUES ('TKT-001', 'view-project', 'Prioritized', 'HIGH', 'feature', 'backlog')
      `).run();
      db.prepare(`
        INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
        VALUES ('view-project', 'TKT-001', 'backlog', 0)
      `).run();

      const output = exec('project view view-project');

      expect(output).to.contain('TKT-001');
      expect(output).to.contain('Prioritized');
    });

    it('should show subtask count', () => {
      createTestTicket(db, 'TKT-001', 'With Subtasks', 'view-project', 'backlog');
      db.prepare(`
        INSERT INTO pmo_subtasks (id, ticket_id, title, done, position)
        VALUES ('sub-1', 'TKT-001', 'Subtask 1', 0, 0)
      `).run();
      db.prepare(`
        INSERT INTO pmo_subtasks (id, ticket_id, title, done, position)
        VALUES ('sub-2', 'TKT-001', 'Subtask 2', 1, 1)
      `).run();

      const output = exec('project view view-project');

      expect(output).to.contain('[1/2] subtasks');
    });

    it('should error for non-existent project', () => {
      const output = exec('project view non-existent');

      expect(output.toLowerCase()).to.contain('not found');
    });

  });

  describe('prlt project delete', () => {
    beforeEach(() => {
      createTestProject(db, 'delete-project', 'Delete Test Project');
      createTestColumns(db, 'delete-project');

      // Create project folder
      const projectPath = path.join(testDir, 'pmo/projects/delete-project');
      fs.mkdirSync(projectPath, { recursive: true });
      fs.writeFileSync(path.join(projectPath, 'kanban.md'), 'test board');
    });

    it('should delete project from database', () => {
      exec('project delete delete-project --force');

      const project = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('delete-project');
      expect(project).to.be.undefined;
    });

    it('should delete project folder', () => {
      exec('project delete delete-project --force');

      const projectPath = path.join(testDir, 'pmo/projects/delete-project');
      expect(fs.existsSync(projectPath)).to.be.false;
    });

    it('should cascade delete tickets', () => {
      createTestTicket(db, 'TKT-001', 'Ticket 1', 'delete-project', 'backlog');
      createTestTicket(db, 'TKT-002', 'Ticket 2', 'delete-project', 'in_progress');

      exec('project delete delete-project --force');

      const tickets = db.prepare('SELECT * FROM pmo_tickets WHERE project_id = ?').all('delete-project');
      expect(tickets).to.have.lengthOf(0);
    });

    it('should refuse to delete default project', () => {
      const output = exec('project delete default --force');

      expect(output.toLowerCase()).to.contain('cannot delete');

      const project = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('default');
      expect(project).to.not.be.undefined;
    });

    it('should error for non-existent project', () => {
      const output = exec('project delete non-existent --force');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should show ticket count in output', () => {
      createTestTicket(db, 'TKT-001', 'Ticket 1', 'delete-project', 'backlog');
      createTestTicket(db, 'TKT-002', 'Ticket 2', 'delete-project', 'in_progress');

      const output = exec('project delete delete-project --force');

      expect(output).to.contain('2 ticket');
    });

    it('should show success message', () => {
      const output = exec('project delete delete-project --force');

      expect(output).to.contain('Deleted project');
      expect(output).to.contain('Delete Test Project');
    });
  });
});

// Helper functions

function setupTestDatabase(db: Database.Database) {
  // Use the complete schema from the actual codebase (matches schema.ts)
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Initiatives table
    CREATE TABLE IF NOT EXISTS pmo_initiatives (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      objective TEXT,
      key_results TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    -- Specs table (must be before tickets and epics due to FK)
    CREATE TABLE IF NOT EXISTS pmo_specs (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      title TEXT,
      overview TEXT,
      status TEXT DEFAULT 'active',
      spec_type TEXT DEFAULT 'domain',
      domain TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Spec abilities table
    CREATE TABLE IF NOT EXISTS pmo_spec_abilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(spec_id, name)
    );

    -- Spec implementations table
    CREATE TABLE IF NOT EXISTS pmo_spec_implementations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ability_id INTEGER NOT NULL REFERENCES pmo_spec_abilities(id) ON DELETE CASCADE,
      modality TEXT NOT NULL,
      signature TEXT NOT NULL,
      UNIQUE(ability_id, modality)
    );

    -- Spec fields table
    CREATE TABLE IF NOT EXISTS pmo_spec_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      field_type TEXT NOT NULL,
      required TEXT DEFAULT 'optional',
      default_value TEXT,
      description TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(spec_id, name)
    );

    -- Spec rules table
    CREATE TABLE IF NOT EXISTS pmo_spec_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );

    -- Spec relations table
    CREATE TABLE IF NOT EXISTS pmo_spec_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      related_domain TEXT NOT NULL,
      relationship TEXT,
      UNIQUE(spec_id, related_domain)
    );

    -- Epics table (must be before tickets due to FK)
    CREATE TABLE IF NOT EXISTS pmo_epics (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      file_path TEXT,
      spec_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL
    );

    -- Tickets table
    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      owner TEXT,
      assignee TEXT,
      spec_id TEXT,
      epic_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL,
      FOREIGN KEY (epic_id) REFERENCES pmo_epics(id) ON DELETE SET NULL
    );

    -- Board tickets table
    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (project_id, ticket_id),
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, column_id) REFERENCES pmo_columns(project_id, id) ON DELETE CASCADE
    );

    -- Subtasks table
    CREATE TABLE IF NOT EXISTS pmo_subtasks (
      id TEXT NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      position INTEGER NOT NULL,
      PRIMARY KEY (ticket_id, id)
    );

    -- Ticket metadata table
    CREATE TABLE IF NOT EXISTS pmo_ticket_metadata (
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (ticket_id, key)
    );

    -- Ticket dependencies table
    CREATE TABLE IF NOT EXISTS pmo_ticket_dependencies (
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      blocked_by_ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticket_id, blocked_by_ticket_id),
      CHECK (ticket_id != blocked_by_ticket_id)
    );

    -- Ticket affected paths table
    CREATE TABLE IF NOT EXISTS pmo_ticket_affected_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      path_pattern TEXT NOT NULL,
      path_type TEXT NOT NULL DEFAULT 'file',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Ticket acceptance criteria table
    CREATE TABLE IF NOT EXISTS pmo_ticket_acceptance_criteria (
      id TEXT NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      criterion TEXT NOT NULL,
      verifiable INTEGER DEFAULT 1,
      verified INTEGER DEFAULT 0,
      verified_at TIMESTAMP,
      verified_by TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ticket_id, id)
    );

    -- Ticket specs table
    CREATE TABLE IF NOT EXISTS pmo_ticket_specs (
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      PRIMARY KEY (ticket_id, spec_id)
    );

    -- Ticket assignments table
    CREATE TABLE IF NOT EXISTS pmo_ticket_assignments (
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL,
      assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticket_id, agent_name)
    );

    -- Cache metadata table
    CREATE TABLE IF NOT EXISTS pmo_cache_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Agent work table
    CREATE TABLE IF NOT EXISTS agent_work (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      executor TEXT NOT NULL,
      mode TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'host',
      display_mode TEXT NOT NULL DEFAULT 'terminal',
      sandboxed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'starting',
      branch TEXT,
      pid TEXT,
      container_id TEXT,
      session_id TEXT,
      host TEXT,
      log_path TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      exit_code INTEGER,
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON pmo_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_epic ON pmo_tickets(epic_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_epics_project ON pmo_epics(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_spec_abilities_spec ON pmo_spec_abilities(spec_id);
  `);

  // Create default project
  db.prepare(`
    INSERT INTO pmo_projects (id, name)
    VALUES ('default', 'Default Project')
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

  // Create HQ config file (required for findPMO to work)
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

  // Create specs directory
  const specsPath = path.join(process.cwd(), 'pmo/specs');
  fs.mkdirSync(specsPath, { recursive: true });
}

function createTestProject(db: Database.Database, id: string, name: string, description?: string) {
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description)
    VALUES (?, ?, ?)
  `).run(id, name, description || null);
}

function createTestColumns(db: Database.Database, projectId: string) {
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in_progress', name: 'In Progress', position: 1 },
    { id: 'done', name: 'Done', position: 2 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, ?, ?, ?)
    `).run(col.id, projectId, col.name, col.position);
  }
}

function createTestTicket(db: Database.Database, id: string, title: string, projectId: string, columnId: string = 'backlog') {
  db.prepare(`
    INSERT INTO pmo_tickets (id, project_id, title, status)
    VALUES (?, ?, ?, ?)
  `).run(id, projectId, title, columnId);

  db.prepare(`
    INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
    VALUES (?, ?, ?, 0)
  `).run(projectId, id, columnId);
}

function exec(cmd: string): string {
  try {
    const binPath = path.join(__dirname, '../../bin/run.js');
    // Run the CLI from the test's cwd
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
    // Command failed - capture both stdout and stderr
    const stdout = error.stdout || '';
    const stderr = error.stderr || '';
    // Return stdout if available (for expected error messages)
    // Otherwise return filtered stderr (removing Node.js warnings)
    if (stdout.trim()) {
      return stdout;
    }
    // Filter out Node.js warnings from stderr
    const filteredStderr = stderr.split('\n').filter((line: string) =>
      !line.includes('[ERR_UNKNOWN_FILE_EXTENSION]') &&
      !line.includes('Warning:') &&
      !line.includes('module: @oclif')
    ).join('\n');
    return filteredStderr || error.message;
  }
}
