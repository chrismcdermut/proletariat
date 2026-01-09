import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { exec } from './test-helpers.js';

/**
 * End-to-end tests for PMO Action Commands
 * Tests: prlt action list, show, create, update, delete
 */
describe('PMO Action Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-action-e2e-'));
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

  describe('prlt action list', () => {
    it('should list built-in actions', () => {
      const output = exec('action list');

      expect(output).to.contain('Groom');
      expect(output).to.contain('Implement');
      expect(output).to.contain('Continue');
      expect(output).to.contain('Revise');
      expect(output).to.contain('Write Tests');
      expect(output).to.contain('Code Review');
    });

    it('should show action descriptions', () => {
      const output = exec('action list');

      expect(output).to.contain('Flesh out ticket');
      expect(output).to.contain('Write code to implement');
    });

    it('should filter by --builtin', () => {
      // Create a custom action first
      exec('action create "Custom Action" --prompt "Do something custom"');

      const output = exec('action list --builtin');

      expect(output).to.contain('Groom');
      expect(output).to.contain('Implement');
      expect(output).not.to.contain('Custom Action');
    });

    it('should filter by --custom', () => {
      // Create a custom action first
      exec('action create "My Custom" --prompt "Do something"');

      const output = exec('action list --custom');

      expect(output).to.contain('My Custom');
      expect(output).not.to.contain('Groom');
      expect(output).not.to.contain('Implement');
    });

    it('should filter by --suggested-for', () => {
      const output = exec('action list --suggested-for backlog');

      expect(output).to.contain('Groom');
      // Implement is suggested for unstarted/started, not backlog
    });

    it('should output JSON with --json flag', () => {
      const output = exec('action list --json');

      const actions = JSON.parse(output);
      expect(actions).to.be.an('array');
      expect(actions.length).to.be.greaterThan(0);
      expect(actions[0]).to.have.property('id');
      expect(actions[0]).to.have.property('name');
      expect(actions[0]).to.have.property('prompt');
    });
  });

  describe('prlt action show', () => {
    it('should show action details', () => {
      const output = exec('action show groom');

      expect(output).to.contain('Groom');
      expect(output).to.contain('Prompt:');
      expect(output).to.contain('Suggested for:');
      expect(output).to.contain('backlog');
    });

    it('should show full prompt text', () => {
      const output = exec('action show implement');

      expect(output).to.contain('Implement');
      expect(output).to.contain('acceptance criteria');
    });

    it('should show moves-to category', () => {
      const output = exec('action show groom');

      expect(output).to.contain('Moves to:');
      expect(output).to.contain('unstarted');
    });

    it('should show built-in status', () => {
      const output = exec('action show groom');

      expect(output).to.contain('Built-in:');
      expect(output).to.contain('Yes');
    });

    it('should error when action not found', () => {
      const output = exec('action show non-existent');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt action create', () => {
    it('should create action with name and prompt', () => {
      const output = exec('action create "Security Audit" --prompt "Review for security vulnerabilities"');

      expect(output).to.contain('Created action');
      expect(output).to.contain('Security Audit');

      const action = db.prepare('SELECT * FROM pmo_actions WHERE name = ?').get('Security Audit') as { id: string; prompt: string };
      expect(action).to.not.be.undefined;
      expect(action.prompt).to.contain('security vulnerabilities');
    });

    it('should create action with description', () => {
      exec('action create "Doc Review" --prompt "Review documentation" --description "Check docs for accuracy"');

      const action = db.prepare('SELECT description FROM pmo_actions WHERE name = ?').get('Doc Review') as { description: string };
      expect(action).to.not.be.undefined;
      expect(action.description).to.equal('Check docs for accuracy');
    });

    it('should create action with suggested-for categories', () => {
      exec('action create "Polish" --prompt "Polish the code" --suggested-for "completed,started"');

      const action = db.prepare('SELECT suggested_for_categories FROM pmo_actions WHERE name = ?').get('Polish') as { suggested_for_categories: string };
      expect(action).to.not.be.undefined;
      const categories = JSON.parse(action.suggested_for_categories);
      expect(categories).to.include('completed');
      expect(categories).to.include('started');
    });

    it('should create action with move-to category', () => {
      exec('action create "Finish Up" --prompt "Complete the work" --move-to completed');

      const action = db.prepare('SELECT default_move_to_category FROM pmo_actions WHERE name = ?').get('Finish Up') as { default_move_to_category: string };
      expect(action).to.not.be.undefined;
      expect(action.default_move_to_category).to.equal('completed');
    });

    it('should slugify action ID from name', () => {
      exec('action create "Action With Spaces" --prompt "Test"');

      const action = db.prepare('SELECT id FROM pmo_actions WHERE name = ?').get('Action With Spaces') as { id: string };
      expect(action).to.not.be.undefined;
      expect(action.id).to.equal('action-with-spaces');
    });

    it('should error when action name already exists', () => {
      exec('action create "Duplicate" --prompt "First"');
      const output = exec('action create "Duplicate" --prompt "Second"');

      expect(output.toLowerCase()).to.contain('already exists');
    });

    it('should default modifiesCode to true', () => {
      exec('action create "Code Changer" --prompt "Change code"');

      const action = db.prepare('SELECT modifies_code FROM pmo_actions WHERE name = ?').get('Code Changer') as { modifies_code: number };
      expect(action).to.not.be.undefined;
      expect(action.modifies_code).to.equal(1);
    });
  });

  describe('prlt action update', () => {
    beforeEach(() => {
      // Create a custom action to update
      exec('action create "Updatable" --prompt "Original prompt" --description "Original desc"');
    });

    it('should update action name', () => {
      exec('action update updatable --name "New Name"');

      const action = db.prepare('SELECT name FROM pmo_actions WHERE id = ?').get('updatable') as { name: string };
      expect(action.name).to.equal('New Name');
    });

    it('should update action prompt', () => {
      exec('action update updatable --prompt "Updated prompt text"');

      const action = db.prepare('SELECT prompt FROM pmo_actions WHERE id = ?').get('updatable') as { prompt: string };
      expect(action.prompt).to.equal('Updated prompt text');
    });

    it('should update action description', () => {
      exec('action update updatable --description "New description"');

      const action = db.prepare('SELECT description FROM pmo_actions WHERE id = ?').get('updatable') as { description: string };
      expect(action.description).to.equal('New description');
    });

    it('should update suggested-for categories', () => {
      exec('action update updatable --suggested-for "started,completed"');

      const action = db.prepare('SELECT suggested_for_categories FROM pmo_actions WHERE id = ?').get('updatable') as { suggested_for_categories: string };
      const categories = JSON.parse(action.suggested_for_categories);
      expect(categories).to.include('started');
      expect(categories).to.include('completed');
    });

    it('should update move-to category', () => {
      exec('action update updatable --move-to completed');

      const action = db.prepare('SELECT default_move_to_category FROM pmo_actions WHERE id = ?').get('updatable') as { default_move_to_category: string };
      expect(action.default_move_to_category).to.equal('completed');
    });

    it('should error when action not found', () => {
      const output = exec('action update non-existent --name "New Name"');

      expect(output.toLowerCase()).to.contain('not found');
    });

    // Note: "no flags" now enters interactive mode instead of erroring
    // Interactive mode tests are handled separately

    it('should not allow updating built-in actions', () => {
      const output = exec('action update groom --name "New Groom"');

      expect(output.toLowerCase()).to.contain('built-in');
    });
  });

  describe('prlt action delete', () => {
    beforeEach(() => {
      // Create a custom action to delete
      exec('action create "Deletable" --prompt "Can be deleted"');
    });

    it('should delete custom action', () => {
      exec('action delete deletable --force');

      const action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('deletable');
      expect(action).to.be.undefined;
    });

    it('should show success message', () => {
      const output = exec('action delete deletable --force');

      expect(output).to.contain('Deleted action');
      expect(output).to.contain('Deletable');
    });

    it('should error when action not found', () => {
      const output = exec('action delete non-existent --force');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should not allow deleting built-in actions', () => {
      const output = exec('action delete groom --force');

      expect(output.toLowerCase()).to.contain('built-in');
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

    -- Actions table
    CREATE TABLE IF NOT EXISTS pmo_actions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      prompt TEXT NOT NULL,
      suggested_for_categories TEXT,
      default_move_to_category TEXT,
      modifies_code INTEGER NOT NULL DEFAULT 1,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
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

    -- Tickets table
    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'backlog',
      status_id TEXT,
      priority TEXT,
      category TEXT,
      description TEXT,
      owner TEXT,
      assignee TEXT,
      branch TEXT,
      spec_id TEXT,
      epic_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
    );

    -- Board tickets table
    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (project_id, ticket_id)
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

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
  `);

  // Seed built-in actions (in workflow order)
  const builtinActions = [
    {
      id: 'groom',
      name: 'Groom',
      description: 'Flesh out ticket with requirements and acceptance criteria',
      prompt: 'Analyze this ticket and improve its definition...',
      suggestedForCategories: ['backlog'],
      defaultMoveToCategory: 'unstarted',
      modifiesCode: false,
      position: 0,
    },
    {
      id: 'implement',
      name: 'Implement',
      description: 'Write code to implement the ticket requirements',
      prompt: 'Implement this ticket according to its requirements and acceptance criteria...',
      suggestedForCategories: ['unstarted', 'started'],
      defaultMoveToCategory: 'started',
      modifiesCode: true,
      position: 1,
    },
    {
      id: 'continue',
      name: 'Continue',
      description: 'Continue working from where you left off',
      prompt: 'Continue working on this ticket from where you left off...',
      suggestedForCategories: ['started'],
      defaultMoveToCategory: 'started',
      modifiesCode: true,
      position: 2,
    },
    {
      id: 'test',
      name: 'Write Tests',
      description: 'Add comprehensive tests for the implementation',
      prompt: 'Write comprehensive tests...',
      suggestedForCategories: ['started', 'completed'],
      modifiesCode: true,
      position: 3,
    },
    {
      id: 'review',
      name: 'Code Review',
      description: 'Review the implementation for issues',
      prompt: 'Review this ticket...',
      suggestedForCategories: ['started', 'completed'],
      modifiesCode: false,
      position: 4,
    },
    {
      id: 'revise',
      name: 'Revise',
      description: 'Address PR feedback and review comments',
      prompt: 'Address the feedback on this ticket...',
      suggestedForCategories: ['completed'],
      defaultMoveToCategory: 'started',
      modifiesCode: true,
      position: 5,
    },
  ];

  for (const action of builtinActions) {
    db.prepare(`
      INSERT INTO pmo_actions (id, name, description, prompt, suggested_for_categories, default_move_to_category, modifies_code, is_builtin, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      action.id,
      action.name,
      action.description,
      action.prompt,
      JSON.stringify(action.suggestedForCategories),
      action.defaultMoveToCategory || null,
      action.modifiesCode ? 1 : 0,
      action.position
    );
  }

  // Create default project
  db.prepare(`
    INSERT INTO pmo_projects (id, name, is_archived)
    VALUES ('default', 'Default Project', 0)
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
