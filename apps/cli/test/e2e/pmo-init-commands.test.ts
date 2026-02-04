import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { exec, extractJson, type AgentPromptResponse } from './test-helpers.js';

/**
 * End-to-end tests for PMO Init Command
 * Tests: prlt pmo init (fresh init, reinitialize flow, JSON mode prompts)
 *
 * NOTE: exec() runs in non-TTY mode, so shouldOutputJson() returns true
 * automatically. This is the expected behavior for testing agent flows.
 * All prompts must be bypassed with flags to avoid hanging.
 */
describe('PMO Init Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-init-e2e-')));
    process.chdir(testDir);

    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    // Create HQ config
    fs.writeFileSync(
      path.join(proletariatDir, 'config.json'),
      JSON.stringify({ type: 'hq', name: 'test-hq', version: '2.0.0' }),
    );

    // Create empty workspace.db (no PMO tables yet)
    db = new Database(dbPath);
  });

  afterEach(() => {
    if (db) db.close();
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('prlt pmo init (fresh)', () => {
    it('should initialize PMO with all flags', () => {
      const output = exec('pmo init --location separate --template kanban --name "test-board"');

      expect(output).to.contain('PMO initialized successfully');
    });

    it('should create project in database', () => {
      exec('pmo init --location separate --template kanban --name "test-board"');

      // Re-open database to see new tables
      db.close();
      db = new Database(dbPath);

      const project = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('test-board') as { id: string; name: string } | undefined;
      expect(project).to.not.be.undefined;
      expect(project!.name).to.equal('test-board');
    });

    it('should create PMO directory structure', () => {
      exec('pmo init --location separate --template kanban --name "test-board"');

      const pmoDir = path.join(testDir, 'pmo');
      expect(fs.existsSync(pmoDir)).to.be.true;

      // Check project directory was created
      const projectDir = path.join(pmoDir, 'projects', 'test-board');
      expect(fs.existsSync(projectDir)).to.be.true;
    });

    it('should store PMO settings in database', () => {
      exec('pmo init --location separate --template kanban --name "test-board"');

      db.close();
      db = new Database(dbPath);

      const pmoPath = db.prepare('SELECT value FROM pmo_settings WHERE key = ?').get('pmo_path') as { value: string } | undefined;
      expect(pmoPath).to.not.be.undefined;
      expect(pmoPath!.value).to.equal('pmo');
    });
  });

  describe('prlt pmo init (existing PMO - JSON mode prompts)', () => {
    beforeEach(() => {
      setupExistingPMO(db, testDir);
    });

    it('should output action prompt in JSON mode when PMO exists', () => {
      const output = exec('pmo init --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.prompt.name).to.equal('action');
      expect(json!.prompt.choices).to.have.length(2);
    });

    it('should include command fields in action choices', () => {
      const output = exec('pmo init --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      for (const choice of json!.prompt.choices) {
        expect(choice.command).to.be.a('string');
        expect(choice.command).to.contain('prlt pmo init');
      }

      // Verify specific commands
      const cancelChoice = json!.prompt.choices.find(c => c.value === 'cancel');
      expect(cancelChoice).to.not.be.undefined;
      expect(cancelChoice!.command).to.contain('--action cancel');

      const reinitChoice = json!.prompt.choices.find(c => c.value === 'reinitialize');
      expect(reinitChoice).to.not.be.undefined;
      expect(reinitChoice!.command).to.contain('--action reinitialize');
    });

    it('should include metadata with command name', () => {
      const output = exec('pmo init --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata.command).to.equal('pmo init');
    });

    it('should output confirmation prompt when action is reinitialize in JSON mode', () => {
      const output = exec('pmo init --action reinitialize --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('input');
      expect(json!.prompt.name).to.equal('confirmation');
      expect(json!.prompt.message).to.contain('delete pmo');
    });
  });

  describe('prlt pmo init (existing PMO - reinitialize flow)', () => {
    beforeEach(() => {
      setupExistingPMO(db, testDir);
    });

    it('should reinitialize PMO with all flags', () => {
      const output = exec('pmo init --action reinitialize --confirmation "delete pmo" --location separate --template kanban --name "new-board"');

      expect(output).to.contain('PMO initialized successfully');

      // Verify new project was created
      db.close();
      db = new Database(dbPath);
      const project = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('new-board') as { id: string; name: string } | undefined;
      expect(project).to.not.be.undefined;
      expect(project!.name).to.equal('new-board');
    });

    it('should drop old PMO tables during reinitialize', () => {
      // Verify old project exists
      const oldProject = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('existing-project');
      expect(oldProject).to.not.be.undefined;

      exec('pmo init --action reinitialize --confirmation "delete pmo" --location separate --template kanban --name "fresh-board"');

      // Verify old project is gone
      db.close();
      db = new Database(dbPath);
      const result = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('existing-project');
      expect(result).to.be.undefined;
    });

    it('should cancel when action is cancel', () => {
      const output = exec('pmo init --action cancel');

      expect(output).to.contain('Cancelled');

      // Verify old project still exists
      const project = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('existing-project');
      expect(project).to.not.be.undefined;
    });

    it('should cancel when confirmation text is wrong', () => {
      const output = exec('pmo init --action reinitialize --confirmation "wrong text"');

      expect(output).to.contain('Cancelled');

      // Verify old project still exists
      const project = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('existing-project');
      expect(project).to.not.be.undefined;
    });
  });
});

/**
 * Sets up a minimal existing PMO in the test database.
 * Creates only the tables needed for pmo init to detect existing PMO.
 */
function setupExistingPMO(db: Database.Database, testDir: string) {
  db.exec(`
    -- Settings table
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Projects table (needed for existingPMO detection)
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

    -- Tickets table (needed for ticket count)
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

    -- Columns table (referenced by deletePMO)
    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, id)
    );
  `);

  // Seed data
  db.prepare('INSERT INTO pmo_settings (key, value) VALUES (?, ?)').run('pmo_path', 'pmo');
  db.prepare('INSERT INTO pmo_projects (id, name) VALUES (?, ?)').run('existing-project', 'Existing Project');
  db.prepare('INSERT INTO pmo_tickets (id, project_id, title) VALUES (?, ?, ?)').run('TKT-001', 'existing-project', 'Test Ticket');

  db.prepare('INSERT INTO pmo_columns (id, project_id, name, position) VALUES (?, ?, ?, ?)').run('backlog', 'existing-project', 'Backlog', 0);
  db.prepare('INSERT INTO pmo_columns (id, project_id, name, position) VALUES (?, ?, ?, ?)').run('done', 'existing-project', 'Done', 1);

  // Create HQ config
  const proletariatDir = path.join(testDir, '.proletariat');
  fs.writeFileSync(
    path.join(proletariatDir, 'config.json'),
    JSON.stringify({ type: 'hq', name: 'test-hq', hasPmo: true }),
  );

  // Create PMO directory
  const pmoDir = path.join(testDir, 'pmo', 'projects', 'existing-project');
  fs.mkdirSync(pmoDir, { recursive: true });
}
