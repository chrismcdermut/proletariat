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
 * Looks for the first line starting with { or [ and parses from there.
 */
function extractJson<T>(output: string): T {
  const lines = output.split('\n');
  let jsonStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      jsonStart = i;
      break;
    }
  }

  if (jsonStart === -1) {
    throw new Error(`No JSON found in output: ${output.substring(0, 500)}...`);
  }

  const jsonLines = lines.slice(jsonStart).join('\n');
  return JSON.parse(jsonLines) as T;
}

/**
 * Integration tests for phase command JSON mode.
 *
 * These tests verify that:
 * 1. Phase commands support --machine flag (and legacy --json)
 * 2. JSON output includes proper prompt schema
 * 3. Flag accumulation works correctly in choices
 */
describe('Phase Commands JSON Mode', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('phase-json-');

    db = new Database(env.dbPath);
    setupTestDatabase(db, env.pmoPath);

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  /**
   * Helper to create a test phase directly in the database.
   */
  function createTestPhase(
    id: string,
    name: string,
    category: string = 'started',
    position: number = 0
  ): void {
    db.prepare(`
      INSERT INTO pmo_phases (id, name, category, position, is_default)
      VALUES (?, ?, ?, ?, 0)
    `).run(id, name, category, position);
  }

  describe('phase list --machine', () => {
    beforeEach(() => {
      createTestPhase('phase-1', 'In Progress', 'started', 0);
      createTestPhase('phase-2', 'Review', 'started', 1);
    });

    it('should output valid JSON with --machine flag', () => {
      const output = exec('phase list --machine');
      const json = extractJson<Array<{ id: string; name: string; category: string }>>(output);

      expect(json).to.be.an('array');
      expect(json.length).to.be.greaterThan(0);
      expect(json[0]).to.have.property('id');
      expect(json[0]).to.have.property('name');
      expect(json[0]).to.have.property('category');
    });

    it('should output valid JSON with --json flag (legacy)', () => {
      const output = exec('phase list --json');
      const json = extractJson<Array<{ id: string; name: string }>>(output);

      expect(json).to.be.an('array');
    });

    it('should work with -m shorthand', () => {
      const output = exec('phase list -m');
      const json = extractJson<Array<{ id: string; name: string }>>(output);

      expect(json).to.be.an('array');
    });

    it('should filter by category with --machine flag', () => {
      const output = exec('phase list --category started --machine');
      const json = extractJson<Array<{ id: string; category: string }>>(output);

      expect(json).to.be.an('array');
      for (const phase of json) {
        expect(phase.category).to.equal('started');
      }
    });

    it('should produce same structure with --machine and --json', () => {
      const jsonOutput = exec('phase list --json');
      const machineOutput = exec('phase list --machine');

      const jsonResult = extractJson<Array<{ id: string }>>(jsonOutput);
      const machineResult = extractJson<Array<{ id: string }>>(machineOutput);

      expect(machineResult.length).to.equal(jsonResult.length);
    });
  });

  describe('phase create --machine', () => {
    it('should output prompt JSON when name not provided', () => {
      const output = exec('phase create --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('input');
      expect(json.prompt.name).to.equal('name');
      expect(json.metadata.command).to.equal('phase create');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should output category prompt when name provided', () => {
      const output = exec('phase create "Test Phase" --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; choices: Array<{ name: string; value: string }> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('category');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.length).to.be.greaterThan(0);
    });

    it('should work with -m shorthand', () => {
      const output = exec('phase create -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should create phase when all flags provided', () => {
      const output = exec('phase create "New Phase" --category started --machine');

      // Should succeed and create the phase (not return prompt JSON)
      expect(output).to.include('Created phase');
      expect(output).to.include('New Phase');
    });
  });

  describe('phase update --machine', () => {
    beforeEach(() => {
      createTestPhase('test-phase', 'Test Phase', 'started', 0);
    });

    it('should output prompt JSON when phase ID not provided', () => {
      const output = exec('phase update --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('phaseId');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include command field in choices for flag accumulation', () => {
      const output = exec('phase update --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string; value: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('should work with -m shorthand', () => {
      const output = exec('phase update -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should update phase when ID and change flags provided', () => {
      const output = exec('phase update test-phase --name "Updated Phase"');

      expect(output).to.include('Updated phase');
      expect(output).to.include('Updated Phase');
    });
  });

  describe('phase delete --machine', () => {
    beforeEach(() => {
      createTestPhase('delete-phase', 'Delete Me', 'started', 0);
    });

    it('should output confirmation prompt JSON', () => {
      const output = exec('phase delete delete-phase --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: unknown }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('confirmed');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include force flag in Yes choice command', () => {
      const output = exec('phase delete delete-phase --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; command?: string; value: string }> };
      }>(output);

      // FlagResolver converts boolean values to strings in JSON output
      const yesChoice = json.prompt.choices.find(c => c.value === 'true');
      expect(yesChoice).to.exist;
      expect(yesChoice!.command).to.include('--force');
      expect(yesChoice!.command).to.include('--json');
    });

    it('should work with -m shorthand', () => {
      const output = exec('phase delete delete-phase -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should delete phase when --force provided', () => {
      const output = exec('phase delete delete-phase --force');

      expect(output).to.include('Deleted phase');
      expect(output).to.include('Delete Me');
    });
  });

  describe('phase move --machine', () => {
    beforeEach(() => {
      createTestPhase('move-phase-1', 'Phase One', 'started', 0);
      createTestPhase('move-phase-2', 'Phase Two', 'started', 1);
    });

    it('should output phase selection prompt when ID not provided', () => {
      const output = exec('phase move --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('phaseId');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should output position selection prompt when ID provided', () => {
      const output = exec('phase move move-phase-1 --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('position');
      expect(json.prompt.choices).to.be.an('array');
    });

    it('should work with -m shorthand', () => {
      const output = exec('phase move -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should move phase when ID and position provided', () => {
      const output = exec('phase move move-phase-1 --position 1');

      expect(output.toLowerCase()).to.match(/moved|position/);
    });
  });
});

/**
 * Helper function to set up test database with phase schema.
 * Schema matches production schema from src/lib/pmo/schema.ts
 */
function setupTestDatabase(db: Database.Database, pmoPath: string) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pmo_phases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      status TEXT NOT NULL DEFAULT 'active',
      phase_id TEXT,
      workflow_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      target_date TIMESTAMP,
      initiative_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (phase_id) REFERENCES pmo_phases(id) ON DELETE SET NULL,
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
      labels TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_pmo_phases_category ON pmo_phases(category);
    CREATE INDEX IF NOT EXISTS idx_pmo_phases_position ON pmo_phases(category, position);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON pmo_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status_id ON pmo_tickets(status_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_projects_phase ON pmo_projects(phase_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_projects_workflow ON pmo_projects(workflow_id);
  `);

  // Insert workflow
  db.prepare(`
    INSERT INTO pmo_workflows (id, name, description, is_builtin)
    VALUES ('default', 'Default', 'Default kanban workflow', 1)
  `).run();

  // Insert workflow statuses
  const statuses = [
    { id: 'status-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 1 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 2 },
  ];

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_workflow_statuses (id, workflow_id, name, category, position, is_default)
      VALUES (?, 'default', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }

  // Insert test project
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description, workflow_id)
    VALUES ('test-project', 'Test Project', 'E2E test project', 'default')
  `).run();

  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', ?), ('current_project', 'test-project')
  `).run(pmoPath);

  // Insert columns
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in-progress', name: 'In Progress', position: 1 },
    { id: 'done', name: 'Done', position: 2 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `).run(col.id, col.name, col.position);
  }

  // Insert default phases
  const phases = [
    { id: 'idea', name: 'Idea', category: 'backlog', position: 0 },
    { id: 'planned', name: 'Planned', category: 'unstarted', position: 0 },
    { id: 'active', name: 'Active', category: 'started', position: 0 },
    { id: 'complete', name: 'Complete', category: 'completed', position: 0 },
  ];

  for (const phase of phases) {
    db.prepare(`
      INSERT OR IGNORE INTO pmo_phases (id, name, category, position, is_default)
      VALUES (?, ?, ?, ?, 0)
    `).run(phase.id, phase.name, phase.category, phase.position);
  }
}
