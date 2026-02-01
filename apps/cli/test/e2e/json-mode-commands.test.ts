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
function extractJson<T>(output: string): T {
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
    throw new Error(`No JSON found in output: ${output.substring(0, 500)}...`);
  }

  const jsonLines = lines.slice(jsonStart).join('\n');
  return JSON.parse(jsonLines) as T;
}

/**
 * Integration tests for JSON mode flag accumulation.
 *
 * These tests verify that when commands output JSON prompts for AI agents,
 * the `command` field in each choice includes all previously accumulated
 * flags (like -P projectId) so agents can navigate stateless menus.
 */
describe('JSON Mode Flag Accumulation', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('json-mode-');

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
   * Helper to insert a test ticket directly into the database.
   * More reliable than exec('ticket create ...') for test setup.
   */
  function createTestTicket(id: string, title: string, statusId: string = 'status-backlog'): void {
    db.prepare(`
      INSERT INTO pmo_tickets (id, project_id, title, status, status_id)
      VALUES (?, 'test-project', ?, 'backlog', ?)
    `).run(id, title, statusId);

    // Also insert into legacy board_tickets for backwards compatibility
    const columnId = statusId === 'status-backlog' ? 'backlog' :
                     statusId === 'status-in-progress' ? 'in-progress' :
                     statusId === 'status-review' ? 'review' : 'done';
    db.prepare(`
      INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
      VALUES ('test-project', ?, ?, 0)
    `).run(id, columnId);
  }

  describe('ticket move --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-001', 'Test ticket 1');
      createTestTicket('TKT-002', 'Test ticket 2');
    });

    it('should output valid JSON with prompt schema', () => {
      const output = exec('ticket move -P test-project --json');
      const json = extractJson<{ prompt: { type: string; name: string; message: string; choices: unknown[] } }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
    });

    it('should include project flag in ticket selection commands', () => {
      const output = exec('ticket move -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      // Each choice's command should include the project flag
      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
        expect(choice.command).to.include('--json');
      }
    });

    it('should include ticket ID and project flag in column selection commands', () => {
      const output = exec('ticket move TKT-001 -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      // Each choice's command should include ticket ID and project flag
      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('TKT-001');
        expect(choice.command).to.include('-P test-project');
        expect(choice.command).to.include('--json');
      }
    });

    it('should allow stateless navigation: project → ticket → column', () => {
      // Step 1: Get ticket choices with project flag
      const step1Output = exec('ticket move -P test-project --json');
      const step1Json = extractJson<{ prompt: { choices: Array<{ command: string; value: string }> } }>(step1Output);

      expect(step1Json.prompt.choices.length).to.be.greaterThan(0);
      const ticketCommand = step1Json.prompt.choices[0].command;

      // Verify command includes project flag
      expect(ticketCommand).to.include('-P test-project');

      // Step 2: Execute the command from step 1 (strip 'prlt ' prefix)
      const step2Command = ticketCommand.replace('prlt ', '');
      const step2Output = exec(step2Command);
      const step2Json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(step2Output);

      // Verify column choices still include project flag
      for (const choice of step2Json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket complete --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-003', 'Complete me');
    });

    it('should include project flag in ticket selection commands', () => {
      const output = exec('ticket complete -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket delete --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-004', 'Delete me');
    });

    it('should include project flag in ticket selection commands', () => {
      const output = exec('ticket delete -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket view --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-005', 'View me');
    });

    it('should include project flag in ticket selection commands', () => {
      const output = exec('ticket view -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket edit --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-006', 'Edit me');
    });

    it('should include project flag in ticket selection commands', () => {
      const output = exec('ticket edit -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket status --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-007', 'Status me');
    });

    it('should include project flag in ticket selection commands', () => {
      const output = exec('ticket status -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket update --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-008', 'Update me');
    });

    it('should include project flag in ticket selection commands', () => {
      const output = exec('ticket update -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket reassign --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-009', 'Reassign me');
    });

    it('should include project flag in ticket selection commands', () => {
      const output = exec('ticket reassign -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket link --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-010', 'Link me');
      createTestTicket('TKT-011', 'Link target');
    });

    it('should include project flag in ticket selection commands', () => {
      const output = exec('ticket link -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });

    it('should include project flag in link subcommands', () => {
      const output = exec('ticket link TKT-010 -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      // Menu commands should include project flag
      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('-P test-project');
        }
      }
    });
  });

  describe('ticket link block --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-012', 'Blocked ticket');
      createTestTicket('TKT-013', 'Blocker ticket');
    });

    it('should include project flag in blocker selection commands', () => {
      const output = exec('ticket link block TKT-012 -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket spec --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-014', 'Spec me');
      // Create a spec
      db.prepare(`
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES ('SPEC-001', 'specs/test.md', 'Test Spec', 'active')
      `).run();
    });

    it('should include project flag in ticket selection commands', () => {
      const output = exec('ticket spec -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });

    it('should include project flag in spec selection commands', () => {
      const output = exec('ticket spec TKT-014 -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket epic --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-015', 'Epic me');
      // Create an epic
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-001', 'test-project', 'Test Epic', 'active')
      `).run();
    });

    it('should include project flag in ticket selection commands', () => {
      const output = exec('ticket epic -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });

    it('should include project flag in epic selection commands', () => {
      const output = exec('ticket epic TKT-015 -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket project --json', () => {
    beforeEach(() => {
      createTestTicket('TKT-016', 'Project me');
      // Create another project to move to
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description)
        VALUES ('other-project', 'Other Project', 'Another project')
      `).run();
      // Add columns to the other project
      const columns = ['Backlog', 'In Progress', 'Done'];
      columns.forEach((name, i) => {
        db.prepare(`
          INSERT INTO pmo_columns (id, project_id, name, position)
          VALUES (?, 'other-project', ?, ?)
        `).run(`col-${i}`, name, i);
      });
    });

    it('should include source project flag in ticket selection commands', () => {
      const output = exec('ticket project -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });

    it('should include source project flag in target project selection commands', () => {
      const output = exec('ticket project TKT-016 -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('End-to-end stateless flow', () => {
    beforeEach(() => {
      createTestTicket('TKT-E2E', 'E2E Test Ticket');
    });

    it('should complete full ticket move flow via JSON commands', () => {
      // Step 1: Start with project selection implicit (single project auto-selects)
      const step1 = exec('ticket move -P test-project --json');
      const json1 = extractJson<{ prompt: { choices: Array<{ command: string; value: string }> } }>(step1);

      // Get first ticket command
      const ticketCmd = json1.prompt.choices[0].command.replace('prlt ', '');
      expect(ticketCmd).to.include('-P test-project');

      // Step 2: Select ticket, get column choices
      const step2 = exec(ticketCmd);
      const json2 = extractJson<{ prompt: { choices: Array<{ command: string; value: string; name: string }> } }>(step2);

      // Find "In Progress" column
      const inProgressChoice = json2.prompt.choices.find(c => c.name.includes('In Progress'));
      expect(inProgressChoice).to.exist;
      expect(inProgressChoice!.command).to.include('-P test-project');

      // Step 3: Execute the move (remove --json to actually execute)
      const moveCmd = inProgressChoice!.command.replace('prlt ', '').replace(' --json', '');
      const result = exec(moveCmd);

      // Verify ticket was moved
      expect(result).to.include('Moved');
      expect(result).to.include('In Progress');
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
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL
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
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL,
      FOREIGN KEY (epic_id) REFERENCES pmo_epics(id) ON DELETE SET NULL
    );

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

    CREATE TABLE IF NOT EXISTS pmo_subtasks (
      id TEXT NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      position INTEGER NOT NULL,
      PRIMARY KEY (ticket_id, id)
    );

    CREATE TABLE IF NOT EXISTS pmo_ticket_dependencies (
      ticket_id TEXT NOT NULL,
      depends_on_ticket_id TEXT NOT NULL,
      dependency_type TEXT NOT NULL DEFAULT 'blocks',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticket_id, depends_on_ticket_id),
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pmo_ticket_acceptance_criteria (
      id TEXT NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      criterion TEXT NOT NULL,
      verifiable INTEGER DEFAULT 1,
      verified INTEGER DEFAULT 0,
      verified_at TIMESTAMP,
      verified_by TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ticket_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_epic ON pmo_tickets(epic_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_epics_project ON pmo_epics(project_id);
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
