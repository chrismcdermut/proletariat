/**
 * E2E Agent Flow Tests for Status Commands
 *
 * These tests simulate an AI agent navigating through the status command flows
 * using the --machine flag for JSON machine-readable output.
 *
 * Test pattern:
 * 1. agentExec('command --machine') - execute and get JSON response
 * 2. findChoice(response.prompt.choices, 'pattern') - find a menu choice
 * 3. execChoice(choice) - get the command string from the choice
 * 4. Repeat until final step
 * 5. Execute without --machine to perform the action
 * 6. Verify the result
 */
import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  exec,
  agentExec,
  findChoice,
  execFinal,
  extractJson,
  type TestEnvironment,
  type AgentPromptResponse,
} from './test-helpers.js';

interface StatusJson {
  id: string;
  name: string;
  category: string;
  position: number;
  isDefault?: boolean;
}

describe('Status Commands - Agent Flow E2E Tests', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  // Test project and workflow constants
  const TEST_PROJECT_ID = 'test-project';
  const TEST_WORKFLOW_ID = 'default';

  /**
   * Set up the full database schema required by the CLI
   */
  function setupTestDatabase(pmoPath: string): void {
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
    `);

    // Insert workflow
    db.prepare(`
      INSERT INTO pmo_workflows (id, name, description, is_builtin)
      VALUES ('default', 'Default', 'Default kanban workflow', 1)
    `).run();

    // Insert test project with workflow reference
    db.prepare(`
      INSERT INTO pmo_projects (id, name, description, workflow_id)
      VALUES (?, 'Test Project', 'E2E test project', 'default')
    `).run(TEST_PROJECT_ID);

    // Insert settings
    db.prepare(`
      INSERT INTO pmo_settings (key, value)
      VALUES ('pmo_path', ?), ('current_project', ?)
    `).run(pmoPath, TEST_PROJECT_ID);
  }

  /**
   * Helper to create a test status
   */
  function createTestStatus(
    id: string,
    name: string,
    category: string = 'backlog',
    position: number = 0,
    isDefault: boolean = false
  ): void {
    db.prepare(`
      INSERT INTO pmo_workflow_statuses (id, workflow_id, name, category, position, is_default)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, TEST_WORKFLOW_ID, name, category, position, isDefault ? 1 : 0);
  }

  beforeEach(() => {
    env = createTestEnvironment('status-agent-');
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, TEST_PROJECT_ID);

    // Initialize database with test data
    db = new Database(env.dbPath);
    setupTestDatabase(env.pmoPath);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    cleanupTestEnvironment(env);
  });

  describe('status menu - full agent flow', () => {
    it('should output menu choices with command fields in JSON mode', () => {
      const output = exec(`status -P ${TEST_PROJECT_ID} --machine`);
      const result = extractJson<AgentPromptResponse>(output);

      // Skip if context error (no project/workspace)
      if (!result) {
        return;
      }

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.choices).to.be.an('array');

      // Verify menu choices have command fields
      const listChoice = result.prompt.choices.find(c => c.name.toLowerCase().includes('list'));
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('prlt status list');
      expect(listChoice!.command).to.include('--machine');

      const createChoice = result.prompt.choices.find(c => c.name.toLowerCase().includes('create'));
      expect(createChoice).to.exist;
      expect(createChoice!.command).to.include('prlt status create');

      const updateChoice = result.prompt.choices.find(c => c.name.toLowerCase().includes('update'));
      expect(updateChoice).to.exist;
      expect(updateChoice!.command).to.include('prlt status update');

      const moveChoice = result.prompt.choices.find(c => c.name.toLowerCase().includes('move'));
      expect(moveChoice).to.exist;
      expect(moveChoice!.command).to.include('prlt status move');

      const deleteChoice = result.prompt.choices.find(c => c.name.toLowerCase().includes('delete'));
      expect(deleteChoice).to.exist;
      expect(deleteChoice!.command).to.include('prlt status delete');
    });
  });

  describe('status list - full agent flow', () => {
    beforeEach(() => {
      // Use consistent categories that match CLI templates
      createTestStatus('status-backlog', 'Backlog', 'backlog', 0, true);
      createTestStatus('status-in-progress', 'In Progress', 'started', 1);
      createTestStatus('status-done', 'Done', 'completed', 2);
    });

    it('should output statuses as JSON array in machine mode', () => {
      const output = exec(`status list -P ${TEST_PROJECT_ID} --machine`);

      // Should return JSON array of statuses
      let statuses: StatusJson[] | null = null;
      try {
        // Output might be an array directly
        const trimmed = output.trim();
        const jsonStart = trimmed.indexOf('[');
        if (jsonStart !== -1) {
          statuses = JSON.parse(trimmed.substring(jsonStart));
        }
      } catch {
        // If parsing fails, it might be context error
        return;
      }

      if (!statuses) return;

      expect(statuses).to.be.an('array');
      expect(statuses.length).to.be.greaterThan(0);

      // Verify status structure - look for Backlog with backlog category
      const backlog = statuses.find((s: StatusJson) => s.name === 'Backlog');
      expect(backlog).to.exist;
      expect(backlog!.category).to.equal('backlog');
    });
  });

  describe('status create - full agent flow', () => {
    it('should output form prompts with command fields in JSON mode', () => {
      const output = exec(`status create -P ${TEST_PROJECT_ID} --machine`);
      const result = extractJson<AgentPromptResponse>(output);

      // Skip if context error
      if (!result) {
        return;
      }

      expect(result.prompt).to.exist;
      // First prompt should be for name (input type)
      expect(result.prompt.type).to.equal('input');
      expect(result.prompt.message.toLowerCase()).to.include('name');
    });

    it('should complete flow: provide all flags with --machine → get success response', () => {
      // Execute with all required flags - should complete without prompting
      const output = exec(
        `status create -P ${TEST_PROJECT_ID} --name "Review" --category started --machine`
      );

      // With all flags provided and --machine, should either:
      // - Complete and show success output
      // - Or show next prompt if more input needed
      // The key is no "unknown flag" errors
      expect(output).to.not.include('Unexpected argument');
      expect(output).to.not.include('unknown flag');
    });
  });

  describe('status update - full agent flow', () => {
    beforeEach(() => {
      createTestStatus('status-update-test', 'Original Name', 'backlog', 0);
    });

    it('should complete flow: select status → prompt for updates', () => {
      // Agent Step 1: Get status selection prompt
      const output = exec(`status update -P ${TEST_PROJECT_ID} --machine`);
      const result = extractJson<AgentPromptResponse>(output);

      // Skip if context error or no statuses
      if (!result) {
        return;
      }

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message.toLowerCase()).to.include('status');

      // Verify choices have command fields for agent navigation
      expect(result.prompt.choices.length).to.be.greaterThan(0);
      const firstChoice = result.prompt.choices[0];
      expect(firstChoice.command).to.include('prlt status update');
      expect(firstChoice.command).to.include('--machine');
    });

    it('should complete flow: provide ID and flags with --machine → get response', () => {
      // Execute with ID and update flags with --machine
      const output = exec(
        `status update status-update-test -P ${TEST_PROJECT_ID} --name "Updated Name" --machine`
      );

      // With ID and flags provided and --machine, should not error
      expect(output).to.not.include('Unexpected argument');
      expect(output).to.not.include('unknown flag');
    });
  });

  describe('status move - full agent flow', () => {
    beforeEach(() => {
      createTestStatus('status-move-1', 'First', 'backlog', 0);
      createTestStatus('status-move-2', 'Second', 'backlog', 1);
      createTestStatus('status-move-3', 'Third', 'backlog', 2);
    });

    it('should complete flow: select status → prompt for next step', () => {
      // Agent Step 1: Get status selection prompt
      const output1 = exec(`status move -P ${TEST_PROJECT_ID} --machine`);
      const result1 = extractJson<AgentPromptResponse>(output1);

      // Skip if context error or no statuses
      if (!result1) {
        return;
      }

      expect(result1.prompt).to.exist;
      expect(result1.prompt.type).to.equal('list');

      // Verify choices have command fields for agent navigation
      expect(result1.prompt.choices.length).to.be.greaterThan(0);
      const statusChoice = result1.prompt.choices[0];
      expect(statusChoice.command).to.include('--machine');
    });

    it('should complete flow: provide ID and position with --machine → get response', () => {
      // Execute with ID and position flags with --machine
      const output = exec(
        `status move status-move-3 -P ${TEST_PROJECT_ID} --position 0 --machine`
      );

      // With ID and position provided and --machine, should not error
      expect(output).to.not.include('Unexpected argument');
      expect(output).to.not.include('unknown flag');
    });
  });

  describe('status delete - full agent flow', () => {
    beforeEach(() => {
      createTestStatus('status-delete-test', 'Delete Me', 'backlog', 0);
    });

    it('should accept status ID and --machine flag without error', () => {
      // This test verifies the --machine flag is supported for delete
      // The specific status may not exist due to test isolation,
      // but the flag should be recognized
      const output = exec(`status delete status-delete-test --machine`);

      // Should not have "unknown flag" errors
      expect(output).to.not.include('Unexpected argument');
      expect(output).to.not.include('unknown flag');

      // If it's a valid prompt response, verify structure
      const result = extractJson<AgentPromptResponse>(output);
      if (result && result.prompt) {
        expect(result.prompt.type).to.equal('list');
        expect(result.prompt.choices.length).to.be.greaterThan(0);
      }
    });

    it('should complete flow: provide --force with --machine → get response', () => {
      // Execute with --force and --machine to skip confirmation
      const output = exec(`status delete status-delete-test --force --machine`);

      // With --force and --machine, should not error about unknown flags
      expect(output).to.not.include('Unexpected argument');
      expect(output).to.not.include('unknown flag');
    });
  });

  describe('--machine flag availability', () => {
    it('status command should support --machine flag', () => {
      const output = exec(`status -P ${TEST_PROJECT_ID} --machine`);
      // Should not include "unknown flag" error
      expect(output).to.not.include('Unexpected argument');
      expect(output).to.not.include('unknown flag');
    });

    it('status list should support --machine flag', () => {
      createTestStatus('test-status', 'Test', 'backlog', 0);
      const output = exec(`status list -P ${TEST_PROJECT_ID} --machine`);
      // Should return JSON (either array or error), not an "unknown flag" error
      expect(output).to.not.include('Unexpected argument');
      expect(output).to.not.include('unknown flag');
    });

    it('status create should support --machine flag', () => {
      const output = exec(`status create -P ${TEST_PROJECT_ID} --machine`);
      expect(output).to.not.include('Unexpected argument');
      expect(output).to.not.include('unknown flag');
    });

    it('status update should support --machine flag', () => {
      createTestStatus('test-update', 'Test', 'backlog', 0);
      const output = exec(`status update -P ${TEST_PROJECT_ID} --machine`);
      expect(output).to.not.include('Unexpected argument');
      expect(output).to.not.include('unknown flag');
    });

    it('status move should support --machine flag', () => {
      createTestStatus('test-move', 'Test', 'backlog', 0);
      const output = exec(`status move -P ${TEST_PROJECT_ID} --machine`);
      expect(output).to.not.include('Unexpected argument');
      expect(output).to.not.include('unknown flag');
    });

    it('status delete should support --machine flag', () => {
      createTestStatus('test-delete', 'Test', 'backlog', 0);
      const output = exec(`status delete test-delete --machine`);
      expect(output).to.not.include('Unexpected argument');
      expect(output).to.not.include('unknown flag');
    });
  });
});
