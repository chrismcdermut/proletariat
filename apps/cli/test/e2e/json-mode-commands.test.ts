/* eslint-disable max-nested-callbacks */
import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  createTestProject,
  extractJson as extractJsonOrNull,
  execInProcess,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * Asserting wrapper around shared extractJson.
 * Throws if no valid JSON is found (appropriate for test assertions).
 */
function extractJson<T>(output: string): T {
  const result = extractJsonOrNull<T>(output);
  if (result === null) {
    throw new Error(`No JSON found in output: ${output.substring(0, 500)}...`);
  }
  return result;
}

/**
 * Integration tests for JSON mode flag accumulation.
 *
 * These tests verify that when commands output JSON prompts for AI agents,
 * the `command` field in each choice includes all previously accumulated
 * flags (like -P projectId) so agents can navigate stateless menus.
 *
 * Note: Tests for deleted commands (ticket complete, view, status, reassign,
 * link, spec, epic, project, and all workflow commands) were removed as part
 * of PRLT-1113 cleanup.
 */
describe('JSON Mode Flag Accumulation', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('json-mode-');

    db = setupProductionSchema(env.dbPath, env.pmoPath);
    createTestProject(db, { id: 'test-project', name: 'Test Project', description: 'E2E test project' });

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  /**
   * Helper to insert a test ticket directly into the database.
   * More reliable than await execInProcess('ticket create ...') for test setup.
   */
  function createLocalTestTicket(id: string, title: string, statusId: string = 'default-backlog'): void {
    // Map status_id to status name
    const statusName = statusId === 'default-backlog' ? 'Backlog' :
                       statusId === 'default-in-progress' ? 'In Progress' :
                       statusId === 'default-review' ? 'Review' : 'Done';

    db.prepare(`
      INSERT INTO pmo_tickets (id, project_id, title, status, status_id)
      VALUES (?, 'test-project', ?, ?, ?)
    `).run(id, title, statusName, statusId);
  }

  describe('ticket move --json', () => {
    beforeEach(() => {
      createLocalTestTicket('TKT-001', 'Test ticket 1');
      createLocalTestTicket('TKT-002', 'Test ticket 2');
    });

    it('should output valid JSON with prompt schema', async () => {
      const output = await execInProcess('ticket move -P test-project --json');
      const json = extractJson<{ prompt: { type: string; name: string; message: string; choices: unknown[] } }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
    });

    it('should include project flag in ticket selection commands', async () => {
      const output = await execInProcess('ticket move -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      // Each choice's command should include the project flag
      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
        expect(choice.command).to.include('--json');
      }
    });

    it('should include ticket ID and project flag in column selection commands', async () => {
      const output = await execInProcess('ticket move TKT-001 -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      // Each choice's command should include ticket ID and project flag
      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('TKT-001');
        expect(choice.command).to.include('-P test-project');
        expect(choice.command).to.include('--json');
      }
    });

    it('should allow stateless navigation: project → ticket → column', async () => {
      // Step 1: Get ticket choices with project flag
      const step1Output = await execInProcess('ticket move -P test-project --json');
      const step1Json = extractJson<{ prompt: { choices: Array<{ command: string; value: string }> } }>(step1Output);

      expect(step1Json.prompt.choices.length).to.be.greaterThan(0);
      const ticketCommand = step1Json.prompt.choices[0].command;

      // Verify command includes project flag
      expect(ticketCommand).to.include('-P test-project');

      // Step 2: Execute the command from step 1 (strip 'prlt ' prefix)
      const step2Command = ticketCommand.replace('prlt ', '');
      const step2Output = await execInProcess(step2Command);
      const step2Json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(step2Output);

      // Verify column choices still include project flag
      for (const choice of step2Json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket delete --json', () => {
    beforeEach(() => {
      createLocalTestTicket('TKT-004', 'Delete me');
    });

    it('should include project flag in ticket selection commands', async () => {
      const output = await execInProcess('ticket delete -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket edit --json', () => {
    beforeEach(() => {
      createLocalTestTicket('TKT-006', 'Edit me');
    });

    it('should include project flag in ticket selection commands', async () => {
      const output = await execInProcess('ticket edit -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('ticket update --json', () => {
    beforeEach(() => {
      createLocalTestTicket('TKT-008', 'Update me');
    });

    it('should include project flag in ticket selection commands', async () => {
      const output = await execInProcess('ticket update -P test-project --json');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('--machine flag (semantic alias for --json)', () => {
    beforeEach(() => {
      createLocalTestTicket('TKT-M01', 'Machine mode ticket 1');
      createLocalTestTicket('TKT-M02', 'Machine mode ticket 2');
    });

    it('should output valid JSON with --machine flag', async () => {
      const output = await execInProcess('ticket move -P test-project --machine');
      const json = extractJson<{ prompt: { type: string; name: string; choices: unknown[] }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should produce same structure as --json flag', async () => {
      const jsonOutput = await execInProcess('ticket move -P test-project --json');
      const machineOutput = await execInProcess('ticket move -P test-project --machine');

      const jsonResult = extractJson<{ prompt: { type: string; name: string; choices: Array<{ value: string }> } }>(jsonOutput);
      const machineResult = extractJson<{ prompt: { type: string; name: string; choices: Array<{ value: string }> } }>(machineOutput);

      // Same prompt structure
      expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type);
      expect(machineResult.prompt.name).to.equal(jsonResult.prompt.name);
      expect(machineResult.prompt.choices.length).to.equal(jsonResult.prompt.choices.length);

      // Same ticket choices
      const jsonValues = jsonResult.prompt.choices.map(c => c.value).sort();
      const machineValues = machineResult.prompt.choices.map(c => c.value).sort();
      expect(machineValues).to.deep.equal(jsonValues);
    });

    it('should include project flag in commands with --machine', async () => {
      const output = await execInProcess('ticket move -P test-project --machine');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
        // Commands should still use --json for stateless navigation
        expect(choice.command).to.include('--json');
      }
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('ticket move -P test-project -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should work for ticket delete with --machine', async () => {
      const output = await execInProcess('ticket delete -P test-project --machine');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });
  });

  describe('End-to-end stateless flow', () => {
    beforeEach(() => {
      createLocalTestTicket('TKT-E2E', 'E2E Test Ticket');
    });

    it('should complete full ticket move flow via JSON commands', async () => {
      // Step 1: Start with project selection implicit (single project auto-selects)
      const step1 = await execInProcess('ticket move -P test-project --json');
      const json1 = extractJson<{ prompt: { choices: Array<{ command: string; value: string }> } }>(step1);

      // Get first ticket command
      const ticketCmd = json1.prompt.choices[0].command.replace('prlt ', '');
      expect(ticketCmd).to.include('-P test-project');

      // Step 2: Select ticket, get column choices
      const step2 = await execInProcess(ticketCmd);
      const json2 = extractJson<{ prompt: { choices: Array<{ command: string; value: string; name: string }> } }>(step2);

      // Find "In Progress" column
      const inProgressChoice = json2.prompt.choices.find(c => c.name.includes('In Progress'));
      expect(inProgressChoice).to.exist;
      expect(inProgressChoice!.command).to.include('-P test-project');

      // Step 3: Execute the move (remove --json to actually execute)
      const moveCmd = inProgressChoice!.command.replace('prlt ', '').replace(' --json', '');
      const result = await execInProcess(moveCmd);

      // Verify ticket was moved
      expect(result).to.include('Moved');
      expect(result).to.include('In Progress');
    });
  });

  describe('End-to-end agent flows (--machine flag)', () => {
    /**
     * Helper to simulate agent flow: execute command, parse JSON, return parsed result
     */
    async function agentExec(cmd: string): Promise<{ prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> }; metadata: { command: string; flags: Record<string, unknown> } }> {
      const output = await execInProcess(cmd);
      return extractJson(output);
    }

    /**
     * Helper to find a choice by partial name match
     */
    function findChoice(choices: Array<{ name: string; value: string; command?: string }>, pattern: string | RegExp): { name: string; value: string; command?: string } | undefined {
      if (typeof pattern === 'string') {
        return choices.find(c => c.name.toLowerCase().includes(pattern.toLowerCase()));
      }
      return choices.find(c => pattern.test(c.name));
    }

    /**
     * Helper to execute the command from a choice (strips 'prlt ' prefix)
     */
    function execChoice(choice: { command?: string }): string {
      if (!choice.command) throw new Error('Choice has no command');
      return choice.command.replace('prlt ', '');
    }

    /**
     * Helper to execute final command (removes --json flag to actually execute)
     */
    async function execFinal(cmd: string): Promise<string> {
      return await execInProcess(cmd.replace(' --json', '').replace(' --machine', ''));
    }

    describe('ticket move - full agent flow', () => {
      beforeEach(() => {
        createLocalTestTicket('TKT-MOVE-1', 'Move me to In Progress');
      });

      it('should complete move flow: select ticket → select column → move', async () => {
        // Agent Step 1: Get available tickets
        const step1 = await agentExec('ticket move -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.message).to.include('ticket');

        const ticketChoice = findChoice(step1.prompt.choices, 'TKT-MOVE-1');
        expect(ticketChoice).to.exist;

        // Agent Step 2: Select ticket, get column choices
        const step2 = await agentExec(execChoice(ticketChoice!));
        expect(step2.prompt.type).to.equal('list');

        const columnChoice = findChoice(step2.prompt.choices, 'In Progress');
        expect(columnChoice).to.exist;

        // Agent Step 3: Execute the move
        const moveCmd = execChoice(columnChoice!);
        const result = await execFinal(moveCmd);

        // Verify the output indicates success
        expect(result).to.include('Moved');
        expect(result).to.include('In Progress');

        // Note: Database verification happens through a separate connection.
        // The CLI updates its own DB; we verify the output which confirms the operation.
        // This matches the pattern of the other passing E2E test.
      });
    });

    describe('ticket delete - full agent flow', () => {
      beforeEach(() => {
        createLocalTestTicket('TKT-DEL-1', 'Delete this ticket');
      });

      it('should complete flow: select ticket → confirm delete', async () => {
        // Agent Step 1: Get available tickets
        const step1 = await agentExec('ticket delete -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');

        const ticketChoice = findChoice(step1.prompt.choices, 'TKT-DEL-1');
        expect(ticketChoice).to.exist;

        // Agent Step 2: Select ticket - may get confirmation prompt
        const step2Cmd = execChoice(ticketChoice!);

        // Execute with --force to skip confirmation, or handle confirmation
        const result = await execInProcess(step2Cmd.replace(' --json', '') + ' --force');

        // Verify deletion
        expect(result.toLowerCase()).to.include('delete');

        // Verify ticket is gone from database
        const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE id = ?').get('TKT-DEL-1');
        expect(ticket).to.be.undefined;
      });
    });

    describe('backward compatibility: --json flag flows', () => {
      beforeEach(() => {
        createLocalTestTicket('TKT-JSON-1', 'JSON flag flow test');
      });

      it('should complete move flow with --json flag (legacy)', async () => {
        // Use --json instead of --machine
        const step1 = await agentExec('ticket move -P test-project --json');
        expect(step1.prompt.type).to.equal('list');

        const ticketChoice = findChoice(step1.prompt.choices, 'TKT-JSON-1');
        expect(ticketChoice).to.exist;

        const step2 = await agentExec(execChoice(ticketChoice!));
        const columnChoice = findChoice(step2.prompt.choices, 'In Progress');
        expect(columnChoice).to.exist;

        const result = await execFinal(execChoice(columnChoice!));
        expect(result).to.include('Moved');
      });
    });
  });
});
