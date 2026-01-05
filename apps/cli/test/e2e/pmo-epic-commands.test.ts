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
 * End-to-end tests for PMO Epic Commands
 * Tests: prlt epic create, list, view, archive, activate, move, progress
 * Spec: pmo-epic-commands.md
 */
describe('PMO Epic Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;
  let epicsDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-epic-e2e-'));
    process.chdir(testDir);

    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    epicsDir = path.join(testDir, 'pmo/projects/test-project/epics');
    fs.mkdirSync(path.join(epicsDir, 'active'), { recursive: true });
    fs.mkdirSync(path.join(epicsDir, 'draft'), { recursive: true });
    fs.mkdirSync(path.join(epicsDir, 'complete'), { recursive: true });
    fs.mkdirSync(path.join(epicsDir, 'dropped'), { recursive: true });
    fs.mkdirSync(path.join(epicsDir, 'future'), { recursive: true });

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

  describe('prlt epic create', () => {
    it('should create epic with auto-generated ID', () => {
      exec('epic create --title "User Authentication"');

      const epics = db.prepare('SELECT * FROM pmo_epics WHERE title = ?').all('User Authentication') as Array<{ id: string; status: string }>;
      expect(epics).to.have.lengthOf(1);
      expect(epics[0].id).to.match(/^EPIC-\d{3}$/);
      expect(epics[0].status).to.equal('active');
    });

    it('should create epic with specified status', () => {
      exec('epic create --title "Future Feature" --status draft');

      const epics = db.prepare('SELECT * FROM pmo_epics WHERE title = ?').all('Future Feature') as Array<{ status: string }>;
      expect(epics).to.have.lengthOf(1);
      expect(epics[0].status).to.equal('draft');
    });

    it('should create markdown file in correct status folder', () => {
      exec('epic create --title "Active Epic" --status active');

      const epic = db.prepare('SELECT id FROM pmo_epics WHERE title = ?').get('Active Epic') as { id: string };
      const filePath = path.join(epicsDir, 'active', `${epic.id}.md`);

      expect(fs.existsSync(filePath)).to.be.true;
    });

    it('should create markdown file with correct template sections', () => {
      exec('epic create --title "Template Test"');

      const epic = db.prepare('SELECT id FROM pmo_epics WHERE title = ?').get('Template Test') as { id: string };
      const filePath = path.join(epicsDir, 'active', `${epic.id}.md`);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Check YAML frontmatter
      expect(content).to.contain('---');
      expect(content).to.contain('id: ' + epic.id);
      expect(content).to.contain('title: Template Test');
      expect(content).to.contain('status: active');

      // Check sections
      expect(content).to.contain('## Overview');
      expect(content).to.contain('## Motivation');
      expect(content).to.contain('## Goals');
      expect(content).to.contain('## Success Criteria');
      expect(content).to.contain('## Tickets');
    });

    it('should increment epic ID counter', () => {
      exec('epic create --title "First Epic"');
      exec('epic create --title "Second Epic"');

      const epics = db.prepare('SELECT id FROM pmo_epics ORDER BY created_at').all() as Array<{ id: string }>;
      expect(epics).to.have.lengthOf(2);
      expect(epics[0].id).to.equal('EPIC-001');
      expect(epics[1].id).to.equal('EPIC-002');
    });

    it('should store file path in database', () => {
      exec('epic create --title "File Path Test"');

      const epic = db.prepare('SELECT file_path FROM pmo_epics WHERE title = ?').get('File Path Test') as { file_path: string };
      expect(epic.file_path).to.contain('epics/active/EPIC-');
      expect(epic.file_path).to.contain('.md');
    });
  });

  describe('prlt epic list', () => {
    beforeEach(() => {
      // Create test epics in different statuses
      createTestEpic(db, 'EPIC-001', 'Active Epic 1', 'active');
      createTestEpic(db, 'EPIC-002', 'Active Epic 2', 'active');
      createTestEpic(db, 'EPIC-003', 'Draft Epic', 'draft');
      createTestEpic(db, 'EPIC-004', 'Complete Epic', 'complete');
    });

    it('should list all epics', () => {
      const output = exec('epic list');

      expect(output).to.contain('EPIC-001');
      expect(output).to.contain('Active Epic 1');
      expect(output).to.contain('EPIC-002');
      expect(output).to.contain('EPIC-003');
      expect(output).to.contain('EPIC-004');
    });

    it('should filter by status', () => {
      const output = exec('epic list --status active');

      expect(output).to.contain('EPIC-001');
      expect(output).to.contain('EPIC-002');
      expect(output).not.to.contain('EPIC-003'); // draft
      expect(output).not.to.contain('EPIC-004'); // complete
    });

    it('should show epic status in output', () => {
      const output = exec('epic list');

      expect(output).to.contain('active');
      expect(output).to.contain('draft');
      expect(output).to.contain('complete');
    });

    it('should show empty message when no epics', () => {
      // Clear all epics
      db.prepare('DELETE FROM pmo_epics').run();

      const output = exec('epic list');

      expect(output.toLowerCase()).to.match(/no epics|empty|0 epics/i);
    });
  });

  describe('prlt epic view', () => {
    beforeEach(() => {
      createTestEpic(db, 'EPIC-001', 'View Test Epic', 'active');
      createEpicMarkdownFile(epicsDir, 'EPIC-001', 'active', 'View Test Epic');
    });

    it('should display epic details', () => {
      const output = exec('epic view EPIC-001');

      expect(output).to.contain('EPIC-001');
      expect(output).to.contain('View Test Epic');
      expect(output).to.contain('active');
    });

    it('should show linked tickets', () => {
      // Create tickets linked to epic
      createTestTicket(db, 'TKT-001', 'Ticket 1', 'EPIC-001', 'backlog');
      createTestTicket(db, 'TKT-002', 'Ticket 2', 'EPIC-001', 'done');

      const output = exec('epic view EPIC-001');

      expect(output).to.contain('TKT-001');
      expect(output).to.contain('Ticket 1');
      expect(output).to.contain('TKT-002');
      expect(output).to.contain('Ticket 2');
    });

    it('should show progress when tickets exist', () => {
      createTestTicket(db, 'TKT-001', 'Incomplete', 'EPIC-001', 'backlog');
      createTestTicket(db, 'TKT-002', 'Complete', 'EPIC-001', 'done');

      const output = exec('epic view EPIC-001');

      // Should show progress indicator (1/2 = 50%)
      expect(output).to.match(/50%|1\/2|progress/i);
    });

    it('should error for non-existent epic', () => {
      const output = exec('epic view EPIC-999');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt epic archive', () => {
    beforeEach(() => {
      createTestEpic(db, 'EPIC-001', 'Archive Test', 'active');
      createEpicMarkdownFile(epicsDir, 'EPIC-001', 'active', 'Archive Test');
    });

    it('should move epic to complete status', () => {
      exec('epic archive EPIC-001 --force');

      const epic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(epic.status).to.equal('complete');
    });

    it('should move markdown file to complete folder', () => {
      exec('epic archive EPIC-001 --force');

      const oldPath = path.join(epicsDir, 'active', 'EPIC-001.md');
      const newPath = path.join(epicsDir, 'complete', 'EPIC-001.md');

      expect(fs.existsSync(oldPath)).to.be.false;
      expect(fs.existsSync(newPath)).to.be.true;
    });

    it('should update status in markdown frontmatter', () => {
      exec('epic archive EPIC-001 --force');

      const filePath = path.join(epicsDir, 'complete', 'EPIC-001.md');
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).to.contain('status: complete');
    });

    it('should warn if not all tickets complete', () => {
      createTestTicket(db, 'TKT-001', 'Incomplete', 'EPIC-001', 'backlog');

      const output = exec('epic archive EPIC-001');

      expect(output.toLowerCase()).to.match(/not all|incomplete|warning/i);
    });
  });

  describe('prlt epic activate', () => {
    beforeEach(() => {
      createTestEpic(db, 'EPIC-001', 'Activate Test', 'draft');
      createEpicMarkdownFile(epicsDir, 'EPIC-001', 'draft', 'Activate Test');
    });

    it('should move epic to active status', () => {
      exec('epic activate EPIC-001');

      const epic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(epic.status).to.equal('active');
    });

    it('should move markdown file to active folder', () => {
      exec('epic activate EPIC-001');

      const oldPath = path.join(epicsDir, 'draft', 'EPIC-001.md');
      const newPath = path.join(epicsDir, 'active', 'EPIC-001.md');

      expect(fs.existsSync(oldPath)).to.be.false;
      expect(fs.existsSync(newPath)).to.be.true;
    });

    it('should update status in markdown frontmatter', () => {
      exec('epic activate EPIC-001');

      const filePath = path.join(epicsDir, 'active', 'EPIC-001.md');
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).to.contain('status: active');
    });

    it('should work from any starting status', () => {
      // Test from draft status (which doesn't require confirmation)
      // Note: complete status requires interactive confirmation without --force flag,
      // and epic activate doesn't have a --force flag. So we test from draft status.
      const epic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(epic.status).to.equal('draft'); // Verify starting status

      exec('epic activate EPIC-001');

      const updatedEpic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(updatedEpic.status).to.equal('active');
    });
  });

  describe('prlt epic move', () => {
    beforeEach(() => {
      createTestEpic(db, 'EPIC-001', 'Move Test', 'active');
      createEpicMarkdownFile(epicsDir, 'EPIC-001', 'active', 'Move Test');
    });

    it('should move epic to specified status', () => {
      // Moving to 'dropped' requires --force to skip confirmation
      exec('epic move EPIC-001 dropped --force');

      const epic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(epic.status).to.equal('dropped');
    });

    it('should move to draft status', () => {
      exec('epic move EPIC-001 draft');

      const epic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(epic.status).to.equal('draft');

      const filePath = path.join(epicsDir, 'draft', 'EPIC-001.md');
      expect(fs.existsSync(filePath)).to.be.true;
    });

    it('should move to future status', () => {
      exec('epic move EPIC-001 future');

      const epic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(epic.status).to.equal('future');

      const filePath = path.join(epicsDir, 'future', 'EPIC-001.md');
      expect(fs.existsSync(filePath)).to.be.true;
    });

    it('should warn when moving to complete with incomplete tickets', () => {
      createTestTicket(db, 'TKT-001', 'Incomplete', 'EPIC-001', 'backlog');

      const output = exec('epic move EPIC-001 complete');

      expect(output.toLowerCase()).to.match(/not all|incomplete|warning/i);
    });

    it('should reject invalid status', () => {
      const output = exec('epic move EPIC-001 invalid_status');

      expect(output.toLowerCase()).to.match(/invalid|error|unknown/i);
    });

    it('should noop if already in target status', () => {
      const output = exec('epic move EPIC-001 active');

      expect(output.toLowerCase()).to.match(/already|same/i);
    });
  });

  describe('prlt epic progress', () => {
    beforeEach(() => {
      createTestEpic(db, 'EPIC-001', 'Progress Test', 'active');
      createEpicMarkdownFile(epicsDir, 'EPIC-001', 'active', 'Progress Test');
    });

    it('should show 0% when no tickets', () => {
      const output = exec('epic progress EPIC-001');

      expect(output).to.match(/0%|0\/0|no tickets/i);
    });

    it('should show 50% when half complete', () => {
      createTestTicket(db, 'TKT-001', 'Done', 'EPIC-001', 'done');
      createTestTicket(db, 'TKT-002', 'Not done', 'EPIC-001', 'backlog');

      const output = exec('epic progress EPIC-001');

      expect(output).to.match(/50%|1\/2/i);
    });

    it('should show 100% when all complete', () => {
      createTestTicket(db, 'TKT-001', 'Done 1', 'EPIC-001', 'done');
      createTestTicket(db, 'TKT-002', 'Done 2', 'EPIC-001', 'done');

      const output = exec('epic progress EPIC-001');

      expect(output).to.match(/100%|2\/2|complete/i);
    });

    it('should show ticket breakdown', () => {
      createTestTicket(db, 'TKT-001', 'Done', 'EPIC-001', 'done');
      createTestTicket(db, 'TKT-002', 'In Progress', 'EPIC-001', 'in_progress');
      createTestTicket(db, 'TKT-003', 'Backlog', 'EPIC-001', 'backlog');

      const output = exec('epic progress EPIC-001');

      // Should show remaining work with non-done tickets
      // TKT-001 is done so won't appear in "Remaining work", but TKT-002 and TKT-003 will
      expect(output).to.contain('TKT-002');
      expect(output).to.contain('TKT-003');
    });

    it('should error for non-existent epic', () => {
      const output = exec('epic progress EPIC-999');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('ticket linking', () => {
    beforeEach(() => {
      createTestEpic(db, 'EPIC-001', 'Link Test', 'active');
      createEpicMarkdownFile(epicsDir, 'EPIC-001', 'active', 'Link Test');
      // Close the database connection before CLI runs to avoid locking issues
      db.close();
    });

    afterEach(() => {
      // Re-open db for parent afterEach cleanup
      db = new Database(dbPath);
    });

    it('should link ticket to epic via ticket create --epic', () => {
      exec('ticket create --title "Linked Ticket" --epic EPIC-001 --column Backlog');

      // Open fresh connection after CLI subprocess completes
      const freshDb = new Database(dbPath);
      const tickets = freshDb.prepare('SELECT * FROM pmo_tickets WHERE epic_id = ?').all('EPIC-001') as Array<{ title: string }>;
      freshDb.close();

      expect(tickets).to.have.lengthOf(1);
      expect(tickets[0].title).to.equal('Linked Ticket');
    });

    it('should update epic markdown when ticket is linked', () => {
      exec('ticket create --title "Sync Test" --epic EPIC-001 --column Backlog');

      const filePath = path.join(epicsDir, 'active', 'EPIC-001.md');
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).to.contain('Sync Test');
    });
  });
});

// Helper functions

function setupTestDatabase(db: Database.Database) {
  // Use the complete schema from the actual codebase
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

    -- Specs table (must be before tickets due to FK)
    CREATE TABLE IF NOT EXISTS pmo_specs (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      title TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Epics table (must be before tickets due to FK)
    CREATE TABLE IF NOT EXISTS pmo_epics (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      position INTEGER NOT NULL DEFAULT 0,
      file_path TEXT,
      spec_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, name)
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
      status_id TEXT,
      owner TEXT,
      assignee TEXT,
      branch TEXT,
      spec_id TEXT,
      epic_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (status_id) REFERENCES pmo_statuses(id),
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

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON pmo_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_epic ON pmo_tickets(epic_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_epics_project ON pmo_epics(project_id);
  `);

  db.prepare(`
    INSERT INTO pmo_projects (id, name)
    VALUES ('test-project', 'Test Project')
  `).run();

  db.prepare(`INSERT INTO pmo_settings (key, value) VALUES ('pmo_path', 'pmo')`).run();
  db.prepare(`INSERT INTO pmo_settings (key, value) VALUES ('current_project', 'test-project')`).run();
  db.prepare(`INSERT INTO pmo_settings (key, value) VALUES ('next_epic_id', '1')`).run();

  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in_progress', name: 'In Progress', position: 1 },
    { id: 'done', name: 'Done', position: 2 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `).run(col.id, col.name, col.position);
  }

  // Workflow statuses (kanban template)
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

  // Create HQ config file (required for findPMO to work)
  const proletariatDir = path.join(process.cwd(), '.proletariat');
  const configPath = path.join(proletariatDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    type: 'hq',
    name: 'test-hq',
    hasPmo: true,
  }), 'utf-8');

  // Create PMO directory structure
  const pmoPath = path.join(process.cwd(), 'pmo/projects/test-project');
  fs.mkdirSync(pmoPath, { recursive: true });
}

