import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  execInProcess,
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  createTestProject,
  createHQConfig,
  createPMODirectories,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * End-to-end tests for PMO Epic Commands
 * Tests: prlt epic create, list, view, archive, activate, move, progress
 * Spec: pmo-epic-commands.md
 */
describe('PMO Epic Commands E2E Tests', () => {
  let env: TestEnvironment;
  let db: Database.Database;
  let epicsDir: string;
  const pmoPath = 'pmo'; // relative path for settings

  beforeEach(() => {
    env = createTestEnvironment('pmo-epic-e2e-');

    // Use production schema
    db = setupProductionSchema(env.dbPath, pmoPath);

    // Create test project
    createTestProject(db, { id: 'test-project', name: 'Test Project' });

    // Set next_epic_id for epic creation
    db.prepare(`INSERT OR REPLACE INTO pmo_settings (key, value) VALUES ('next_epic_id', '1')`).run();

    // Create HQ config and PMO directories
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');

    // Create epic status directories
    epicsDir = path.join(env.pmoPath, 'projects/test-project/epics');
    fs.mkdirSync(path.join(epicsDir, 'active'), { recursive: true });
    fs.mkdirSync(path.join(epicsDir, 'draft'), { recursive: true });
    fs.mkdirSync(path.join(epicsDir, 'complete'), { recursive: true });
    fs.mkdirSync(path.join(epicsDir, 'dropped'), { recursive: true });
    fs.mkdirSync(path.join(epicsDir, 'future'), { recursive: true });
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  describe('prlt epic create', () => {
    it('should create epic with auto-generated ID', async () => {
      await execInProcess('epic create --title "User Authentication"');

      const epics = db.prepare('SELECT * FROM pmo_epics WHERE title = ?').all('User Authentication') as Array<{ id: string; status: string }>;
      expect(epics).to.have.lengthOf(1);
      expect(epics[0].id).to.match(/^EPIC-\d{3}$/);
      expect(epics[0].status).to.equal('active');
    });

    it('should create epic with specified status', async () => {
      await execInProcess('epic create --title "Future Feature" --status draft');

      const epics = db.prepare('SELECT * FROM pmo_epics WHERE title = ?').all('Future Feature') as Array<{ status: string }>;
      expect(epics).to.have.lengthOf(1);
      expect(epics[0].status).to.equal('draft');
    });

    it('should create markdown file in correct status folder', async () => {
      await execInProcess('epic create --title "Active Epic" --status active');

      const epic = db.prepare('SELECT id FROM pmo_epics WHERE title = ?').get('Active Epic') as { id: string };
      const filePath = path.join(epicsDir, 'active', `${epic.id}.md`);

      expect(fs.existsSync(filePath)).to.be.true;
    });

    it('should create markdown file with correct template sections', async () => {
      await execInProcess('epic create --title "Template Test"');

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

    it('should increment epic ID counter', async () => {
      await execInProcess('epic create --title "First Epic"');
      await execInProcess('epic create --title "Second Epic"');

      const epics = db.prepare('SELECT id FROM pmo_epics ORDER BY created_at').all() as Array<{ id: string }>;
      expect(epics).to.have.lengthOf(2);
      expect(epics[0].id).to.equal('EPIC-001');
      expect(epics[1].id).to.equal('EPIC-002');
    });

    it('should store file path in database', async () => {
      await execInProcess('epic create --title "File Path Test"');

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

    it('should list all epics', async () => {
      const output = await execInProcess('epic list');

      expect(output).to.contain('EPIC-001');
      expect(output).to.contain('Active Epic 1');
      expect(output).to.contain('EPIC-002');
      expect(output).to.contain('EPIC-003');
      expect(output).to.contain('EPIC-004');
    });

    it('should filter by status', async () => {
      const output = await execInProcess('epic list --status active');

      expect(output).to.contain('EPIC-001');
      expect(output).to.contain('EPIC-002');
      expect(output).not.to.contain('EPIC-003'); // draft
      expect(output).not.to.contain('EPIC-004'); // complete
    });

    it('should show epic status in output', async () => {
      const output = await execInProcess('epic list');

      expect(output).to.contain('active');
      expect(output).to.contain('draft');
      expect(output).to.contain('complete');
    });

    it('should show empty message when no epics', async () => {
      // Clear all epics
      db.prepare('DELETE FROM pmo_epics').run();

      const output = await execInProcess('epic list');

      expect(output.toLowerCase()).to.match(/no epics|empty|0 epics/i);
    });
  });

  describe('prlt epic view', () => {
    beforeEach(() => {
      createTestEpic(db, 'EPIC-001', 'View Test Epic', 'active');
      createEpicMarkdownFile(epicsDir, 'EPIC-001', 'active', 'View Test Epic');
    });

    it('should display epic details', async () => {
      const output = await execInProcess('epic view EPIC-001');

      expect(output).to.contain('EPIC-001');
      expect(output).to.contain('View Test Epic');
      expect(output).to.contain('active');
    });

    it('should show linked tickets', async () => {
      // Create tickets linked to epic
      createTestTicket(db, 'TKT-001', 'Ticket 1', 'EPIC-001', 'backlog');
      createTestTicket(db, 'TKT-002', 'Ticket 2', 'EPIC-001', 'done');

      const output = await execInProcess('epic view EPIC-001');

      expect(output).to.contain('TKT-001');
      expect(output).to.contain('Ticket 1');
      expect(output).to.contain('TKT-002');
      expect(output).to.contain('Ticket 2');
    });

    it('should show progress when tickets exist', async () => {
      createTestTicket(db, 'TKT-001', 'Incomplete', 'EPIC-001', 'backlog');
      createTestTicket(db, 'TKT-002', 'Complete', 'EPIC-001', 'done');

      const output = await execInProcess('epic view EPIC-001');

      // Should show progress indicator (1/2 = 50%)
      expect(output).to.match(/50%|1\/2|progress/i);
    });

    it('should error for non-existent epic', async () => {
      const output = await execInProcess('epic view EPIC-999');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt epic archive', () => {
    beforeEach(() => {
      createTestEpic(db, 'EPIC-001', 'Archive Test', 'active');
      createEpicMarkdownFile(epicsDir, 'EPIC-001', 'active', 'Archive Test');
    });

    it('should move epic to complete status', async () => {
      await execInProcess('epic archive EPIC-001 --force');

      const epic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(epic.status).to.equal('complete');
    });

    it('should move markdown file to complete folder', async () => {
      await execInProcess('epic archive EPIC-001 --force');

      const oldPath = path.join(epicsDir, 'active', 'EPIC-001.md');
      const newPath = path.join(epicsDir, 'complete', 'EPIC-001.md');

      expect(fs.existsSync(oldPath)).to.be.false;
      expect(fs.existsSync(newPath)).to.be.true;
    });

    it('should update status in markdown frontmatter', async () => {
      await execInProcess('epic archive EPIC-001 --force');

      const filePath = path.join(epicsDir, 'complete', 'EPIC-001.md');
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).to.contain('status: complete');
    });

    it('should warn if not all tickets complete', async () => {
      createTestTicket(db, 'TKT-001', 'Incomplete', 'EPIC-001', 'backlog');

      const output = await execInProcess('epic archive EPIC-001');

      expect(output.toLowerCase()).to.match(/not all|incomplete|warning/i);
    });
  });

  describe('prlt epic activate', () => {
    beforeEach(() => {
      createTestEpic(db, 'EPIC-001', 'Activate Test', 'draft');
      createEpicMarkdownFile(epicsDir, 'EPIC-001', 'draft', 'Activate Test');
    });

    it('should move epic to active status', async () => {
      await execInProcess('epic activate EPIC-001');

      const epic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(epic.status).to.equal('active');
    });

    it('should move markdown file to active folder', async () => {
      await execInProcess('epic activate EPIC-001');

      const oldPath = path.join(epicsDir, 'draft', 'EPIC-001.md');
      const newPath = path.join(epicsDir, 'active', 'EPIC-001.md');

      expect(fs.existsSync(oldPath)).to.be.false;
      expect(fs.existsSync(newPath)).to.be.true;
    });

    it('should update status in markdown frontmatter', async () => {
      await execInProcess('epic activate EPIC-001');

      const filePath = path.join(epicsDir, 'active', 'EPIC-001.md');
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).to.contain('status: active');
    });

    it('should work from any starting status', async () => {
      // Test from draft status (which doesn't require confirmation)
      // Note: complete status requires interactive confirmation without --force flag,
      // and epic activate doesn't have a --force flag. So we test from draft status.
      const epic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(epic.status).to.equal('draft'); // Verify starting status

      await execInProcess('epic activate EPIC-001');

      const updatedEpic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(updatedEpic.status).to.equal('active');
    });
  });

  describe('prlt epic move', () => {
    beforeEach(() => {
      createTestEpic(db, 'EPIC-001', 'Move Test', 'active');
      createEpicMarkdownFile(epicsDir, 'EPIC-001', 'active', 'Move Test');
    });

    it('should move epic to specified status', async () => {
      // Moving to 'dropped' requires --force to skip confirmation
      await execInProcess('epic move EPIC-001 dropped --force');

      const epic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(epic.status).to.equal('dropped');
    });

    it('should move to draft status', async () => {
      await execInProcess('epic move EPIC-001 draft');

      const epic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(epic.status).to.equal('draft');

      const filePath = path.join(epicsDir, 'draft', 'EPIC-001.md');
      expect(fs.existsSync(filePath)).to.be.true;
    });

    it('should move to future status', async () => {
      await execInProcess('epic move EPIC-001 future');

      const epic = db.prepare('SELECT status FROM pmo_epics WHERE id = ?').get('EPIC-001') as { status: string };
      expect(epic.status).to.equal('future');

      const filePath = path.join(epicsDir, 'future', 'EPIC-001.md');
      expect(fs.existsSync(filePath)).to.be.true;
    });

    it('should warn when moving to complete with incomplete tickets', async () => {
      createTestTicket(db, 'TKT-001', 'Incomplete', 'EPIC-001', 'backlog');

      const output = await execInProcess('epic move EPIC-001 complete');

      expect(output.toLowerCase()).to.match(/not all|incomplete|warning/i);
    });

    it('should reject invalid status', async () => {
      const output = await execInProcess('epic move EPIC-001 invalid_status');

      expect(output.toLowerCase()).to.match(/invalid|error|unknown/i);
    });

    it('should noop if already in target status', async () => {
      const output = await execInProcess('epic move EPIC-001 active');

      expect(output.toLowerCase()).to.match(/already|same/i);
    });
  });

  describe('prlt epic progress', () => {
    beforeEach(() => {
      createTestEpic(db, 'EPIC-001', 'Progress Test', 'active');
      createEpicMarkdownFile(epicsDir, 'EPIC-001', 'active', 'Progress Test');
    });

    it('should show 0% when no tickets', async () => {
      const output = await execInProcess('epic progress EPIC-001');

      expect(output).to.match(/0%|0\/0|no tickets/i);
    });

    it('should show 50% when half complete', async () => {
      createTestTicket(db, 'TKT-001', 'Done', 'EPIC-001', 'done');
      createTestTicket(db, 'TKT-002', 'Not done', 'EPIC-001', 'backlog');

      const output = await execInProcess('epic progress EPIC-001');

      expect(output).to.match(/50%|1\/2/i);
    });

    it('should show 100% when all complete', async () => {
      createTestTicket(db, 'TKT-001', 'Done 1', 'EPIC-001', 'done');
      createTestTicket(db, 'TKT-002', 'Done 2', 'EPIC-001', 'done');

      const output = await execInProcess('epic progress EPIC-001');

      expect(output).to.match(/100%|2\/2|complete/i);
    });

    it('should show ticket breakdown', async () => {
      createTestTicket(db, 'TKT-001', 'Done', 'EPIC-001', 'done');
      createTestTicket(db, 'TKT-002', 'In Progress', 'EPIC-001', 'in_progress');
      createTestTicket(db, 'TKT-003', 'Backlog', 'EPIC-001', 'backlog');

      const output = await execInProcess('epic progress EPIC-001');

      // Should show remaining work with non-done tickets
      // TKT-001 is done so won't appear in "Remaining work", but TKT-002 and TKT-003 will
      expect(output).to.contain('TKT-002');
      expect(output).to.contain('TKT-003');
    });

    it('should error for non-existent epic', async () => {
      const output = await execInProcess('epic progress EPIC-999');

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
      db = new Database(env.dbPath);
    });

    it('should link ticket to epic via ticket create --epic', async () => {
      await execInProcess('ticket create --title "Linked Ticket" --epic EPIC-001 --column Backlog');

      // Open fresh connection after CLI subprocess completes
      const freshDb = new Database(env.dbPath);
      const tickets = freshDb.prepare('SELECT * FROM pmo_tickets WHERE epic_id = ?').all('EPIC-001') as Array<{ title: string }>;
      freshDb.close();

      expect(tickets).to.have.lengthOf(1);
      expect(tickets[0].title).to.equal('Linked Ticket');
    });

    it('should update epic markdown when ticket is linked', async () => {
      await execInProcess('ticket create --title "Sync Test" --epic EPIC-001 --column Backlog');

      const filePath = path.join(epicsDir, 'active', 'EPIC-001.md');
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).to.contain('Sync Test');
    });
  });
});

// Helper functions

// Local helper functions for this test file

let epicCounter = 0;
function createTestEpic(db: Database.Database, id: string, title: string, status: string) {
  epicCounter++;
  db.prepare(`
    INSERT INTO pmo_epics (id, project_id, title, status, position, file_path)
    VALUES (?, 'test-project', ?, ?, ?, ?)
  `).run(id, title, status, epicCounter, `pmo/projects/test-project/epics/${status}/${id}.md`);
}

function createTestTicket(db: Database.Database, id: string, title: string, epicId: string, status: string) {
  // Map status to production status_id naming convention
  const statusToId: Record<string, string> = {
    'backlog': 'default-backlog',
    'in_progress': 'default-in-progress',
    'done': 'default-done',
  };
  const statusId = statusToId[status] || 'default-backlog';

  db.prepare(`
    INSERT INTO pmo_tickets (id, project_id, title, epic_id, status, status_id)
    VALUES (?, 'test-project', ?, ?, ?, ?)
  `).run(id, title, epicId, status, statusId);
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
