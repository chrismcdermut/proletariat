/**
 * E2E tests for project commands - agent flow with --machine flag
 *
 * Tests that AI agents can navigate through project commands using JSON output.
 */

import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  exec,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * Extract JSON from CLI output that may contain warnings.
 * Looks for the first line starting with { and parses from there.
 */
function extractJson<T>(output: string): T | null {
  const lines = output.split('\n');
  let jsonStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('{')) {
      jsonStart = i;
      break;
    }
  }

  if (jsonStart === -1) {
    return null;
  }

  const jsonLines = lines.slice(jsonStart).join('\n');
  try {
    return JSON.parse(jsonLines) as T;
  } catch {
    return null;
  }
}

describe('Project Commands - Agent Flow', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('project-agent-');
    db = new Database(env.dbPath);
    setupTestDatabase(db, env.pmoPath);
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    cleanupTestEnvironment(env);
  });

  describe('project list --json', () => {
    it('should return projects as JSON with --json flag', () => {
      const output = exec('project list --json');
      const result = extractJson<{ success: boolean; result: { projects: Array<{ id: string; name: string }> } }>(output);

      expect(result).to.exist;
      expect(result!.success).to.equal(true);
      expect(result!.result.projects).to.be.an('array');
      expect(result!.result.projects.length).to.be.greaterThan(0);

      // Verify test project is in the list
      const testProject = result!.result.projects.find(p => p.id === 'test-project');
      expect(testProject).to.exist;
      expect(testProject!.name).to.equal('Test Project');
    });
  });

  describe('project view --json', () => {
    it('should return board data when project ID is provided', () => {
      const output = exec('project view test-project --json');
      const result = extractJson<{ success: boolean; id: string; name: string; columns: unknown[] }>(output);

      expect(result).to.exist;
      expect(result!.success).to.equal(true);
      expect(result!.id).to.equal('test-project');
      expect(result!.name).to.equal('Test Project');
      expect(result!.columns).to.be.an('array');
    });

    it('should return prompt with command fields when no project ID provided', () => {
      // Create another project for selection
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('second-project', 'Second Project', 'Another project', 'default')
      `).run();

      const output = exec('project view --json');
      const result = extractJson<{ prompt: { type: string; choices: Array<{ command: string }> } }>(output);

      expect(result).to.exist;
      expect(result!.prompt).to.exist;
      expect(result!.prompt.type).to.equal('list');

      // Each choice should have a command field
      for (const choice of result!.prompt.choices) {
        expect(choice.command).to.exist;
        expect(choice.command).to.include('project view');
        expect(choice.command).to.include('--json');
      }
    });
  });

  describe('project create --json', () => {
    it('should return form prompt in interactive mode with --json', () => {
      const output = exec('project create --interactive --json');
      const result = extractJson<{ prompt: { fields: unknown[] } }>(output);

      expect(result).to.exist;
      expect(result!.prompt).to.exist;
      expect(result!.prompt.fields).to.be.an('array');
    });

    it('should create project and return success with --json', () => {
      const output = exec('project create --name "New Agent Project" --json');
      const result = extractJson<{ success: boolean; id: string; name: string }>(output);

      expect(result).to.exist;
      expect(result!.success).to.equal(true);
      expect(result!.name).to.equal('New Agent Project');

      // Verify in database
      const project = db.prepare('SELECT id, name FROM pmo_projects WHERE name = ?').get('New Agent Project') as { id: string; name: string } | undefined;
      expect(project).to.exist;
    });
  });

  describe('project delete --json', () => {
    beforeEach(() => {
      // Create a deletable project
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('delete-me', 'Delete Me Project', 'Project to delete', 'default')
      `).run();
    });

    it('should return prompt with command fields when selecting project', () => {
      const output = exec('project delete --json');
      const result = extractJson<{ prompt: { type: string; choices: Array<{ name: string; command: string }> } }>(output);

      expect(result).to.exist;
      expect(result!.prompt).to.exist;
      expect(result!.prompt.type).to.equal('list');

      // Find the delete-me choice
      const deleteChoice = result!.prompt.choices.find(c => c.name.includes('Delete Me'));
      expect(deleteChoice).to.exist;
      expect(deleteChoice!.command).to.include('project delete');
      expect(deleteChoice!.command).to.include('delete-me');
      expect(deleteChoice!.command).to.include('--json');
    });

    it('should return confirmation prompt with --force command', () => {
      const output = exec('project delete delete-me --json');
      const result = extractJson<{ prompt: { type: string; choices: Array<{ name: string; command: string }> } }>(output);

      expect(result).to.exist;
      expect(result!.prompt).to.exist;

      // Find Yes choice - should have --force in command
      const yesChoice = result!.prompt.choices.find(c => c.name.toLowerCase().includes('yes'));
      expect(yesChoice).to.exist;
      expect(yesChoice!.command).to.include('--force');
    });

    it('should delete project with --force flag', () => {
      const output = exec('project delete delete-me --force --json');
      const result = extractJson<{ success: boolean; deleted: boolean }>(output);

      expect(result).to.exist;
      expect(result!.success).to.equal(true);
      expect(result!.deleted).to.equal(true);

      // Verify project is gone
      const project = db.prepare('SELECT id FROM pmo_projects WHERE id = ?').get('delete-me');
      expect(project).to.be.undefined;
    });
  });

  describe('project archive --json', () => {
    beforeEach(() => {
      // Create a project to archive
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('archive-me', 'Archive Me Project', 'Project to archive', 'default')
      `).run();
    });

    it('should return confirmation prompt with --force command', () => {
      const output = exec('project archive archive-me --json');
      const result = extractJson<{ prompt: { type: string; message: string; choices: Array<{ name: string; command: string }> } }>(output);

      expect(result).to.exist;
      expect(result!.prompt).to.exist;
      expect(result!.prompt.message).to.include('Archive');

      // Find Yes choice - should have --force in command
      const yesChoice = result!.prompt.choices.find(c => c.name.toLowerCase().includes('yes'));
      expect(yesChoice).to.exist;
      expect(yesChoice!.command).to.include('--force');
    });

    it('should archive project with --force flag', () => {
      const output = exec('project archive archive-me --force --json');
      const result = extractJson<{ success: boolean; archived: boolean }>(output);

      expect(result).to.exist;
      expect(result!.success).to.equal(true);
      expect(result!.archived).to.equal(true);

      // Verify in database
      const project = db.prepare('SELECT is_archived FROM pmo_projects WHERE id = ?').get('archive-me') as { is_archived: number };
      expect(project.is_archived).to.equal(1);
    });
  });

  describe('project unarchive --json', () => {
    beforeEach(() => {
      // Create an archived project
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id, is_archived)
        VALUES ('unarchive-me', 'Unarchive Me Project', 'Archived project', 'default', 1)
      `).run();
    });

    it('should unarchive project and return success', () => {
      const output = exec('project unarchive unarchive-me --json');
      const result = extractJson<{ success: boolean; unarchived: boolean }>(output);

      expect(result).to.exist;
      expect(result!.success).to.equal(true);
      expect(result!.unarchived).to.equal(true);

      // Verify in database
      const project = db.prepare('SELECT is_archived FROM pmo_projects WHERE id = ?').get('unarchive-me') as { is_archived: number };
      expect(project.is_archived).to.equal(0);
    });

    it('should return error for non-existent project', () => {
      const output = exec('project unarchive nonexistent --json');
      const result = extractJson<{ error: { code: string } }>(output);

      expect(result).to.exist;
      expect(result!.error).to.exist;
      expect(result!.error.code).to.equal('PROJECT_NOT_FOUND');
    });
  });

  describe('project spec --json', () => {
    beforeEach(() => {
      // Create a test spec
      db.prepare(`
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES ('SPEC-001', 'specs/test.md', 'Test Spec', 'active')
      `).run();

      // Create project_specs junction table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS pmo_project_specs (
          project_id TEXT NOT NULL,
          spec_id TEXT NOT NULL,
          PRIMARY KEY (project_id, spec_id)
        )
      `);
    });

    it('should return project spec info with available commands', () => {
      const output = exec('project spec test-project --json');
      const result = extractJson<{
        success: boolean;
        result: {
          projectId: string;
          commands: { addSpec: string; removeSpec: string };
        };
      }>(output);

      expect(result).to.exist;
      expect(result!.success).to.equal(true);
      expect(result!.result.projectId).to.equal('test-project');
      expect(result!.result.commands).to.exist;
      expect(result!.result.commands.addSpec).to.include('--add');
      expect(result!.result.commands.removeSpec).to.include('--remove');
    });
  });

  describe('project index (menu) --json', () => {
    it('should return menu choices with command fields', () => {
      const output = exec('project --json');
      const result = extractJson<{ prompt: { type: string; message: string; choices: Array<{ name: string; command: string }> } }>(output);

      expect(result).to.exist;
      expect(result!.prompt).to.exist;
      expect(result!.prompt.type).to.equal('list');

      // Verify each action choice has a command field
      const createChoice = result!.prompt.choices.find(c => c.name.toLowerCase().includes('create'));
      expect(createChoice).to.exist;
      expect(createChoice!.command).to.include('project create');

      const listChoice = result!.prompt.choices.find(c => c.name.toLowerCase().includes('list'));
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('project list');

      const viewChoice = result!.prompt.choices.find(c => c.name.toLowerCase().includes('view'));
      expect(viewChoice).to.exist;
      expect(viewChoice!.command).to.include('project view');
    });
  });
});

// Helper function to set up test database with complete PMO schema
function setupTestDatabase(db: Database.Database, pmoPath: string) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pmo_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_workflow_statuses (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES pmo_workflows(id) ON DELETE CASCADE,
      UNIQUE(workflow_id, name)
    );

    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT,
      description TEXT,
      initiative_id TEXT,
      workflow_id TEXT,
      is_archived INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES pmo_workflows(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, id)
    );

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
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
  `);

  // Insert workflow
  db.prepare(`
    INSERT INTO pmo_workflows (id, name, description, is_builtin)
    VALUES ('default', 'Default', 'Default kanban workflow', 1)
  `).run();

  // Insert workflow statuses (board columns)
  const statuses = [
    { id: 'status-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 1 },
    { id: 'status-review', name: 'Review', category: 'started', position: 2 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 3 },
  ];

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_workflow_statuses (id, workflow_id, name, category, position, is_default)
      VALUES (?, 'default', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }

  // Insert test project with workflow reference
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description, workflow_id)
    VALUES ('test-project', 'Test Project', 'E2E test project', 'default')
  `).run();

  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', ?), ('current_project', 'test-project')
  `).run(pmoPath);

  // Insert columns (legacy - still used by some commands)
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in-progress', name: 'In Progress', position: 1 },
    { id: 'review', name: 'Review', position: 2 },
    { id: 'done', name: 'Done', position: 3 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `).run(col.id, col.name, col.position);
  }
}
