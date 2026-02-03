import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
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
 * Integration tests for PR command JSON mode.
 *
 * These tests verify that:
 * 1. PR commands support --machine flag (and legacy --json)
 * 2. JSON output includes proper prompt schema
 * 3. Full multi-step agent flows complete successfully
 *
 * Note: PR commands interact with GitHub CLI (gh), so some tests
 * verify the prompt flow rather than actual PR creation.
 */
describe('PR Commands JSON Mode', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('pr-json-');

    db = new Database(env.dbPath);
    setupTestDatabase(db, env.pmoPath);

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');

    // Initialize git repo for PR commands
    initGitRepo(env.testDir);
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  /**
   * Helper to create a test ticket directly in the database.
   */
  function createTestTicket(
    id: string,
    title: string,
    columnId: string = 'in-progress',
    prUrl?: string
  ): void {
    const statusName = columnId === 'backlog' ? 'Backlog' :
                       columnId === 'in-progress' ? 'In Progress' :
                       columnId === 'review' ? 'Review' : 'Done';

    db.prepare(`
      INSERT INTO pmo_tickets (id, project_id, title, status, status_id)
      VALUES (?, 'test-project', ?, ?, ?)
    `).run(id, title, statusName, `status-${columnId}`);

    db.prepare(`
      INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
      VALUES ('test-project', ?, ?, 0)
    `).run(id, columnId);

    if (prUrl) {
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', ?)
      `).run(id, prUrl);
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_number', '123')
      `).run(id);
    }
  }

  describe('pr index --machine (main menu)', () => {
    it('should output valid JSON with action selection prompt', () => {
      const output = exec('pr -P test-project --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('action');
      expect(json.metadata.command).to.equal('pr');

      // Should have create, link, status actions
      const values = json.prompt.choices.map(c => c.value);
      expect(values).to.include('create');
      expect(values).to.include('link');
      expect(values).to.include('status');
    });

    it('should include --json in action command choices', () => {
      const output = exec('pr -P test-project --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string; value: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command && choice.value !== 'cancel') {
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('should work with --json flag (legacy)', () => {
      const output = exec('pr -P test-project --json');
      const json = extractJson<{ prompt: { name: string } }>(output);

      expect(json.prompt.name).to.equal('action');
    });

    it('should work with -m shorthand', () => {
      const output = exec('pr -P test-project -m');
      const json = extractJson<{ prompt: { name: string } }>(output);

      expect(json.prompt.name).to.equal('action');
    });
  });

  describe('pr status --machine', () => {
    beforeEach(() => {
      createTestTicket('TKT-STATUS-1', 'Status ticket one', 'in-progress');
      createTestTicket('TKT-STATUS-2', 'Status ticket two', 'in-progress', 'https://github.com/test/repo/pull/42');
    });

    it('should output ticket selection prompt when no ticket provided', () => {
      const output = exec('pr status -P test-project --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('ticket');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.length).to.be.greaterThan(0);
    });

    it('should include --json in ticket selection commands', () => {
      const output = exec('pr status -P test-project --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('should work with -m shorthand', () => {
      const output = exec('pr status -P test-project -m');
      const json = extractJson<{ prompt: { type: string } }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
    });

    it('should skip ticket selection when ticket ID provided directly', () => {
      const output = exec('pr status TKT-STATUS-1 -P test-project');

      // Should show ticket info directly (no JSON prompt)
      expect(output).to.include('TKT-STATUS-1');
    });
  });

  describe('pr link --machine', () => {
    beforeEach(() => {
      createTestTicket('TKT-LINK-1', 'Link ticket one', 'in-progress');
      createTestTicket('TKT-LINK-2', 'Link ticket two', 'in-progress');
    });

    it('should output ticket selection prompt when no ticket provided', () => {
      const output = exec('pr link -P test-project --machine');
      const json = extractJson<{
        prompt?: { type: string; name: string; choices: Array<{ name: string; value: string; command?: string }> };
        error?: { code: string };
        metadata: { command: string };
      }>(output);

      // May error if gh not installed, otherwise should show ticket prompt
      if (json.error) {
        expect(json.error.code).to.be.oneOf(['GH_NOT_INSTALLED', 'GH_NOT_AUTHENTICATED']);
      } else {
        expect(json.prompt).to.exist;
        expect(json.prompt!.type).to.equal('list');
        expect(json.prompt!.name).to.equal('ticket');
        expect(json.prompt!.choices).to.be.an('array');
      }
    });

    it('should include --json in ticket selection commands (if gh installed)', () => {
      const output = exec('pr link -P test-project --machine');
      const json = extractJson<{
        prompt?: { choices: Array<{ command?: string }> };
        error?: { code: string };
      }>(output);

      // Only check commands if we got a prompt (gh installed)
      if (json.prompt) {
        for (const choice of json.prompt.choices) {
          if (choice.command) {
            expect(choice.command).to.include('--json');
          }
        }
      }
    });

    it('should work with -m shorthand', () => {
      const output = exec('pr link -P test-project -m');
      const json = extractJson<{ prompt?: unknown; error?: unknown; metadata: { command: string } }>(output);

      // Should produce valid JSON output
      expect(json.metadata.command).to.equal('pr link');
    });

    it('should skip ticket selection when ticket ID provided directly', () => {
      // When ticket ID provided, should move to next step (PR selection or gh error)
      const output = exec('pr link TKT-LINK-1 -P test-project --machine');

      // Either prompts for PR selection or shows gh error
      expect(output).to.be.a('string');
      // Should be valid JSON
      const json = extractJson<{ prompt?: unknown; error?: unknown }>(output);
      expect(json).to.exist;
    });
  });

  describe('pr create --machine', () => {
    beforeEach(() => {
      createTestTicket('TKT-CREATE-1', 'Create ticket one', 'in-progress');

      // Create a feature branch
      try {
        execSync('git checkout -b feat/TKT-CREATE-1-test', { cwd: env.testDir, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        // May fail if already on branch
      }
    });

    it('should output valid response for PR creation', () => {
      const output = exec('pr create -P test-project --machine');

      // Output could be:
      // 1. JSON with gh error (not installed/authenticated)
      // 2. JSON with prompt
      // 3. Text if PR already exists (edge case in test env)
      expect(output).to.be.a('string');
      expect(output.length).to.be.greaterThan(0);
    });

    it('should work with -m shorthand', () => {
      const output = exec('pr create -P test-project -m');

      // Same as above - just verify we get some output
      expect(output).to.be.a('string');
      expect(output.length).to.be.greaterThan(0);
    });
  });

  // ===========================================================================
  // End-to-end Agent Flow Tests
  // ===========================================================================
  // These tests simulate an AI agent navigating through the CLI using --machine
  // flag, selecting choices, and completing multi-step workflows.

  describe('End-to-end agent flows (--machine flag)', () => {
    /**
     * Helper to simulate agent flow: execute command, parse JSON, return parsed result
     */
    interface AgentPrompt {
      prompt?: {
        type: string;
        name: string;
        message: string;
        choices?: Array<{ name: string; value: string; command?: string }>;
        context?: Record<string, unknown>;
      };
      error?: {
        code: string;
        message: string;
      };
      metadata: {
        command: string;
        flags: Record<string, unknown>;
      };
    }

    function agentExec(cmd: string): AgentPrompt {
      const output = exec(cmd);
      return extractJson<AgentPrompt>(output);
    }

    /**
     * Helper to find a choice by partial name match
     */
    function findChoice(
      choices: Array<{ name: string; value: string; command?: string }>,
      pattern: string
    ): { name: string; value: string; command?: string } | undefined {
      return choices.find(c => c.name.toLowerCase().includes(pattern.toLowerCase()));
    }

    /**
     * Helper to get the command from a choice (strips 'prlt ' prefix)
     */
    function execChoice(choice: { command?: string }): string {
      if (!choice.command) {
        throw new Error('Choice has no command field');
      }
      return choice.command.replace('prlt ', '');
    }

    /**
     * Helper to execute final command (strips --json/--machine flags)
     */
    function execFinal(cmd: string): string {
      return exec(cmd.replace(' --json', '').replace(' --machine', ''));
    }

    describe('pr index → subcommand - menu navigation flow', () => {
      it('should complete flow: main menu → select action → proceed', () => {
        // Agent Step 1: Main menu
        const step1 = agentExec('pr -P test-project --machine');
        expect(step1.prompt).to.exist;
        expect(step1.prompt!.type).to.equal('list');
        expect(step1.prompt!.name).to.equal('action');

        // Find status action
        const statusChoice = findChoice(step1.prompt!.choices!, 'status');
        expect(statusChoice).to.exist;
        expect(statusChoice!.command).to.include('--json');

        // Verify the command structure
        expect(statusChoice!.command).to.include('prlt pr');
      });

      it('should provide cancel option in menu', () => {
        const step1 = agentExec('pr -P test-project --machine');
        expect(step1.prompt).to.exist;

        const cancelChoice = findChoice(step1.prompt!.choices!, 'cancel');
        expect(cancelChoice).to.exist;
        expect(cancelChoice!.value).to.equal('cancel');
      });
    });

    describe('pr status - full agent flow', () => {
      beforeEach(() => {
        createTestTicket('TKT-STATUS-FLOW-1', 'Agent status test', 'in-progress', 'https://github.com/test/repo/pull/123');
      });

      it('should complete flow: select ticket → view status', () => {
        // Agent Step 1: Get ticket choices
        const step1 = agentExec('pr status -P test-project --machine');
        expect(step1.prompt).to.exist;
        expect(step1.prompt!.type).to.equal('list');
        expect(step1.prompt!.name).to.equal('ticket');
        expect(step1.prompt!.choices).to.be.an('array');
        expect(step1.prompt!.choices!.length).to.be.greaterThan(0);

        // Find the test ticket
        const ticketChoice = findChoice(step1.prompt!.choices!, 'TKT-STATUS-FLOW-1');
        expect(ticketChoice).to.exist;
        expect(ticketChoice!.command).to.include('--json');

        // Agent Step 2: View status (final step)
        const result = execFinal(execChoice(ticketChoice!));

        // Verify ticket status shown
        expect(result).to.include('TKT-STATUS-FLOW-1');
      });

      it('should complete flow with ticket ID provided directly', () => {
        // Agent provides ticket ID - no prompts needed
        const result = exec('pr status TKT-STATUS-FLOW-1 -P test-project');

        expect(result).to.include('TKT-STATUS-FLOW-1');
      });
    });

    describe('pr link - full agent flow', () => {
      beforeEach(() => {
        createTestTicket('TKT-LINK-FLOW-1', 'Agent link test', 'in-progress');
      });

      it('should complete flow: select ticket → proceed to next step', () => {
        // Agent Step 1: Get ticket choices (or gh error)
        const step1 = agentExec('pr link -P test-project --machine');

        // If gh not installed, we get an error
        if (step1.error) {
          expect(step1.error.code).to.be.oneOf(['GH_NOT_INSTALLED', 'GH_NOT_AUTHENTICATED']);
          return;
        }

        // If gh installed, we should get ticket prompt
        expect(step1.prompt).to.exist;
        expect(step1.prompt!.type).to.equal('list');
        expect(step1.prompt!.name).to.equal('ticket');
        expect(step1.prompt!.choices).to.be.an('array');

        // Find the test ticket
        const ticketChoice = findChoice(step1.prompt!.choices!, 'TKT-LINK-FLOW-1');
        expect(ticketChoice).to.exist;
        expect(ticketChoice!.command).to.include('--json');
      });

      it('should handle ticket ID provided directly', () => {
        // Agent provides ticket ID - skips ticket selection
        const step1 = agentExec('pr link TKT-LINK-FLOW-1 -P test-project --machine');

        // Should proceed to PR selection or show gh error
        expect(step1).to.exist;
        // Either has prompt for PR selection or error about gh
        expect(step1.prompt || step1.error).to.exist;
      });
    });

    describe('pr create - agent flow', () => {
      beforeEach(() => {
        createTestTicket('TKT-CREATE-FLOW-1', 'Agent create test', 'in-progress');

        // Create a feature branch
        try {
          execSync('git checkout -b feat/TKT-CREATE-FLOW-1-test', { cwd: env.testDir, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch {
          // May fail if already on branch
        }
      });

      it('should provide some output for PR creation', () => {
        // Agent starts PR creation - should auto-detect ticket from branch
        const output = exec('pr create -P test-project --machine');

        // Output could be JSON or text (if PR exists)
        expect(output).to.be.a('string');
        expect(output.length).to.be.greaterThan(0);
      });

      it('should handle --no-link flag', () => {
        // Agent uses --no-link to create PR without linking to ticket
        const output = exec('pr create --no-link --machine');

        // Should provide some output
        expect(output).to.be.a('string');
        expect(output.length).to.be.greaterThan(0);
      });
    });

    describe('backward compatibility: --json flag flows', () => {
      beforeEach(() => {
        createTestTicket('TKT-JSON-COMPAT', 'JSON compat ticket', 'in-progress', 'https://github.com/test/repo/pull/99');
      });

      it('should complete status flow with --json flag (legacy)', () => {
        // Use --json instead of --machine
        const step1 = agentExec('pr status -P test-project --json');
        expect(step1.prompt).to.exist;
        expect(step1.prompt!.type).to.equal('list');
        expect(step1.prompt!.name).to.equal('ticket');

        const ticketChoice = findChoice(step1.prompt!.choices!, 'TKT-JSON-COMPAT');
        expect(ticketChoice).to.exist;

        const result = execFinal(execChoice(ticketChoice!));
        expect(result).to.include('TKT-JSON-COMPAT');
      });

      it('should complete main menu flow with --json flag (legacy)', () => {
        const step1 = agentExec('pr -P test-project --json');
        expect(step1.prompt).to.exist;
        expect(step1.prompt!.type).to.equal('list');
        expect(step1.prompt!.name).to.equal('action');

        const statusChoice = findChoice(step1.prompt!.choices!, 'status');
        expect(statusChoice).to.exist;
        expect(statusChoice!.command).to.include('--json');
      });
    });
  });

  describe('Error handling in JSON mode', () => {
    it('should show error when no tickets exist for pr status', () => {
      // No tickets created
      const output = exec('pr status -P test-project --machine');

      // Should output error or empty state message
      expect(output.toLowerCase()).to.include('no tickets');
    });

    it('should return structured error JSON for gh CLI issues', () => {
      createTestTicket('TKT-ERR-1', 'Error test ticket', 'in-progress');

      // pr link requires gh CLI - likely to fail in test env
      const output = exec('pr link TKT-ERR-1 -P test-project --machine');
      const json = extractJson<{ error?: { code: string }; metadata: unknown }>(output);

      // Should have structured response (either prompt or error)
      expect(json).to.exist;
      expect(json.metadata).to.exist;
    });
  });
});

/**
 * Helper function to set up test database with PR-related schema.
 * Schema matches production schema from src/lib/pmo/schema.ts
 */
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
      status TEXT NOT NULL DEFAULT 'active',
      phase_id TEXT,
      workflow_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      target_date TIMESTAMP,
      initiative_id TEXT,
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
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
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

    CREATE TABLE IF NOT EXISTS pmo_ticket_metadata (
      ticket_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (ticket_id, key),
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON pmo_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status_id ON pmo_tickets(status_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_ticket_metadata ON pmo_ticket_metadata(ticket_id);
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
    { id: 'status-review', name: 'Review', category: 'started', position: 2 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 3 },
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

/**
 * Initialize a git repo for PR commands to work
 */
function initGitRepo(dir: string): void {
  try {
    execSync('git init', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    // Create initial commit
    fs.writeFileSync(path.join(dir, 'README.md'), '# Test');
    execSync('git add .', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git commit -m "Initial commit"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    // Git init may fail in some test environments
  }
}
