import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { execInProcess } from './test-helpers.js';
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js';

/**
 * End-to-end tests for PMO Action Commands
 * Tests: prlt action list, show, create, update, delete
 *
 * Uses in-process command execution (execInProcess) for ~5x faster test runs.
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
    it('should list built-in actions', async () => {
      const output = await execInProcess('action list');

      expect(output).to.contain('Groom');
      expect(output).to.contain('Implement');
      expect(output).to.contain('Continue');
      expect(output).to.contain('Revise');
      expect(output).to.contain('Write Tests');
      expect(output).to.contain('Code Review');
      expect(output).to.contain('Explore CLI');
    });

    it('should show action descriptions', async () => {
      const output = await execInProcess('action list');

      expect(output).to.contain('Flesh out ticket');
      expect(output).to.contain('Write code to implement');
    });

    it('should filter by --builtin', async () => {
      // Create a custom action first
      await execInProcess('action create "Custom Action" --prompt "Do something custom"');

      const output = await execInProcess('action list --builtin');

      expect(output).to.contain('Groom');
      expect(output).to.contain('Implement');
      expect(output).not.to.contain('Custom Action');
    });

    it('should filter by --custom', async () => {
      // Create a custom action first
      await execInProcess('action create "My Custom" --prompt "Do something"');

      const output = await execInProcess('action list --custom');

      expect(output).to.contain('My Custom');
      expect(output).not.to.contain('Groom');
      expect(output).not.to.contain('Implement');
    });

    it('should filter by --from-state', async () => {
      const output = await execInProcess('action list --from-state backlog');

      expect(output).to.contain('Groom');
      // Implement is suggested for unstarted/started, not backlog
    });

    it('should output JSON with --json flag', async () => {
      const output = await execInProcess('action list --json');

      const actions = JSON.parse(output);
      expect(actions).to.be.an('array');
      expect(actions.length).to.be.greaterThan(0);
      expect(actions[0]).to.have.property('id');
      expect(actions[0]).to.have.property('name');
      expect(actions[0]).to.have.property('prompt');
    });
  });

  describe('prlt action show', () => {
    it('should show action details', async () => {
      const output = await execInProcess('action show groom');

      expect(output).to.contain('Groom');
      expect(output).to.contain('Prompt:');
      expect(output).to.contain('Suggested for:');
      expect(output).to.contain('backlog');
    });

    it('should show full prompt text', async () => {
      const output = await execInProcess('action show implement');

      expect(output).to.contain('Implement');
      expect(output).to.contain('acceptance criteria');
    });

    it('should show moves-to category', async () => {
      const output = await execInProcess('action show groom');

      expect(output).to.contain('Moves to:');
      expect(output).to.contain('unstarted');
    });

    it('should show built-in status', async () => {
      const output = await execInProcess('action show groom');

      expect(output).to.contain('Built-in:');
      expect(output).to.contain('Yes');
    });

    it('should error when action not found', async () => {
      const output = await execInProcess('action show non-existent');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt action create', () => {
    it('should create action with name and prompt', async () => {
      const output = await execInProcess('action create "Security Audit" --prompt "Review for security vulnerabilities"');

      expect(output).to.contain('Created action');
      expect(output).to.contain('Security Audit');

      const action = db.prepare('SELECT * FROM pmo_actions WHERE name = ?').get('Security Audit') as { id: string; prompt: string };
      expect(action).to.not.be.undefined;
      expect(action.prompt).to.contain('security vulnerabilities');
    });

    it('should create action with description', async () => {
      await execInProcess('action create "Doc Review" --prompt "Review documentation" --description "Check docs for accuracy"');

      const action = db.prepare('SELECT description FROM pmo_actions WHERE name = ?').get('Doc Review') as { description: string };
      expect(action).to.not.be.undefined;
      expect(action.description).to.equal('Check docs for accuracy');
    });

    it('should create action with from-state', async () => {
      await execInProcess('action create "Polish" --prompt "Polish the code" --from-state "completed"');

      const action = db.prepare('SELECT from_state FROM pmo_actions WHERE name = ?').get('Polish') as { from_state: string };
      expect(action).to.not.be.undefined;
      expect(action.from_state).to.equal('completed');
    });

    it('should create action with to-state', async () => {
      await execInProcess('action create "Finish Up" --prompt "Complete the work" --to-state completed');

      const action = db.prepare('SELECT to_state FROM pmo_actions WHERE name = ?').get('Finish Up') as { to_state: string };
      expect(action).to.not.be.undefined;
      expect(action.to_state).to.equal('completed');
    });

    it('should slugify action ID from name', async () => {
      await execInProcess('action create "Action With Spaces" --prompt "Test"');

      const action = db.prepare('SELECT id FROM pmo_actions WHERE name = ?').get('Action With Spaces') as { id: string };
      expect(action).to.not.be.undefined;
      expect(action.id).to.equal('action-with-spaces');
    });

    it('should error when action name already exists', async () => {
      await execInProcess('action create "Duplicate" --prompt "First"');
      const output = await execInProcess('action create "Duplicate" --prompt "Second"');

      expect(output.toLowerCase()).to.contain('already exists');
    });

    it('should default modifiesCode to true', async () => {
      await execInProcess('action create "Code Changer" --prompt "Change code"');

      const action = db.prepare('SELECT modifies_code FROM pmo_actions WHERE name = ?').get('Code Changer') as { modifies_code: number };
      expect(action).to.not.be.undefined;
      expect(action.modifies_code).to.equal(1);
    });
  });

  describe('prlt action update', () => {
    beforeEach(async () => {
      // Create a custom action to update
      await execInProcess('action create "Updatable" --prompt "Original prompt" --description "Original desc"');
    });

    it('should update action name', async () => {
      await execInProcess('action update updatable --name "New Name"');

      const action = db.prepare('SELECT name FROM pmo_actions WHERE id = ?').get('updatable') as { name: string };
      expect(action.name).to.equal('New Name');
    });

    it('should update action prompt', async () => {
      await execInProcess('action update updatable --prompt "Updated prompt text"');

      const action = db.prepare('SELECT prompt FROM pmo_actions WHERE id = ?').get('updatable') as { prompt: string };
      expect(action.prompt).to.equal('Updated prompt text');
    });

    it('should update action description', async () => {
      await execInProcess('action update updatable --description "New description"');

      const action = db.prepare('SELECT description FROM pmo_actions WHERE id = ?').get('updatable') as { description: string };
      expect(action.description).to.equal('New description');
    });

    it('should update from-state', async () => {
      await execInProcess('action update updatable --from-state "started"');

      const action = db.prepare('SELECT from_state FROM pmo_actions WHERE id = ?').get('updatable') as { from_state: string };
      expect(action.from_state).to.equal('started');
    });

    it('should update to-state', async () => {
      await execInProcess('action update updatable --to-state completed');

      const action = db.prepare('SELECT to_state FROM pmo_actions WHERE id = ?').get('updatable') as { to_state: string };
      expect(action.to_state).to.equal('completed');
    });

    it('should error when action not found', async () => {
      const output = await execInProcess('action update non-existent --name "New Name"');

      expect(output.toLowerCase()).to.contain('not found');
    });

    // Note: "no flags" now enters interactive mode instead of erroring
    // Interactive mode tests are handled separately

    it('should not allow updating built-in actions', async () => {
      const output = await execInProcess('action update groom --name "New Groom"');

      expect(output.toLowerCase()).to.contain('built-in');
    });
  });

  describe('prlt action delete', () => {
    beforeEach(async () => {
      // Create a custom action to delete
      await execInProcess('action create "Deletable" --prompt "Can be deleted"');
    });

    it('should delete custom action', async () => {
      await execInProcess('action delete deletable --force');

      const action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('deletable');
      expect(action).to.be.undefined;
    });

    it('should show success message', async () => {
      const output = await execInProcess('action delete deletable --force');

      expect(output).to.contain('Deleted action');
      expect(output).to.contain('Deletable');
    });

    it('should error when action not found', async () => {
      const output = await execInProcess('action delete non-existent --force');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should not allow deleting built-in actions', async () => {
      const output = await execInProcess('action delete groom --force');

      expect(output.toLowerCase()).to.contain('built-in');
    });
  });
});

// Helper functions

function setupTestDatabase(db: Database.Database) {
  // Use production schema to ensure all columns and tables are present
  initializePMOTables(db);

  // Create default project
  db.prepare(`
    INSERT OR IGNORE INTO pmo_projects (id, name, is_archived, workflow_id)
    VALUES ('default', 'Default Project', 0, 'default')
  `).run();

  // Set PMO settings
  db.prepare(`INSERT OR REPLACE INTO pmo_settings (key, value) VALUES ('pmo_path', 'pmo')`).run();
  db.prepare(`INSERT OR REPLACE INTO pmo_settings (key, value) VALUES ('current_project', 'default')`).run();

  // Create default columns
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in_progress', name: 'In Progress', position: 1 },
    { id: 'done', name: 'Done', position: 2 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT OR IGNORE INTO pmo_columns (id, project_id, name, position)
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
