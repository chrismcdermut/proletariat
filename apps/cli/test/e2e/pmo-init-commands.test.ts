import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import {
  exec,
  execProduction,
  extractJson,
  agentExec,
  findChoice,
  findChoiceByValue,
  execChoice,
  type AgentPromptResponse,
} from './test-helpers.js';

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

  // ===========================================================================
  // Path 1: Fresh init (no existing PMO)
  // Menu flow: no prompts needed, all values from flags → PMO created
  // ===========================================================================
  describe('prlt pmo init (fresh init - create)', () => {
    it('should initialize PMO with all flags and report success', () => {
      const output = exec('pmo init --location separate --template kanban --name "test-board"');

      expect(output).to.contain('PMO initialized successfully');
    });

    it('should create project in database with correct name', () => {
      exec('pmo init --location separate --template kanban --name "test-board"');

      // Re-open database to see new tables
      db.close();
      db = new Database(dbPath);

      const project = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('test-board') as { id: string; name: string } | undefined;
      expect(project).to.not.be.undefined;
      expect(project!.name).to.equal('test-board');
    });

    it('should create PMO directory and project folder structure', () => {
      exec('pmo init --location separate --template kanban --name "test-board"');

      const pmoDir = path.join(testDir, 'pmo');
      expect(fs.existsSync(pmoDir)).to.be.true;

      // Check project directory was created
      const projectDir = path.join(pmoDir, 'projects', 'test-board');
      expect(fs.existsSync(projectDir)).to.be.true;
    });

    it('should store PMO path setting in database', () => {
      exec('pmo init --location separate --template kanban --name "test-board"');

      db.close();
      db = new Database(dbPath);

      const pmoPath = db.prepare('SELECT value FROM pmo_settings WHERE key = ?').get('pmo_path') as { value: string } | undefined;
      expect(pmoPath).to.not.be.undefined;
      expect(pmoPath!.value).to.equal('pmo');
    });

    it('should not prompt and use defaults when --json is passed without flags', () => {
      // In non-TTY mode (exec runs non-TTY), shouldOutputJson returns true.
      // Without this fix, the command would hang waiting for interactive prompts.
      const output = exec('pmo init --json');

      expect(output).to.contain('PMO initialized successfully');

      // Verify defaults were applied: template=kanban, location=separate
      db.close();
      db = new Database(dbPath);

      const pmoPath = db.prepare('SELECT value FROM pmo_settings WHERE key = ?').get('pmo_path') as { value: string } | undefined;
      expect(pmoPath).to.not.be.undefined;
      // separate location creates pmo/ directory
      expect(pmoPath!.value).to.equal('pmo');
    });

    it('should initialize with linear template', () => {
      exec('pmo init --location separate --template linear --name "linear-board"');

      db.close();
      db = new Database(dbPath);

      const project = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('linear-board') as { id: string; name: string; template: string } | undefined;
      expect(project).to.not.be.undefined;
      expect(project!.name).to.equal('linear-board');
    });
  });

  // ===========================================================================
  // Path 2: Existing PMO → Agent navigation (step-by-step menu flow)
  // Simulates what an AI agent does: follow command fields from each prompt
  // ===========================================================================
  describe('prlt pmo init (agent navigation - full menu flow)', () => {
    beforeEach(() => {
      setupExistingPMO(db, testDir);
    });

    it('should navigate: step 1 → action prompt, step 2 → pick reinitialize → confirmation prompt, step 3 → complete reinitialize', () => {
      // STEP 1: Agent calls pmo init --json → gets action selection prompt
      const step1 = agentExec('pmo init --json');
      expect(step1).to.not.be.null;
      expect(step1!.prompt.type).to.equal('list');
      expect(step1!.prompt.name).to.equal('action');
      expect(step1!.prompt.choices).to.have.length(2);

      // Agent finds the "Reinitialize" choice
      const reinitChoice = findChoice(step1!.prompt.choices, 'Reinitialize');
      expect(reinitChoice).to.not.be.undefined;
      expect(reinitChoice!.command).to.be.a('string');

      // STEP 2: Agent follows the command from reinitialize choice → gets confirmation prompt
      const step2Cmd = execChoice(reinitChoice!);
      const step2 = agentExec(step2Cmd);
      expect(step2).to.not.be.null;
      expect(step2!.prompt.type).to.equal('input');
      expect(step2!.prompt.name).to.equal('confirmation');
      expect(step2!.prompt.message).to.contain('delete pmo');

      // STEP 3: Agent provides confirmation + all required flags to complete
      const output = execProduction(
        'pmo init --action reinitialize --confirmation "delete pmo" --location separate --template kanban --name "agent-board"'
      );
      expect(output).to.contain('PMO initialized successfully');

      // VERIFY END RESULT: Old PMO is gone, new one exists
      db.close();
      db = new Database(dbPath);
      const oldProject = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('existing-project');
      expect(oldProject).to.be.undefined;

      const newProject = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('agent-board') as { id: string; name: string } | undefined;
      expect(newProject).to.not.be.undefined;
      expect(newProject!.name).to.equal('agent-board');
    });

    it('should navigate: step 1 → action prompt, step 2 → pick cancel → PMO preserved', () => {
      // STEP 1: Agent calls pmo init --json → gets action selection prompt
      const step1 = agentExec('pmo init --json');
      expect(step1).to.not.be.null;
      expect(step1!.prompt.type).to.equal('list');

      // Agent finds the "Cancel" choice
      const cancelChoice = findChoice(step1!.prompt.choices, 'Cancel');
      expect(cancelChoice).to.not.be.undefined;
      expect(cancelChoice!.command).to.be.a('string');

      // STEP 2: Agent follows the cancel command
      const cancelCmd = execChoice(cancelChoice!);
      const output = execProduction(cancelCmd.replace(' --json', ''));
      expect(output).to.contain('Cancelled');

      // VERIFY END RESULT: Old PMO is still intact
      const project = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('existing-project');
      expect(project).to.not.be.undefined;
    });
  });

  // ===========================================================================
  // JSON mode prompt schema validation
  // Verifies the structure agents receive at each menu step
  // ===========================================================================
  describe('prlt pmo init (JSON mode prompt schema)', () => {
    beforeEach(() => {
      setupExistingPMO(db, testDir);
    });

    it('step 1: action prompt has correct schema with choices and commands', () => {
      const output = exec('pmo init --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.prompt.name).to.equal('action');
      expect(json!.prompt.message).to.contain('PMO already exists');
      expect(json!.prompt.choices).to.have.length(2);

      // Every choice must have a command field for agent navigation
      for (const choice of json!.prompt.choices) {
        expect(choice).to.have.property('name').that.is.a('string');
        expect(choice).to.have.property('value').that.is.a('string');
        expect(choice).to.have.property('command').that.is.a('string');
        expect(choice.command).to.contain('prlt pmo init');
      }

      // Verify specific choice values and commands
      const cancelChoice = findChoiceByValue(json!.prompt.choices, 'cancel');
      expect(cancelChoice).to.not.be.undefined;
      expect(cancelChoice!.command).to.contain('--action cancel');

      const reinitChoice = findChoiceByValue(json!.prompt.choices, 'reinitialize');
      expect(reinitChoice).to.not.be.undefined;
      expect(reinitChoice!.command).to.contain('--action reinitialize');
    });

    it('step 1: metadata includes command name and flags', () => {
      const output = exec('pmo init --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata).to.have.property('command').that.equals('pmo init');
      expect(json!.metadata).to.have.property('flags').that.is.an('object');
      expect(json!.metadata).to.have.property('timestamp').that.is.a('string');
    });

    it('step 2: confirmation prompt has correct input schema with context hints', () => {
      const output = exec('pmo init --action reinitialize --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('input');
      expect(json!.prompt.name).to.equal('confirmation');
      expect(json!.prompt.message).to.contain('delete pmo');

      // Context should provide hints for the agent
      const context = (json!.prompt as { context?: { hint?: string; example?: string } }).context;
      expect(context).to.not.be.undefined;
      expect(context!.hint).to.contain('--confirmation');
      expect(context!.example).to.contain('prlt pmo init');
    });

    it('step 1: action prompt message includes project and ticket counts', () => {
      const output = exec('pmo init --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      // The existing PMO has 1 project and 1 ticket
      expect(json!.prompt.message).to.contain('1 project');
      expect(json!.prompt.message).to.contain('1 ticket');
    });
  });

  // ===========================================================================
  // End-to-end result verification for each menu path
  // Tests that the END RESULT is correct (DB state, files, output)
  // ===========================================================================
  describe('prlt pmo init (end result verification)', () => {
    describe('fresh init → verify created', () => {
      it('should create kanban board file in project directory', () => {
        exec('pmo init --location separate --template kanban --name "my-project"');

        const boardPath = path.join(testDir, 'pmo', 'projects', 'my-project', 'kanban.md');
        expect(fs.existsSync(boardPath)).to.be.true;

        const content = fs.readFileSync(boardPath, 'utf-8');
        expect(content).to.contain('Backlog');
        expect(content).to.contain('In Progress');
      });

      it('should create epic folder structure with lifecycle stages', () => {
        exec('pmo init --location separate --template kanban --name "my-project"');

        const epicsDir = path.join(testDir, 'pmo', 'projects', 'my-project', 'epics');
        expect(fs.existsSync(epicsDir)).to.be.true;

        // Verify lifecycle stage directories
        expect(fs.existsSync(path.join(epicsDir, 'draft'))).to.be.true;
        expect(fs.existsSync(path.join(epicsDir, 'active'))).to.be.true;
        expect(fs.existsSync(path.join(epicsDir, 'complete'))).to.be.true;
      });

      it('should create README in PMO directory', () => {
        exec('pmo init --location separate --template kanban --name "my-project"');

        const readmePath = path.join(testDir, 'pmo', 'README.md');
        expect(fs.existsSync(readmePath)).to.be.true;

        const content = fs.readFileSync(readmePath, 'utf-8');
        expect(content).to.contain('kanban');
      });
    });

    describe('reinitialize → verify old deleted, new created', () => {
      beforeEach(() => {
        setupExistingPMO(db, testDir);
      });

      it('should drop all old PMO tables and create new ones', () => {
        // Verify old data exists
        const oldProject = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('existing-project');
        expect(oldProject).to.not.be.undefined;
        const oldTicket = db.prepare('SELECT * FROM pmo_tickets WHERE id = ?').get('TKT-001');
        expect(oldTicket).to.not.be.undefined;

        exec('pmo init --action reinitialize --confirmation "delete pmo" --location separate --template kanban --name "reinit-board"');

        // Verify old data is gone, new data exists
        db.close();
        db = new Database(dbPath);

        const oldProjectAfter = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('existing-project');
        expect(oldProjectAfter).to.be.undefined;

        const newProject = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('reinit-board') as { id: string; name: string } | undefined;
        expect(newProject).to.not.be.undefined;
        expect(newProject!.name).to.equal('reinit-board');

        // Old tickets should be gone (table was dropped and recreated)
        const oldTicketAfter = db.prepare("SELECT * FROM pmo_tickets WHERE id = 'TKT-001'").get();
        expect(oldTicketAfter).to.be.undefined;
      });

      it('should create new project directory after reinitialize', () => {
        exec('pmo init --action reinitialize --confirmation "delete pmo" --location separate --template kanban --name "reinit-board"');

        const newProjectDir = path.join(testDir, 'pmo', 'projects', 'reinit-board');
        expect(fs.existsSync(newProjectDir)).to.be.true;

        const boardPath = path.join(newProjectDir, 'kanban.md');
        expect(fs.existsSync(boardPath)).to.be.true;
      });
    });

    describe('cancel → verify preserved', () => {
      beforeEach(() => {
        setupExistingPMO(db, testDir);
      });

      it('should preserve all existing data when cancelled via action flag', () => {
        const output = exec('pmo init --action cancel');
        expect(output).to.contain('Cancelled');

        // All old data should still be intact
        const project = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('existing-project');
        expect(project).to.not.be.undefined;
        const ticket = db.prepare('SELECT * FROM pmo_tickets WHERE id = ?').get('TKT-001');
        expect(ticket).to.not.be.undefined;
        const settings = db.prepare('SELECT * FROM pmo_settings WHERE key = ?').get('pmo_path');
        expect(settings).to.not.be.undefined;
      });

      it('should preserve all existing data when confirmation text is wrong', () => {
        const output = exec('pmo init --action reinitialize --confirmation "no"');
        expect(output).to.contain('Cancelled');

        // All old data should still be intact
        const project = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('existing-project');
        expect(project).to.not.be.undefined;
        const ticket = db.prepare('SELECT * FROM pmo_tickets WHERE id = ?').get('TKT-001');
        expect(ticket).to.not.be.undefined;
      });

      it('should preserve PMO directory when cancelled', () => {
        exec('pmo init --action cancel');

        const pmoDir = path.join(testDir, 'pmo');
        expect(fs.existsSync(pmoDir)).to.be.true;

        const projectDir = path.join(pmoDir, 'projects', 'existing-project');
        expect(fs.existsSync(projectDir)).to.be.true;
      });
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
