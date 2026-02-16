import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { exec } from './test-helpers.js';
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js';

/**
 * End-to-end tests for PMO Profile Commands
 * Tests: prlt profile list, show, create, edit, delete
 */
describe('PMO Profile Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-profile-e2e-'));
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

  describe('prlt profile list', () => {
    it('should show empty list when no profiles exist', () => {
      const output = exec('profile list');

      // In non-TTY mode, outputs JSON empty array
      const profiles = JSON.parse(output);
      expect(profiles).to.be.an('array');
      expect(profiles.length).to.equal(0);
    });

    it('should list created profiles', () => {
      exec('profile create "frontend-specialist" --description "Frontend focused"');
      exec('profile create "retro-enabled" --description "With retrospectives"');

      const output = exec('profile list');

      expect(output).to.contain('frontend-specialist');
      expect(output).to.contain('retro-enabled');
      expect(output).to.contain('Frontend focused');
      expect(output).to.contain('With retrospectives');
    });

    it('should show profile capabilities in JSON', () => {
      exec('profile create "full-profile" --start-hook "echo start" --end-hook "echo end" --system-prompt "Be careful" --repos "web-app,api"');

      const output = exec('profile list');

      // In non-TTY mode, outputs JSON array
      const profiles = JSON.parse(output);
      expect(profiles).to.be.an('array');
      expect(profiles.length).to.equal(1);
      expect(profiles[0].startHook).to.equal('echo start');
      expect(profiles[0].endHook).to.equal('echo end');
      expect(profiles[0].systemPrompt).to.equal('Be careful');
      expect(profiles[0].repos).to.deep.equal(['web-app', 'api']);
    });

    it('should output JSON with --json flag', () => {
      exec('profile create "test-profile" --description "Test"');

      const output = exec('profile list --json');

      const profiles = JSON.parse(output);
      expect(profiles).to.be.an('array');
      expect(profiles.length).to.equal(1);
      expect(profiles[0]).to.have.property('id');
      expect(profiles[0]).to.have.property('name');
      expect(profiles[0].name).to.equal('test-profile');
    });
  });

  describe('prlt profile show', () => {
    beforeEach(() => {
      exec('profile create "test-profile" --description "A test profile" --start-hook "echo start" --end-hook "echo end" --system-prompt "Be thorough" --repos "web-app,api"');
    });

    it('should show profile details', () => {
      const output = exec('profile show test-profile');

      expect(output).to.contain('test-profile');
      expect(output).to.contain('A test profile');
    });

    it('should show hooks in JSON', () => {
      const output = exec('profile show test-profile');

      // In non-TTY mode, outputs JSON object
      const profile = JSON.parse(output);
      expect(profile.startHook).to.equal('echo start');
      expect(profile.endHook).to.equal('echo end');
    });

    it('should show system prompt in JSON', () => {
      const output = exec('profile show test-profile');

      const profile = JSON.parse(output);
      expect(profile.systemPrompt).to.equal('Be thorough');
    });

    it('should show repos in JSON', () => {
      const output = exec('profile show test-profile');

      const profile = JSON.parse(output);
      expect(profile.repos).to.deep.equal(['web-app', 'api']);
    });

    it('should output JSON with --json flag', () => {
      const output = exec('profile show test-profile --json');

      const profile = JSON.parse(output);
      expect(profile).to.have.property('id', 'test-profile');
      expect(profile).to.have.property('name', 'test-profile');
      expect(profile).to.have.property('startHook', 'echo start');
      expect(profile).to.have.property('endHook', 'echo end');
      expect(profile).to.have.property('systemPrompt', 'Be thorough');
      expect(profile.repos).to.deep.equal(['web-app', 'api']);
    });

    it('should error when profile not found', () => {
      const output = exec('profile show non-existent');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt profile create', () => {
    it('should create profile with just a name', () => {
      const output = exec('profile create "minimal-profile"');

      // In non-TTY mode, outputs JSON of created profile
      const created = JSON.parse(output);
      expect(created.name).to.equal('minimal-profile');
      expect(created.id).to.equal('minimal-profile');

      const profile = db.prepare('SELECT * FROM pmo_agent_profiles WHERE name = ?').get('minimal-profile') as { id: string; name: string };
      expect(profile).to.not.be.undefined;
      expect(profile.id).to.equal('minimal-profile');
    });

    it('should create profile with all fields', () => {
      exec('profile create "full-profile" --description "Full config" --start-hook "npm install" --end-hook "prlt retro" --system-prompt "Be careful" --repos "web-app,api"');

      const profile = db.prepare('SELECT * FROM pmo_agent_profiles WHERE name = ?').get('full-profile') as {
        id: string; name: string; description: string; start_hook: string;
        end_hook: string; system_prompt: string; repos_json: string;
      };
      expect(profile).to.not.be.undefined;
      expect(profile.description).to.equal('Full config');
      expect(profile.start_hook).to.equal('npm install');
      expect(profile.end_hook).to.equal('prlt retro');
      expect(profile.system_prompt).to.equal('Be careful');
      const repos = JSON.parse(profile.repos_json);
      expect(repos).to.deep.equal(['web-app', 'api']);
    });

    it('should slugify profile ID from name', () => {
      exec('profile create "My Special Profile"');

      const profile = db.prepare('SELECT id FROM pmo_agent_profiles WHERE name = ?').get('My Special Profile') as { id: string };
      expect(profile).to.not.be.undefined;
      expect(profile.id).to.equal('my-special-profile');
    });

    it('should error when profile name already exists', () => {
      exec('profile create "duplicate"');
      const output = exec('profile create "duplicate"');

      expect(output.toLowerCase()).to.contain('already exists');
    });

    it('should set timestamps on creation', () => {
      exec('profile create "timestamped"');

      const profile = db.prepare('SELECT created_at, updated_at FROM pmo_agent_profiles WHERE name = ?').get('timestamped') as { created_at: string; updated_at: string };
      expect(profile).to.not.be.undefined;
      expect(profile.created_at).to.not.be.null;
      expect(profile.updated_at).to.not.be.null;
    });
  });

  describe('prlt profile edit', () => {
    beforeEach(() => {
      exec('profile create "editable" --description "Original" --start-hook "echo start" --repos "web-app"');
    });

    it('should update profile description', () => {
      exec('profile edit editable --description "Updated description"');

      const profile = db.prepare('SELECT description FROM pmo_agent_profiles WHERE id = ?').get('editable') as { description: string };
      expect(profile.description).to.equal('Updated description');
    });

    it('should update profile start hook', () => {
      exec('profile edit editable --start-hook "npm install && npm test"');

      const profile = db.prepare('SELECT start_hook FROM pmo_agent_profiles WHERE id = ?').get('editable') as { start_hook: string };
      expect(profile.start_hook).to.equal('npm install && npm test');
    });

    it('should update profile end hook', () => {
      exec('profile edit editable --end-hook "prlt retro generate"');

      const profile = db.prepare('SELECT end_hook FROM pmo_agent_profiles WHERE id = ?').get('editable') as { end_hook: string };
      expect(profile.end_hook).to.equal('prlt retro generate');
    });

    it('should update profile system prompt', () => {
      exec('profile edit editable --system-prompt "Always run tests"');

      const profile = db.prepare('SELECT system_prompt FROM pmo_agent_profiles WHERE id = ?').get('editable') as { system_prompt: string };
      expect(profile.system_prompt).to.equal('Always run tests');
    });

    it('should update profile repos', () => {
      exec('profile edit editable --repos "api,design-system"');

      const profile = db.prepare('SELECT repos_json FROM pmo_agent_profiles WHERE id = ?').get('editable') as { repos_json: string };
      const repos = JSON.parse(profile.repos_json);
      expect(repos).to.deep.equal(['api', 'design-system']);
    });

    it('should update profile name', () => {
      exec('profile edit editable --name "renamed-profile"');

      const profile = db.prepare('SELECT name FROM pmo_agent_profiles WHERE id = ?').get('editable') as { name: string };
      expect(profile.name).to.equal('renamed-profile');
    });

    it('should error when profile not found', () => {
      const output = exec('profile edit non-existent --name "New Name"');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should update updated_at timestamp', () => {
      const before = db.prepare('SELECT updated_at FROM pmo_agent_profiles WHERE id = ?').get('editable') as { updated_at: string };

      // Small delay to ensure different timestamp
      exec('profile edit editable --description "Changed"');

      const after = db.prepare('SELECT updated_at FROM pmo_agent_profiles WHERE id = ?').get('editable') as { updated_at: string };
      expect(after.updated_at).to.not.equal(before.updated_at);
    });
  });

  describe('prlt profile delete', () => {
    beforeEach(() => {
      exec('profile create "deletable" --description "Can be deleted"');
    });

    it('should delete profile with --force', () => {
      exec('profile delete deletable --force');

      const profile = db.prepare('SELECT * FROM pmo_agent_profiles WHERE id = ?').get('deletable');
      expect(profile).to.be.undefined;
    });

    it('should show success response', () => {
      const output = exec('profile delete deletable --force');

      // In non-TTY mode, outputs JSON success object
      const result = JSON.parse(output);
      expect(result.success).to.equal(true);
      expect(result.id).to.equal('deletable');
    });

    it('should error when profile not found', () => {
      const output = exec('profile delete non-existent --force');

      expect(output.toLowerCase()).to.contain('not found');
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