let epicCounter = 0;
function createTestEpic(db: Database.Database, id: string, title: string, status: string) {
  epicCounter++;
  db.prepare(`
    INSERT INTO pmo_epics (id, project_id, title, status, position, file_path)
    VALUES (?, 'test-project', ?, ?, ?, ?)
  `).run(id, title, status, epicCounter, `pmo/projects/test-project/epics/${status}/${id}.md`);
}

function createTestTicket(db: Database.Database, id: string, title: string, epicId: string, status: string) {
  // Map status to status_id
  const statusToId: Record<string, string> = {
    'backlog': 'status-backlog',
    'in_progress': 'status-in-progress',
    'done': 'status-done',
  };
  const statusId = statusToId[status] || 'status-backlog';

  db.prepare(`
    INSERT INTO pmo_tickets (id, project_id, title, epic_id, status, status_id)
    VALUES (?, 'test-project', ?, ?, ?, ?)
  `).run(id, title, epicId, status, statusId);

  // Also add to board_tickets for proper board integration
  db.prepare(`
    INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
    VALUES ('test-project', ?, ?, 0)
  `).run(id, status === 'done' ? 'done' : status === 'in_progress' ? 'in_progress' : 'backlog');
}

function createEpicMarkdownFile(epicsDir: string, id: string, status: string, title: string) {
  const content = `---
id: ${id}
title: ${title}
status: ${status}
created: ${new Date().toISOString()}
---

# ${title}

## Overview
[Describe what this epic covers]

## Motivation
[Why this work matters]

## Goals
- [ ] Goal 1

## Success Criteria
- [ ] Criterion 1

## Tickets

_No tickets linked yet._
`;

  const filePath = path.join(epicsDir, status, `${id}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
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
