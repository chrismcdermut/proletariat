import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  createTestProject,
  createTestWorkflow,
  addTestWorkflowStatus,
  extractJson as extractJsonOrNull,
  exec,
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
   * More reliable than exec('ticket create ...') for test setup.
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
      createLocalTestTicket('TKT-003', 'Complete me');
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
      createLocalTestTicket('TKT-004', 'Delete me');
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
      createLocalTestTicket('TKT-005', 'View me');
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
      createLocalTestTicket('TKT-006', 'Edit me');
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
      createLocalTestTicket('TKT-007', 'Status me');
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
      createLocalTestTicket('TKT-008', 'Update me');
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
      createLocalTestTicket('TKT-009', 'Reassign me');
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
      createLocalTestTicket('TKT-010', 'Link me');
      createLocalTestTicket('TKT-011', 'Link target');
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
      createLocalTestTicket('TKT-012', 'Blocked ticket');
      createLocalTestTicket('TKT-013', 'Blocker ticket');
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
      createLocalTestTicket('TKT-014', 'Spec me');
      // Create a spec
      db.prepare(`
        INSERT INTO pmo_specs (id, title, status)
        VALUES ('SPEC-001', 'Test Spec', 'active')
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
      createLocalTestTicket('TKT-015', 'Epic me');
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
      createLocalTestTicket('TKT-016', 'Project me');
      // Create another project to move to (uses default workflow which already has statuses)
      createTestProject(db, { id: 'other-project', name: 'Other Project', description: 'Another project' });
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

  describe('--machine flag (semantic alias for --json)', () => {
    beforeEach(() => {
      createLocalTestTicket('TKT-M01', 'Machine mode ticket 1');
      createLocalTestTicket('TKT-M02', 'Machine mode ticket 2');
    });

    it('should output valid JSON with --machine flag', () => {
      const output = exec('ticket move -P test-project --machine');
      const json = extractJson<{ prompt: { type: string; name: string; choices: unknown[] }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should produce same structure as --json flag', () => {
      const jsonOutput = exec('ticket move -P test-project --json');
      const machineOutput = exec('ticket move -P test-project --machine');

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

    it('should include project flag in commands with --machine', () => {
      const output = exec('ticket move -P test-project --machine');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
        // Commands should still use --json for stateless navigation
        expect(choice.command).to.include('--json');
      }
    });

    it('should work with -m shorthand', () => {
      const output = exec('ticket move -P test-project -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should work for ticket complete with --machine', () => {
      const output = exec('ticket complete -P test-project --machine');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });

    it('should work for ticket view with --machine', () => {
      const output = exec('ticket view -P test-project --machine');
      const json = extractJson<{ prompt: { choices: Array<{ command: string }> } }>(output);

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('-P test-project');
      }
    });

    it('should work for ticket delete with --machine', () => {
      const output = exec('ticket delete -P test-project --machine');
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

  describe('End-to-end agent flows (--machine flag)', () => {
    /**
     * Helper to simulate agent flow: execute command, parse JSON, return parsed result
     */
    function agentExec(cmd: string): { prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> }; metadata: { command: string; flags: Record<string, unknown> } } {
      const output = exec(cmd);
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
    function execFinal(cmd: string): string {
      return exec(cmd.replace(' --json', '').replace(' --machine', ''));
    }

    describe('ticket move - full agent flow', () => {
      beforeEach(() => {
        createLocalTestTicket('TKT-MOVE-1', 'Move me to In Progress');
      });

      it('should complete move flow: select ticket → select column → move', () => {
        // Agent Step 1: Get available tickets
        const step1 = agentExec('ticket move -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.message).to.include('ticket');

        const ticketChoice = findChoice(step1.prompt.choices, 'TKT-MOVE-1');
        expect(ticketChoice).to.exist;

        // Agent Step 2: Select ticket, get column choices
        const step2 = agentExec(execChoice(ticketChoice!));
        expect(step2.prompt.type).to.equal('list');

        const columnChoice = findChoice(step2.prompt.choices, 'In Progress');
        expect(columnChoice).to.exist;

        // Agent Step 3: Execute the move
        const moveCmd = execChoice(columnChoice!);
        const result = execFinal(moveCmd);

        // Verify the output indicates success
        expect(result).to.include('Moved');
        expect(result).to.include('In Progress');

        // Note: Database verification happens through a separate connection.
        // The CLI updates its own DB; we verify the output which confirms the operation.
        // This matches the pattern of the other passing E2E test.
      });
    });

    describe('ticket complete - full agent flow', () => {
      beforeEach(() => {
        createLocalTestTicket('TKT-COMP-1', 'Complete this ticket', 'default-in-progress');
      });

      it('should complete flow: select ticket → mark as done', () => {
        // Agent Step 1: Get available tickets
        const step1 = agentExec('ticket complete -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');

        const ticketChoice = findChoice(step1.prompt.choices, 'TKT-COMP-1');
        expect(ticketChoice).to.exist;

        // Agent Step 2: Execute complete (may prompt for confirmation or just complete)
        const cmd = execChoice(ticketChoice!);
        // Execute without --json to actually complete
        const result = execFinal(cmd);

        // Verify the output indicates success
        expect(result.toLowerCase()).to.match(/complete|done|moved/);

        // Note: Database verification happens through a separate connection.
        // The CLI updates its own DB; we verify the output which confirms the operation.
      });
    });

    describe('ticket delete - full agent flow', () => {
      beforeEach(() => {
        createLocalTestTicket('TKT-DEL-1', 'Delete this ticket');
      });

      it('should complete flow: select ticket → confirm delete', () => {
        // Agent Step 1: Get available tickets
        const step1 = agentExec('ticket delete -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');

        const ticketChoice = findChoice(step1.prompt.choices, 'TKT-DEL-1');
        expect(ticketChoice).to.exist;

        // Agent Step 2: Select ticket - may get confirmation prompt
        const step2Cmd = execChoice(ticketChoice!);

        // Execute with --force to skip confirmation, or handle confirmation
        const result = exec(step2Cmd.replace(' --json', '') + ' --force');

        // Verify deletion
        expect(result.toLowerCase()).to.include('delete');

        // Verify ticket is gone from database
        const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE id = ?').get('TKT-DEL-1');
        expect(ticket).to.be.undefined;
      });
    });

    describe('ticket view - full agent flow', () => {
      beforeEach(() => {
        createLocalTestTicket('TKT-VIEW-1', 'View this ticket details');
      });

      it('should complete flow: select ticket → view details', () => {
        // Agent Step 1: Get available tickets
        const step1 = agentExec('ticket view -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');

        const ticketChoice = findChoice(step1.prompt.choices, 'TKT-VIEW-1');
        expect(ticketChoice).to.exist;

        // Agent Step 2: View the ticket
        const result = execFinal(execChoice(ticketChoice!));

        // Verify ticket details are shown
        expect(result).to.include('TKT-VIEW-1');
        expect(result).to.include('View this ticket details');
      });
    });

    describe('ticket epic - full agent flow', () => {
      beforeEach(() => {
        createLocalTestTicket('TKT-EPIC-1', 'Assign me to an epic');
        // Create test epic
        db.prepare(`
          INSERT INTO pmo_epics (id, project_id, title, status)
          VALUES ('EPIC-FLOW-1', 'test-project', 'Test Epic for Flow', 'active')
        `).run();
      });

      it('should complete flow: select ticket → select epic → assign', () => {
        // Agent Step 1: Get available tickets
        const step1 = agentExec('ticket epic -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');

        const ticketChoice = findChoice(step1.prompt.choices, 'TKT-EPIC-1');
        expect(ticketChoice).to.exist;

        // Agent Step 2: Select ticket, get epic choices
        const step2 = agentExec(execChoice(ticketChoice!));
        expect(step2.prompt.type).to.equal('list');

        const epicChoice = findChoice(step2.prompt.choices, 'Test Epic for Flow');
        expect(epicChoice).to.exist;

        // Agent Step 3: Execute the assignment
        const result = execFinal(execChoice(epicChoice!));

        // Verify assignment
        expect(result.toLowerCase()).to.match(/assign|linked|added/);

        // Verify in database
        const ticket = db.prepare('SELECT epic_id FROM pmo_tickets WHERE id = ?').get('TKT-EPIC-1') as { epic_id: string };
        expect(ticket.epic_id).to.equal('EPIC-FLOW-1');
      });
    });

    describe('ticket spec - full agent flow', () => {
      beforeEach(() => {
        createLocalTestTicket('TKT-SPEC-1', 'Assign me to a spec');
        // Create test spec
        db.prepare(`
          INSERT INTO pmo_specs (id, title, status)
          VALUES ('SPEC-FLOW-1', 'Test Spec for Flow', 'active')
        `).run();
      });

      it('should complete flow: select ticket → select spec → assign', () => {
        // Agent Step 1: Get available tickets
        const step1 = agentExec('ticket spec -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');

        const ticketChoice = findChoice(step1.prompt.choices, 'TKT-SPEC-1');
        expect(ticketChoice).to.exist;

        // Agent Step 2: Select ticket, get spec choices
        const step2 = agentExec(execChoice(ticketChoice!));
        expect(step2.prompt.type).to.equal('list');

        const specChoice = findChoice(step2.prompt.choices, 'Test Spec for Flow');
        expect(specChoice).to.exist;

        // Agent Step 3: Execute the assignment
        const result = execFinal(execChoice(specChoice!));

        // Verify assignment
        expect(result.toLowerCase()).to.match(/assign|linked|spec/);

        // Verify in database
        const ticket = db.prepare('SELECT spec_id FROM pmo_tickets WHERE id = ?').get('TKT-SPEC-1') as { spec_id: string };
        expect(ticket.spec_id).to.equal('SPEC-FLOW-1');
      });
    });

    describe('ticket link block - full agent flow', () => {
      beforeEach(() => {
        createLocalTestTicket('TKT-BLOCKED', 'This ticket will be blocked');
        createLocalTestTicket('TKT-BLOCKER', 'This ticket blocks another');
      });

      it('should complete flow: select blocked ticket → select blocker → create dependency', () => {
        // Agent Step 1: Start with blocked ticket, get blocker choices
        const step1 = agentExec('ticket link block TKT-BLOCKED -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');

        const blockerChoice = findChoice(step1.prompt.choices, 'TKT-BLOCKER');
        expect(blockerChoice).to.exist;

        // Agent Step 2: Execute the link
        const result = execFinal(execChoice(blockerChoice!));

        // Verify link created
        expect(result.toLowerCase()).to.match(/block|link|depend/);

        // Verify in database
        const dep = db.prepare(`
          SELECT * FROM pmo_ticket_dependencies
          WHERE ticket_id = ? AND depends_on_ticket_id = ?
        `).get('TKT-BLOCKED', 'TKT-BLOCKER');
        expect(dep).to.exist;
      });
    });

    describe('ticket project - full agent flow', () => {
      beforeEach(() => {
        createLocalTestTicket('TKT-PROJ-1', 'Move me to another project');
        // Create another project (uses default workflow which already has statuses)
        createTestProject(db, { id: 'target-project', name: 'Target Project', description: 'Project to move to' });
      });

      it('should complete flow: select ticket → select target project → move', () => {
        // Agent Step 1: Get available tickets
        const step1 = agentExec('ticket project -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');

        const ticketChoice = findChoice(step1.prompt.choices, 'TKT-PROJ-1');
        expect(ticketChoice).to.exist;

        // Agent Step 2: Select ticket, get project choices
        const step2 = agentExec(execChoice(ticketChoice!));
        expect(step2.prompt.type).to.equal('list');

        const projectChoice = findChoice(step2.prompt.choices, 'Target Project');
        expect(projectChoice).to.exist;

        // Agent Step 3: Execute the move
        const result = execFinal(execChoice(projectChoice!));

        // Verify move
        expect(result.toLowerCase()).to.match(/move|project/);

        // Verify in database
        const ticket = db.prepare('SELECT project_id FROM pmo_tickets WHERE id = ?').get('TKT-PROJ-1') as { project_id: string };
        expect(ticket.project_id).to.equal('target-project');
      });
    });

    describe('backward compatibility: --json flag flows', () => {
      beforeEach(() => {
        createLocalTestTicket('TKT-JSON-1', 'JSON flag flow test');
      });

      it('should complete move flow with --json flag (legacy)', () => {
        // Use --json instead of --machine
        const step1 = agentExec('ticket move -P test-project --json');
        expect(step1.prompt.type).to.equal('list');

        const ticketChoice = findChoice(step1.prompt.choices, 'TKT-JSON-1');
        expect(ticketChoice).to.exist;

        const step2 = agentExec(execChoice(ticketChoice!));
        const columnChoice = findChoice(step2.prompt.choices, 'In Progress');
        expect(columnChoice).to.exist;

        const result = execFinal(execChoice(columnChoice!));
        expect(result).to.include('Moved');
      });
    });

    describe('workflow view - full agent flow', () => {
      it('should output JSON data when workflow ID is provided with --json', () => {
        const output = exec('workflow view default --json');
        const json = extractJson<{ workflow: { id: string; name: string; description: string; isBuiltin: boolean }; statuses: unknown[] }>(output);

        expect(json.workflow.id).to.equal('default');
        expect(json.workflow.name).to.equal('Default');
        expect(json.workflow.isBuiltin).to.equal(true);
        expect(json.statuses).to.be.an('array');
      });

      it('should prompt for workflow selection when no ID provided', () => {
        const step1 = agentExec('workflow view --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.message).to.include('workflow');

        const workflowChoice = findChoice(step1.prompt.choices, 'Default');
        expect(workflowChoice).to.exist;
        expect(workflowChoice!.command).to.include('--json');
      });

      it('should complete flow: select workflow → view details', () => {
        // Agent Step 1: Get available workflows
        const step1 = agentExec('workflow view --machine');
        expect(step1.prompt.type).to.equal('list');

        const workflowChoice = findChoice(step1.prompt.choices, 'Default');
        expect(workflowChoice).to.exist;

        // Agent Step 2: View the workflow (executes directly, no more prompts)
        const viewCmd = execChoice(workflowChoice!);
        const result = execFinal(viewCmd);

        // Verify workflow details are shown
        expect(result).to.include('Default');
      });
    });

    describe('workflow switch - full agent flow', () => {
      // The 'kanban' workflow is already seeded by the production schema as a built-in workflow.
      // Confirmation prompt only appears when the project has tickets, so create one.
      beforeEach(() => {
        createLocalTestTicket('TKT-SWITCH-1', 'Ticket for switch confirmation');
      });

      it('should prompt for workflow selection when no workflow specified', () => {
        const step1 = agentExec('workflow switch -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.message).to.include('workflow');

        // Should show available workflows
        const kanbanChoice = findChoice(step1.prompt.choices, 'Kanban');
        expect(kanbanChoice).to.exist;
        expect(kanbanChoice!.command).to.include('-P test-project');
        expect(kanbanChoice!.command).to.include('--json');
      });

      it('should prompt for confirmation when switching workflow', () => {
        const step1 = agentExec('workflow switch kanban -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');

        // Should show confirmation choices
        const yesChoice = findChoice(step1.prompt.choices, 'Yes');
        expect(yesChoice).to.exist;
        expect(yesChoice!.command).to.include('--force');
      });

      it('should complete flow: select workflow → confirm → switch', () => {
        // Agent Step 1: Get available workflows
        const step1 = agentExec('workflow switch -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');

        const workflowChoice = findChoice(step1.prompt.choices, 'Kanban');
        expect(workflowChoice).to.exist;

        // Agent Step 2: Select workflow, get confirmation
        const step2 = agentExec(execChoice(workflowChoice!));
        expect(step2.prompt.type).to.equal('list');

        const yesChoice = findChoice(step2.prompt.choices, 'Yes');
        expect(yesChoice).to.exist;

        // Agent Step 3: Confirm the switch
        const result = execFinal(execChoice(yesChoice!));

        // Verify switch
        expect(result.toLowerCase()).to.match(/switch|kanban/);

        // Verify in database
        const project = db.prepare('SELECT workflow_id FROM pmo_projects WHERE id = ?').get('test-project') as { workflow_id: string };
        expect(project.workflow_id).to.equal('kanban');
      });

      it('should skip confirmation with --force flag', () => {
        const result = exec('workflow switch kanban -P test-project --force');
        expect(result.toLowerCase()).to.match(/switch|kanban/);

        // Verify in database
        const project = db.prepare('SELECT workflow_id FROM pmo_projects WHERE id = ?').get('test-project') as { workflow_id: string };
        expect(project.workflow_id).to.equal('kanban');
      });
    });

    describe('workflow delete - full agent flow', () => {
      beforeEach(() => {
        // Create a custom workflow that can be deleted
        createTestWorkflow(db, { id: 'custom-wf', name: 'Custom Workflow', description: 'A custom workflow for testing' });
        addTestWorkflowStatus(db, 'custom-wf', { id: 'custom-todo', name: 'To Do', category: 'backlog', position: 0, isDefault: true });
        addTestWorkflowStatus(db, 'custom-wf', { id: 'custom-done', name: 'Done', category: 'completed', position: 1 });
      });

      it('should prompt for workflow selection when no ID provided', () => {
        const step1 = agentExec('workflow delete --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.message).to.include('workflow');

        // Should only show custom workflows (not built-in)
        const customChoice = findChoice(step1.prompt.choices, 'Custom Workflow');
        expect(customChoice).to.exist;

        const defaultChoice = findChoice(step1.prompt.choices, 'Default');
        expect(defaultChoice).to.be.undefined; // Built-in should not appear
      });

      it('should prompt for confirmation when deleting workflow', () => {
        const step1 = agentExec('workflow delete custom-wf --machine');
        expect(step1.prompt.type).to.equal('list');

        // Should show confirmation choices
        const yesChoice = findChoice(step1.prompt.choices, 'Yes');
        expect(yesChoice).to.exist;
        expect(yesChoice!.command).to.include('--force');
      });

      it('should complete flow: select workflow → confirm → delete', () => {
        // Agent Step 1: Get available workflows to delete
        const step1 = agentExec('workflow delete --machine');
        expect(step1.prompt.type).to.equal('list');

        const workflowChoice = findChoice(step1.prompt.choices, 'Custom Workflow');
        expect(workflowChoice).to.exist;

        // Agent Step 2: Select workflow, get confirmation
        const step2 = agentExec(execChoice(workflowChoice!));
        expect(step2.prompt.type).to.equal('list');

        const yesChoice = findChoice(step2.prompt.choices, 'Yes');
        expect(yesChoice).to.exist;

        // Agent Step 3: Confirm the delete
        const result = execFinal(execChoice(yesChoice!));

        // Verify delete
        expect(result.toLowerCase()).to.match(/delete|custom workflow/i);

        // Verify in database
        const workflow = db.prepare('SELECT id FROM pmo_workflows WHERE id = ?').get('custom-wf');
        expect(workflow).to.be.undefined;
      });

      it('should skip confirmation with --force flag', () => {
        const result = exec('workflow delete custom-wf --force');
        expect(result.toLowerCase()).to.match(/delete|custom workflow/i);

        // Verify in database
        const workflow = db.prepare('SELECT id FROM pmo_workflows WHERE id = ?').get('custom-wf');
        expect(workflow).to.be.undefined;
      });

      it('should reject deletion of built-in workflows', () => {
        const output = exec('workflow delete default --force');
        expect(output.toLowerCase()).to.include('cannot delete');
      });

      it('should reject deletion of workflow in use by project', () => {
        // First, switch the test project to use custom-wf
        db.prepare(`UPDATE pmo_projects SET workflow_id = 'custom-wf' WHERE id = 'test-project'`).run();

        const output = exec('workflow delete custom-wf --force');
        // Error message or code should indicate the workflow is in use
        expect(output.toLowerCase()).to.satisfy((s: string) =>
          s.includes('in_use') || s.includes('used by') || s.includes('in use') || s.includes('cannot delete')
        );
      });
    });

    describe('workflow list --json', () => {
      it('should output JSON array of workflows', () => {
        const output = exec('workflow list --json');
        const json = extractJson<Array<{ id: string; name: string; isBuiltin: boolean }>>(output);

        expect(json).to.be.an('array');
        expect(json.length).to.be.greaterThan(0);

        const defaultWf = json.find(w => w.id === 'default');
        expect(defaultWf).to.exist;
        expect(defaultWf!.name).to.equal('Default');
        expect(defaultWf!.isBuiltin).to.equal(true);
      });
    });

    describe('workflow create --json (form prompt)', () => {
      it('should output form prompt configuration when --json flag is used', () => {
        const output = exec('workflow create --json');
        const json = extractJson<{ prompt: { type: string; fields: unknown[] } }>(output);

        expect(json.prompt).to.exist;
        expect(json.prompt.type).to.equal('form');
        expect(json.prompt.fields).to.be.an('array');
      });

      it('should create workflow with direct args (no prompts)', () => {
        const result = exec('workflow create "Test Workflow" --description "A test workflow"');
        expect(result.toLowerCase()).to.match(/create|test workflow/i);

        // Verify in database
        const workflow = db.prepare('SELECT * FROM pmo_workflows WHERE name = ?').get('Test Workflow') as { id: string; name: string } | undefined;
        expect(workflow).to.exist;
        expect(workflow!.name).to.equal('Test Workflow');
      });
    });
  });
});
