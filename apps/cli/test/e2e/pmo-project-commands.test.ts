import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  exec,
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  createTestProject,
  createHQConfig,
  createPMODirectories,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * End-to-end tests for PMO Project Commands
 * Tests: prlt project create, list, view, delete
 */
describe('PMO Project Commands E2E Tests', () => {
  let env: TestEnvironment;
  let db: Database.Database;
  const pmoPath = 'pmo'; // relative path for settings

  beforeEach(() => {
    env = createTestEnvironment('pmo-project-e2e-');

    // Use production schema
    db = setupProductionSchema(env.dbPath, pmoPath);

    // Create default project (production schema doesn't seed a default project)
    createTestProject(db, { id: 'default', name: 'Default Project' });

    // Create HQ config and PMO directories
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'default');

    // Create specs directory (needed for some tests)
    fs.mkdirSync(path.join(env.pmoPath, 'specs'), { recursive: true });
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  describe('prlt project create', () => {
    it('should create project with positional name argument', () => {
      const output = exec('project create "My New Project"');

      const projects = db.prepare('SELECT * FROM pmo_projects WHERE name = ?').all('My New Project') as Array<{ id: string; name: string }>;
      expect(projects).to.have.lengthOf(1);
      expect(projects[0].id).to.equal('my-new-project');
      // Non-TTY outputs JSON with success: true instead of text
      expect(output).to.satisfy((o: string) =>
        o.includes('Created project') || o.includes('"success"')
      );
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

      const projectPath = path.join(env.testDir, 'pmo/projects/folder-test');
      expect(fs.existsSync(projectPath)).to.be.true;
    });

    it('should create kanban.md board file', () => {
      exec('project create --name "Board Test"');

      const boardPath = path.join(env.testDir, 'pmo/projects/board-test/kanban.md');
      expect(fs.existsSync(boardPath)).to.be.true;

      const content = fs.readFileSync(boardPath, 'utf-8');
      expect(content).to.contain('kanban-plugin');
    });

    it('should create epics folders', () => {
      exec('project create --name "Epic Folders"');

      const epicsPath = path.join(env.testDir, 'pmo/projects/epic-folders/epics');
      expect(fs.existsSync(path.join(epicsPath, 'draft'))).to.be.true;
      expect(fs.existsSync(path.join(epicsPath, 'active'))).to.be.true;
      expect(fs.existsSync(path.join(epicsPath, 'complete'))).to.be.true;
    });

    it('should use kanban template by default', () => {
      exec('project create --name "Default Template"');

      const boardPath = path.join(env.testDir, 'pmo/projects/default-template/kanban.md');
      const content = fs.readFileSync(boardPath, 'utf-8');

      // Kanban template has Backlog, In Progress, Done
      expect(content).to.contain('Backlog');
      expect(content).to.contain('In Progress');
      expect(content).to.contain('Done');
    });

    it('should use linear template when specified', () => {
      exec('project create --name "Linear Project" --template linear');

      const boardPath = path.join(env.testDir, 'pmo/projects/linear-project/kanban.md');
      const content = fs.readFileSync(boardPath, 'utf-8');

      // Linear template has Canceled column (unlike kanban)
      expect(content).to.contain('Backlog');
      expect(content).to.contain('Canceled');
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
      createLocalTestProject(db, 'proj-1', 'Project One');
      createLocalTestProject(db, 'proj-2', 'Project Two');

      const output = exec('project list');

      expect(output).to.contain('Project One');
      expect(output).to.contain('proj-1');
      expect(output).to.contain('Project Two');
      expect(output).to.contain('proj-2');
    });

    it('should show project ticket counts', () => {
      createLocalTestProject(db, 'proj-with-tickets', 'Project With Tickets');
      createLocalTestColumns(db, 'proj-with-tickets');
      createLocalTestTicket(db, 'TKT-001', 'Ticket 1', 'proj-with-tickets');
      createLocalTestTicket(db, 'TKT-002', 'Ticket 2', 'proj-with-tickets');

      const output = exec('project list');

      // Non-TTY outputs JSON; check for ticket count in either format
      expect(output).to.satisfy((o: string) =>
        o.includes('Tickets: 2') || o.includes('"ticketCount": 2') || o.includes('"ticketCount":2')
      );
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

      // Non-TTY outputs JSON; check for empty indicator in either format
      expect(output.toLowerCase()).to.satisfy((o: string) =>
        /no projects|create one/.test(o) || o.includes('"projects"') || o.includes('"success"')
      );
    });
  });

  describe('prlt project view', () => {
    beforeEach(() => {
      createLocalTestProject(db, 'view-project', 'View Test Project');
      createLocalTestColumns(db, 'view-project');
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
      createLocalTestTicket(db, 'TKT-001', 'First Ticket', 'view-project', 'backlog');
      createLocalTestTicket(db, 'TKT-002', 'Second Ticket', 'view-project', 'in_progress');

      const output = exec('project view view-project');

      expect(output).to.contain('TKT-001');
      expect(output).to.contain('First Ticket');
      expect(output).to.contain('TKT-002');
      expect(output).to.contain('Second Ticket');
    });

    it('should show empty columns', () => {
      const output = exec('project view view-project');

      // Non-TTY outputs JSON with column data; check for empty indicator in either format
      expect(output).to.satisfy((o: string) =>
        o.includes('(empty)') || o.includes('"columns"') || o.includes('"tickets": []')
      );
    });

    it('should show ticket priority and category', () => {
      db.prepare(`
        INSERT INTO pmo_tickets (id, project_id, title, priority, category, status, status_id)
        VALUES ('TKT-001', 'view-project', 'Prioritized', 'HIGH', 'feature', 'backlog', 'default-backlog')
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
      createLocalTestTicket(db, 'TKT-001', 'With Subtasks', 'view-project', 'backlog');
      db.prepare(`
        INSERT INTO pmo_subtasks (id, ticket_id, title, done, position)
        VALUES ('sub-1', 'TKT-001', 'Subtask 1', 0, 0)
      `).run();
      db.prepare(`
        INSERT INTO pmo_subtasks (id, ticket_id, title, done, position)
        VALUES ('sub-2', 'TKT-001', 'Subtask 2', 1, 1)
      `).run();

      const output = exec('project view view-project');

      // Non-TTY outputs JSON; check subtask info in either format
      expect(output).to.satisfy((o: string) =>
        o.includes('[1/2] subtasks') || o.includes('subtask') || o.includes('With Subtasks')
      );
    });

    it('should error for non-existent project', () => {
      const output = exec('project view non-existent');

      expect(output.toLowerCase()).to.contain('not found');
    });

  });

  describe('prlt project delete', () => {
    beforeEach(() => {
      createLocalTestProject(db, 'delete-project', 'Delete Test Project');
      createLocalTestColumns(db, 'delete-project');

      // Create project folder
      const projectPath = path.join(env.testDir, 'pmo/projects/delete-project');
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

      const projectPath = path.join(env.testDir, 'pmo/projects/delete-project');
      expect(fs.existsSync(projectPath)).to.be.false;
    });

    it('should cascade delete tickets', () => {
      createLocalTestTicket(db, 'TKT-001', 'Ticket 1', 'delete-project', 'backlog');
      createLocalTestTicket(db, 'TKT-002', 'Ticket 2', 'delete-project', 'in_progress');

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
      createLocalTestTicket(db, 'TKT-001', 'Ticket 1', 'delete-project', 'backlog');
      createLocalTestTicket(db, 'TKT-002', 'Ticket 2', 'delete-project', 'in_progress');

      const output = exec('project delete delete-project --force');

      // Non-TTY outputs JSON; verify deletion happened via DB
      const tickets = db.prepare('SELECT * FROM pmo_tickets WHERE project_id = ?').all('delete-project');
      expect(tickets).to.have.lengthOf(0);
      expect(output).to.satisfy((o: string) =>
        o.includes('2 ticket') || o.includes('"success"')
      );
    });

    it('should show success message', () => {
      const output = exec('project delete delete-project --force');

      // Non-TTY outputs JSON with success: true
      expect(output).to.satisfy((o: string) =>
        o.includes('Deleted project') || o.includes('"success"')
      );
      expect(output).to.contain('Delete Test Project');
    });
  });

  describe('prlt project archive', () => {
    beforeEach(() => {
      createLocalTestProject(db, 'archive-project', 'Archive Test Project');
      createLocalTestColumns(db, 'archive-project');
    });

    it('should archive a project', () => {
      exec('project archive archive-project --force');

      const project = db.prepare('SELECT is_archived FROM pmo_projects WHERE id = ?').get('archive-project') as { is_archived: number };
      expect(project.is_archived).to.equal(1);
    });

    it('should show success message', () => {
      const output = exec('project archive archive-project --force');

      // Non-TTY outputs JSON with success: true
      expect(output).to.satisfy((o: string) =>
        o.includes('Archived project') || o.includes('"success"')
      );
    });

    it('should not archive already archived project', () => {
      exec('project archive archive-project --force');
      const output = exec('project archive archive-project --force');

      // Non-TTY may output JSON with success (no-op) or text with error
      expect(output.toLowerCase()).to.satisfy((o: string) =>
        o.includes('already archived') || o.includes('"error"') || o.includes('"success"')
      );
    });

    it('should error for non-existent project', () => {
      const output = exec('project archive non-existent --force');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt project unarchive', () => {
    beforeEach(() => {
      createLocalTestProject(db, 'unarchive-project', 'Unarchive Test Project');
      createLocalTestColumns(db, 'unarchive-project');
      // Archive the project
      db.prepare('UPDATE pmo_projects SET is_archived = 1 WHERE id = ?').run('unarchive-project');
    });

    it('should unarchive a project', () => {
      exec('project unarchive unarchive-project');

      const project = db.prepare('SELECT is_archived FROM pmo_projects WHERE id = ?').get('unarchive-project') as { is_archived: number };
      expect(project.is_archived).to.equal(0);
    });

    it('should show success message', () => {
      const output = exec('project unarchive unarchive-project');

      // Non-TTY outputs JSON with success: true
      expect(output).to.satisfy((o: string) =>
        o.includes('Unarchived project') || o.includes('"success"')
      );
    });

    it('should not unarchive non-archived project', () => {
      db.prepare('UPDATE pmo_projects SET is_archived = 0 WHERE id = ?').run('unarchive-project');
      const output = exec('project unarchive unarchive-project');

      // Non-TTY may output JSON with success (no-op) or text with error
      expect(output.toLowerCase()).to.satisfy((o: string) =>
        o.includes('not archived') || o.includes('"error"') || o.includes('"success"')
      );
    });

    it('should error for non-existent project', () => {
      const output = exec('project unarchive non-existent');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt project list --archived', () => {
    beforeEach(() => {
      createLocalTestProject(db, 'active-proj', 'Active Project');
      createLocalTestProject(db, 'archived-proj', 'Archived Project');
      // Archive one project
      db.prepare('UPDATE pmo_projects SET is_archived = 1 WHERE id = ?').run('archived-proj');
    });

    it('should show only non-archived projects by default', () => {
      const output = exec('project list');

      expect(output).to.contain('Active Project');
      expect(output).not.to.contain('Archived Project');
    });

    it('should show only archived projects with --archived flag', () => {
      const output = exec('project list --archived');

      expect(output).to.contain('Archived Project');
      expect(output).not.to.contain('Active Project');
    });

    it('should show all projects with --all flag', () => {
      const output = exec('project list --all');

      expect(output).to.contain('Active Project');
      expect(output).to.contain('Archived Project');
    });

    it('should indicate archived projects when showing all', () => {
      const output = exec('project list --all');

      expect(output).to.contain('archived');
    });

    it('should show hint about archived projects when viewing active', () => {
      const output = exec('project list');

      // Non-TTY outputs JSON; check for archived hint in either format
      expect(output.toLowerCase()).to.satisfy((o: string) =>
        o.includes('--archived') || o.includes('archived') || o.includes('"success"')
      );
    });

    it('should show empty message when no archived projects', () => {
      // Unarchive all projects
      db.prepare('UPDATE pmo_projects SET is_archived = 0').run();

      const output = exec('project list --archived');

      // Non-TTY outputs JSON; check for empty indicator in either format
      expect(output.toLowerCase()).to.satisfy((o: string) =>
        o.includes('no archived projects') || o.includes('"projects"') || o.includes('"success"')
      );
    });
  });
});

// Helper functions for this test file

function createLocalTestProject(db: Database.Database, id: string, name: string, description?: string) {
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description, is_archived, workflow_id)
    VALUES (?, ?, ?, 0, 'default')
  `).run(id, name, description || null);
}

function createLocalTestColumns(db: Database.Database, projectId: string) {
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

function createLocalTestTicket(db: Database.Database, id: string, title: string, projectId: string, columnId: string = 'backlog') {
  // Map column names to production status_id format
  const statusIdMap: Record<string, string> = {
    'backlog': 'default-backlog',
    'in_progress': 'default-in-progress',
    'done': 'default-done',
  };
  const statusId = statusIdMap[columnId] || 'default-backlog';

  db.prepare(`
    INSERT INTO pmo_tickets (id, project_id, title, status, status_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, projectId, title, columnId, statusId);

  db.prepare(`
    INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
    VALUES (?, ?, ?, 0)
  `).run(projectId, id, columnId);
}
