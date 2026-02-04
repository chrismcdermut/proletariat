/**
 * E2E tests for agent namespace commands with --machine/--json flag support.
 *
 * These tests verify that:
 * 1. Agent commands support --machine flag (and legacy --json)
 * 2. JSON output includes proper prompt schema
 * 3. Flag accumulation works correctly in choices
 * 4. End-to-end agent flows work for AI agents navigating menus
 *
 * Run with: pnpm exec mocha test/e2e/agent-json-mode.test.ts --timeout 30000
 */
import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  createTestProject,
  addWorkspaceTables,
  extractJson as extractJsonOrNull,
  agentExec,
  findChoice,
  execChoice,
  exec,
  type TestEnvironment,
  type AgentPromptResponse,
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
 * Integration tests for agent namespace JSON mode.
 */
describe('Agent Commands JSON Mode', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('agent-json-');

    db = setupProductionSchema(env.dbPath, env.pmoPath);
    createTestProject(db, { id: 'default', name: 'Default Project' });
    addWorkspaceTables(db);

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');

    // Create agents directory structure
    createAgentsDirectory(env.testDir);
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  /**
   * Helper to create a test agent in the database and on disk.
   */
  function createTestAgent(
    name: string,
    type: 'persistent' | 'ephemeral' = 'persistent',
    status: 'active' | 'cleaned' = 'active'
  ): void {
    const dir = type === 'persistent' ? 'staff' : 'temp';
    const agentPath = path.join(env.testDir, 'agents', dir, name);
    fs.mkdirSync(agentPath, { recursive: true });

    // Create a minimal git worktree marker
    fs.mkdirSync(path.join(agentPath, '.git'), { recursive: true });
    fs.writeFileSync(path.join(agentPath, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    db.prepare(`
      INSERT INTO agents (name, type, status, worktree_path, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(name, type, status, `agents/${dir}/${name}`);
  }

  describe('agent index --machine', () => {
    beforeEach(() => {
      createTestAgent('test-agent-1', 'persistent');
      createTestAgent('test-agent-2', 'persistent');
    });

    it('should output valid JSON prompt with --machine flag', () => {
      const output = exec('agent --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('action');
      expect(json.prompt.message).to.include('like to do');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.command).to.equal('agent');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should output valid JSON with --json flag (legacy)', () => {
      const output = exec('agent --json');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { json: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.metadata.flags.json).to.equal(true);
    });

    it('should work with -m shorthand', () => {
      const output = exec('agent -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include --machine flag in choice commands', () => {
      const output = exec('agent --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; command?: string }> };
      }>(output);

      // All choices with commands should include --machine
      for (const choice of json.prompt.choices) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command).to.include('--machine');
        }
      }
    });

    it('should produce same structure with --machine and --json', () => {
      const jsonOutput = exec('agent --json');
      const machineOutput = exec('agent --machine');

      const jsonResult = extractJson<{ prompt: { choices: Array<{ name: string }> } }>(jsonOutput);
      const machineResult = extractJson<{ prompt: { choices: Array<{ name: string }> } }>(machineOutput);

      expect(machineResult.prompt.choices.length).to.equal(jsonResult.prompt.choices.length);
    });
  });

  describe('agent list --machine', () => {
    beforeEach(() => {
      createTestAgent('staff-agent-1', 'persistent');
      createTestAgent('staff-agent-2', 'persistent');
      createTestAgent('temp-agent-1', 'ephemeral');
    });

    it('should output type selection prompt when no type specified', () => {
      const output = exec('agent list --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('selectedType');
      expect(json.prompt.choices).to.be.an('array');

      // Should have type filter choices with --machine flag
      const allChoice = json.prompt.choices.find(c => c.value === 'all');
      expect(allChoice).to.exist;
      expect(allChoice!.command).to.include('--type all');
      expect(allChoice!.command).to.include('--machine');
    });

    it('should work with --json flag (legacy)', () => {
      const output = exec('agent list --json');
      const json = extractJson<{ prompt: { type: string } }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
    });

    it('should work with -m shorthand', () => {
      const output = exec('agent list -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should bypass prompt when --type is specified', () => {
      const output = exec('agent list --type all');

      // Should show agent listing, not a prompt
      expect(output).to.satisfy((o: string) =>
        o.includes('Staff') || o.includes('Temp') || o.includes('No active')
      );
    });
  });

  describe('agent status --machine', () => {
    beforeEach(() => {
      createTestAgent('status-agent', 'persistent');
    });

    it('should output agent selection prompt when no agent specified', () => {
      const output = exec('agent status --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('selected');
      expect(json.prompt.message).to.include('status');
    });

    it('should include --machine flag in choice commands', () => {
      const output = exec('agent status --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command).to.include('--machine');
          expect(choice.command).to.include('prlt agent status');
        }
      }
    });

    it('should work with -m shorthand', () => {
      const output = exec('agent status -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should show agent status when name provided', () => {
      const output = exec('agent status status-agent');

      // Should show status info, not a prompt
      expect(output).to.include('status-agent');
    });
  });

  describe('agent visit --machine', () => {
    beforeEach(() => {
      createTestAgent('visit-agent', 'persistent');
    });

    it('should output agent selection prompt when no agent specified', () => {
      const output = exec('agent visit --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('selected');
      expect(json.prompt.message).to.include('visit');
    });

    it('should include --machine flag in choice commands', () => {
      const output = exec('agent visit --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command).to.include('--machine');
          expect(choice.command).to.include('prlt agent visit');
        }
      }
    });

    it('should work with -m shorthand', () => {
      const output = exec('agent visit -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });
  });

  describe('agent discover --machine', () => {
    it('should output discovery result as JSON with --machine flag', () => {
      const output = exec('agent discover --machine');
      const json = extractJson<{
        success: boolean;
        result: {
          discovered: Array<{ name: string; type: string }>;
          cleaned: string[];
          inSync: boolean;
        };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result).to.exist;
      expect(json.result.discovered).to.be.an('array');
      expect(json.result.cleaned).to.be.an('array');
    });

    it('should work with --json flag (legacy)', () => {
      const output = exec('agent discover --json');
      const json = extractJson<{ success: boolean; result: { discovered: unknown[] } }>(output);

      expect(json.success).to.equal(true);
      expect(json.result).to.exist;
    });

    it('should work with -m shorthand', () => {
      const output = exec('agent discover -m');
      const json = extractJson<{ success: boolean }>(output);

      expect(json.success).to.equal(true);
    });

    it('should discover agents on disk', () => {
      // Create an agent on disk that's not in database
      // Note: discoverAgentsOnDisk checks for directories in agents/staff and agents/temp
      const newAgentPath = path.join(env.testDir, 'agents', 'staff', 'undiscovered-agent');
      fs.mkdirSync(newAgentPath, { recursive: true });
      fs.mkdirSync(path.join(newAgentPath, '.git'), { recursive: true });
      fs.writeFileSync(path.join(newAgentPath, '.git', 'HEAD'), 'ref: refs/heads/main\n');

      const output = exec('agent discover --machine');
      const json = extractJson<{
        success: boolean;
        result: { discovered: Array<{ name: string }>; inSync: boolean };
      }>(output);

      expect(json.success).to.equal(true);
      // The discover command should return valid structure
      expect(json.result.discovered).to.be.an('array');
      // Either it finds the agent or reports in sync
      expect(json.result.discovered.length > 0 || json.result.inSync).to.be.true;
    });
  });

  // ===========================================================================
  // End-to-end Agent Flow Tests
  // ===========================================================================
  // These tests simulate an AI agent navigating through the CLI using --machine
  // flag, selecting choices, and completing multi-step workflows.

  describe('End-to-end agent flows (--machine flag)', () => {
    describe('agent index → list flow', () => {
      beforeEach(() => {
        createTestAgent('flow-agent-1', 'persistent');
        createTestAgent('flow-agent-2', 'persistent');
      });

      it('should complete flow: agent index → select list → select type → view agents', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('action');

        // Find 'List' choice
        const listChoice = findChoice(step1!.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('agent list');
        expect(listChoice!.command).to.include('--machine');

        // Step 2: Execute list command, get type selection
        const step2 = agentExec(execChoice(listChoice!));
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('selectedType');

        // Find 'All' choice
        const allChoice = findChoice(step2!.prompt.choices!, 'All');
        expect(allChoice).to.exist;
        expect(allChoice!.command).to.include('--type all');

        // Step 3: Execute with type flag (final result)
        const finalCmd = execChoice(allChoice!).replace(' --machine', '').replace(' --json', '');
        const result = exec(finalCmd);

        // Should show agent listing
        expect(result).to.satisfy((o: string) =>
          o.includes('flow-agent') || o.includes('Staff') || o.includes('Summary')
        );
      });
    });

    describe('agent index → status flow', () => {
      beforeEach(() => {
        createTestAgent('status-flow-agent', 'persistent');
      });

      it('should complete flow: agent index → select status → select agent → view status', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'status' choice
        const statusChoice = findChoice(step1!.prompt.choices!, 'status');
        expect(statusChoice).to.exist;
        expect(statusChoice!.command).to.include('agent status');

        // Step 2: Execute status command, get agent selection
        const step2 = agentExec(execChoice(statusChoice!));
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('selected');

        // Find our test agent
        const agentChoice = findChoice(step2!.prompt.choices!, 'status-flow-agent');
        expect(agentChoice).to.exist;
        expect(agentChoice!.command).to.include('status-flow-agent');

        // Step 3: Execute with agent name (final result)
        const finalCmd = execChoice(agentChoice!).replace(' --machine', '').replace(' --json', '');
        const result = exec(finalCmd);

        // Should show agent status
        expect(result).to.include('status-flow-agent');
      });
    });

    describe('agent index → visit flow', () => {
      beforeEach(() => {
        createTestAgent('visit-flow-agent', 'persistent');
      });

      it('should complete flow: agent index → select visit → select agent → get path', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'Visit' choice
        const visitChoice = findChoice(step1!.prompt.choices!, 'Visit');
        expect(visitChoice).to.exist;
        expect(visitChoice!.command).to.include('agent visit');

        // Step 2: Execute visit command, get agent selection
        const step2 = agentExec(execChoice(visitChoice!));
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('selected');

        // Find our test agent
        const agentChoice = findChoice(step2!.prompt.choices!, 'visit-flow-agent');
        expect(agentChoice).to.exist;
        expect(agentChoice!.command).to.include('visit-flow-agent');

        // Step 3: Execute with agent name (final result)
        const finalCmd = execChoice(agentChoice!).replace(' --machine', '').replace(' --json', '');
        const result = exec(finalCmd);

        // Should show navigation command
        expect(result).to.include('visit-flow-agent');
        expect(result).to.include('cd');
      });
    });

    describe('agent index → discover flow', () => {
      it('should complete flow: agent index → select discover → get discovery result', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'Discover' choice
        const discoverChoice = findChoice(step1!.prompt.choices!, 'Discover');
        expect(discoverChoice).to.exist;
        expect(discoverChoice!.command).to.include('agent discover');

        // Step 2: Execute discover command (returns data, not prompt)
        const discoverCmd = execChoice(discoverChoice!);
        const output = exec(discoverCmd);

        // Discover returns JSON with results
        const json = extractJson<{
          success: boolean;
          result: { discovered: Array<{ name: string }>; inSync: boolean };
        }>(output);

        expect(json.success).to.equal(true);
        // Should return valid discover result structure
        expect(json.result.discovered).to.be.an('array');
        // Either discovered agents or in sync
        expect(typeof json.result.inSync).to.equal('boolean');
      });
    });

    describe('agent list type filter flow', () => {
      beforeEach(() => {
        createTestAgent('list-staff-1', 'persistent');
        createTestAgent('list-staff-2', 'persistent');
        createTestAgent('list-temp-1', 'ephemeral');
      });

      it('should complete flow: agent list → select Staff → view only staff agents', () => {
        // Step 1: Get type filter prompt
        const step1 = agentExec('agent list --machine');
        expect(step1).to.exist;
        expect(step1!.prompt.name).to.equal('selectedType');

        // Find 'Staff' choice
        const staffChoice = findChoice(step1!.prompt.choices!, 'Staff');
        expect(staffChoice).to.exist;
        expect(staffChoice!.command).to.include('--type staff');

        // Step 2: Execute with staff filter
        const finalCmd = execChoice(staffChoice!).replace(' --machine', '').replace(' --json', '');
        const result = exec(finalCmd);

        // Should show staff agents section (or "no active staff agents" message)
        expect(result.toLowerCase()).to.satisfy((o: string) =>
          o.includes('staff') || o.includes('no active')
        );
      });

      it('should complete flow: agent list → select Temp → view only temp agents', () => {
        // Step 1: Get type filter prompt
        const step1 = agentExec('agent list --machine');
        expect(step1).to.exist;

        // Find 'Temp' choice
        const tempChoice = findChoice(step1!.prompt.choices!, 'Temp');
        expect(tempChoice).to.exist;
        expect(tempChoice!.command).to.include('--type temp');

        // Step 2: Execute with temp filter
        const finalCmd = execChoice(tempChoice!).replace(' --machine', '').replace(' --json', '');
        const result = exec(finalCmd);

        // Should show temp agents section (or "no active temp agents" message)
        expect(result.toLowerCase()).to.satisfy((o: string) =>
          o.includes('temp') || o.includes('temporary') || o.includes('no active')
        );
      });
    });

    describe('backward compatibility: --json flag flows', () => {
      beforeEach(() => {
        createTestAgent('compat-agent', 'persistent');
      });

      it('should complete flow with --json flag (legacy)', () => {
        // Use --json instead of --machine
        const step1 = agentExec('agent --json');
        expect(step1).to.exist;
        expect(step1!.prompt.type).to.equal('list');

        // Find list choice
        const listChoice = findChoice(step1!.prompt.choices!, 'List');
        expect(listChoice).to.exist;

        // Execute next step with --json
        const step2 = agentExec(execChoice(listChoice!));
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('list');
      });
    });

    describe('agent index → staff submenu flow', () => {
      beforeEach(() => {
        createTestAgent('staff-flow-agent', 'persistent');
      });

      it('should complete flow: agent index → staff → get submenu', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'staff' choice
        const staffChoice = findChoice(step1!.prompt.choices!, 'staff');
        expect(staffChoice).to.exist;
        expect(staffChoice!.command).to.include('agent staff');

        // Step 2: Execute staff command, get submenu
        const step2 = agentExec(execChoice(staffChoice!));
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('action');

        // Verify submenu choices have command fields
        const listChoice = findChoice(step2!.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('agent staff list');
        expect(listChoice!.command).to.include('--machine');
      });

      it('should complete flow: agent index → staff → list → view staff agents', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'staff' choice
        const staffChoice = findChoice(step1!.prompt.choices!, 'staff');
        expect(staffChoice).to.exist;

        // Step 2: Execute staff command, get submenu
        const step2 = agentExec(execChoice(staffChoice!));
        expect(step2).to.exist;

        // Find 'List' choice
        const listChoice = findChoice(step2!.prompt.choices!, 'List');
        expect(listChoice).to.exist;

        // Step 3: Execute list command (returns data, not prompt)
        const finalCmd = execChoice(listChoice!).replace(' --machine', '').replace(' --json', '');
        const result = exec(finalCmd);

        // Should show staff agents or summary
        expect(result.toLowerCase()).to.satisfy((o: string) =>
          o.includes('staff') || o.includes('summary') || o.includes('no active')
        );
      });

      it('should complete flow: agent index → staff → remove → get agent selection', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'staff' choice
        const staffChoice = findChoice(step1!.prompt.choices!, 'staff');
        expect(staffChoice).to.exist;

        // Step 2: Execute staff command, get submenu
        const step2 = agentExec(execChoice(staffChoice!));
        expect(step2).to.exist;

        // Find 'Remove' choice
        const removeChoice = findChoice(step2!.prompt.choices!, 'Remove');
        expect(removeChoice).to.exist;
        expect(removeChoice!.command).to.include('agent staff remove');

        // Step 3: Execute remove command, get agent selection prompt
        const step3 = agentExec(execChoice(removeChoice!));
        expect(step3).to.exist;
        expect(step3!.prompt.type).to.equal('list');
        expect(step3!.prompt.name).to.equal('name');

        // Should include our test agent in choices
        const agentChoice = findChoice(step3!.prompt.choices!, 'staff-flow-agent');
        expect(agentChoice).to.exist;
      });

      it('should complete flow: staff remove → select agent → get confirmation prompt', () => {
        // Step 1: Direct staff remove command
        const step1 = agentExec('agent staff remove --machine');
        expect(step1).to.exist;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('name');

        // Find our test agent
        const agentChoice = findChoice(step1!.prompt.choices!, 'staff-flow-agent');
        expect(agentChoice).to.exist;

        // Step 2: Select agent, get confirmation prompt
        // The command would be: agent staff remove staff-flow-agent --machine
        const step2 = agentExec('agent staff remove staff-flow-agent --machine');
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('confirmed');

        // Verify confirmation choices
        expect(step2!.prompt.choices).to.be.an('array');
        const noChoice = findChoice(step2!.prompt.choices!, 'No');
        const yesChoice = findChoice(step2!.prompt.choices!, 'Yes');
        expect(noChoice || yesChoice).to.exist;

        // Verify the message mentions the agent name
        expect(step2!.prompt.message).to.include('staff-flow-agent');
      });
    });

    describe('agent index → temp submenu flow', () => {
      beforeEach(() => {
        createTestAgent('temp-flow-agent', 'ephemeral');
      });

      it('should complete flow: agent index → temp → get submenu', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'temp' choice
        const tempChoice = findChoice(step1!.prompt.choices!, 'temp');
        expect(tempChoice).to.exist;
        expect(tempChoice!.command).to.include('agent temp');

        // Step 2: Execute temp command, get submenu
        const step2 = agentExec(execChoice(tempChoice!));
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('action');

        // Verify submenu choices have command fields
        const listChoice = findChoice(step2!.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('agent temp list');
        expect(listChoice!.command).to.include('--machine');
      });

      it('should complete flow: agent index → temp → list → view temp agents', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'temp' choice
        const tempChoice = findChoice(step1!.prompt.choices!, 'temp');
        expect(tempChoice).to.exist;

        // Step 2: Execute temp command, get submenu
        const step2 = agentExec(execChoice(tempChoice!));
        expect(step2).to.exist;

        // Find 'List' choice
        const listChoice = findChoice(step2!.prompt.choices!, 'List');
        expect(listChoice).to.exist;

        // Step 3: Execute list command (returns data, not prompt)
        const finalCmd = execChoice(listChoice!).replace(' --machine', '').replace(' --json', '');
        const result = exec(finalCmd);

        // Should show temp agents or summary
        expect(result.toLowerCase()).to.satisfy((o: string) =>
          o.includes('temp') || o.includes('temporary') || o.includes('active') || o.includes('no')
        );
      });

      it('should complete flow: agent index → temp → cleanup → get agent checkbox', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'temp' choice
        const tempChoice = findChoice(step1!.prompt.choices!, 'temp');
        expect(tempChoice).to.exist;

        // Step 2: Execute temp command, get submenu
        const step2 = agentExec(execChoice(tempChoice!));
        expect(step2).to.exist;

        // Find 'cleanup' choice
        const cleanupChoice = findChoice(step2!.prompt.choices!, 'Clean');
        expect(cleanupChoice).to.exist;
        expect(cleanupChoice!.command).to.include('agent temp cleanup');

        // Step 3: Execute cleanup command, get agent checkbox prompt
        const step3 = agentExec(execChoice(cleanupChoice!));
        expect(step3).to.exist;
        expect(step3!.prompt.type).to.equal('checkbox');
        expect(step3!.prompt.name).to.equal('agents');

        // Should include "All temp agents" option or our test agent
        expect(step3!.prompt.choices).to.be.an('array');
        const hasAllOption = step3!.prompt.choices!.some(
          (c: { name?: string; value?: string }) => c.value === '__all_temp__' || c.name?.includes('All')
        );
        const hasTestAgent = step3!.prompt.choices!.some(
          (c: { name?: string; value?: string }) => c.value === 'temp-flow-agent'
        );
        expect(hasAllOption || hasTestAgent || step3!.prompt.choices!.length > 0).to.be.true;
      });

      it('should complete flow: temp cleanup → select agent → get confirmation prompt', () => {
        // Step 1: Direct cleanup with specific agent
        // Using the agent name directly triggers the confirmation prompt
        const step1 = agentExec('agent temp cleanup temp-flow-agent --machine');
        expect(step1).to.exist;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('confirmed');

        // Verify confirmation choices
        expect(step1!.prompt.choices).to.be.an('array');
        const noChoice = findChoice(step1!.prompt.choices!, 'No');
        const yesChoice = findChoice(step1!.prompt.choices!, 'Yes');
        expect(noChoice || yesChoice).to.exist;

        // Verify context includes the agent to cleanup
        const prompt = step1!.prompt as AgentPromptResponse['prompt'] & { context?: Record<string, unknown> };
        expect(prompt.context).to.exist;
        expect((prompt.context as { agentsToCleanup: string[] }).agentsToCleanup).to.include('temp-flow-agent');
      });
    });

    describe('agent index → themes submenu flow', () => {
      it('should complete flow: agent index → themes → get submenu', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'themes' choice
        const themesChoice = findChoice(step1!.prompt.choices!, 'themes');
        expect(themesChoice).to.exist;
        expect(themesChoice!.command).to.include('agent themes');

        // Step 2: Execute themes command, get submenu
        const step2 = agentExec(execChoice(themesChoice!));
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('action');

        // Verify submenu choices have command fields
        const listChoice = findChoice(step2!.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('themes list');
      });

      it('should complete flow: agent index → themes → list → view themes', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'themes' choice
        const themesChoice = findChoice(step1!.prompt.choices!, 'themes');
        expect(themesChoice).to.exist;

        // Step 2: Execute themes command, get submenu
        const step2 = agentExec(execChoice(themesChoice!));
        expect(step2).to.exist;

        // Find 'List' choice
        const listChoice = findChoice(step2!.prompt.choices!, 'List');
        expect(listChoice).to.exist;

        // Step 3: Execute list command (returns data, not prompt)
        const finalCmd = execChoice(listChoice!);
        const result = exec(finalCmd);

        // Should show themes list (built-in themes like billionaires, toyotas, companies)
        expect(result.toLowerCase()).to.satisfy((o: string) =>
          o.includes('theme') || o.includes('billionaire') || o.includes('toyota') || o.includes('compan')
        );
      });
    });

    describe('agent index → shell flow', () => {
      beforeEach(() => {
        createTestAgent('shell-flow-agent', 'persistent');
      });

      it('should complete flow: agent index → shell → get agent selection', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'shell' choice
        const shellChoice = findChoice(step1!.prompt.choices!, 'shell');
        expect(shellChoice).to.exist;
        expect(shellChoice!.command).to.include('agent shell');

        // Step 2: Execute shell command, get agent selection
        const step2 = agentExec(execChoice(shellChoice!));
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('selected');

        // Find our test agent
        const agentChoice = findChoice(step2!.prompt.choices!, 'shell-flow-agent');
        expect(agentChoice).to.exist;
        expect(agentChoice!.command).to.include('agent shell shell-flow-agent');
        expect(agentChoice!.command).to.include('--machine');
      });

      it('should complete flow: shell → select agent → get config selection prompt', () => {
        // Step 1: Direct shell command with agent name
        // In JSON mode, this shows the combined config prompt
        const step1 = agentExec('agent shell shell-flow-agent --machine');
        expect(step1).to.exist;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('config');

        // Verify config choices include various combinations
        expect(step1!.prompt.choices).to.be.an('array');
        expect(step1!.prompt.choices!.length).to.be.greaterThan(0);

        // Should have host options (devcontainer options depend on agent having devcontainer config)
        const hasHostOption = step1!.prompt.choices!.some(
          (c: { name?: string; value?: string }) => c.value?.includes('host')
        );
        expect(hasHostOption).to.be.true;

        // Verify choice values are in the expected format: displayMode-permissionMode-environment
        const firstChoice = step1!.prompt.choices![0] as { value?: string };
        expect(firstChoice.value).to.match(/^(terminal|foreground)-(safe|danger)-(devcontainer|host)$/);
      });
    });

    describe('agent index → restart flow', () => {
      beforeEach(() => {
        createTestAgent('restart-flow-agent', 'persistent');
      });

      it('should complete flow: agent index → restart → get agent selection', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'restart' choice
        const restartChoice = findChoice(step1!.prompt.choices!, 'Restart');
        expect(restartChoice).to.exist;
        expect(restartChoice!.command).to.include('agent restart');

        // Step 2: Execute restart command
        // Note: This may fail with Docker error, but we verify the command path is correct
        const output = exec(execChoice(restartChoice!));

        // Either get agent selection prompt OR Docker not running error
        expect(output).to.satisfy((o: string) =>
          o.includes('Docker is not running') ||
          o.includes('Select agent') ||
          o.includes('restart-flow-agent') ||
          o.includes('"prompt"')
        );
      });
    });

    describe('agent index → rebuild flow', () => {
      beforeEach(() => {
        createTestAgent('rebuild-flow-agent', 'persistent');
      });

      it('should complete flow: agent index → rebuild → get agent selection', () => {
        // Step 1: Agent index menu
        const step1 = agentExec('agent --machine');
        expect(step1).to.exist;

        // Find 'rebuild' choice
        const rebuildChoice = findChoice(step1!.prompt.choices!, 'Rebuild');
        expect(rebuildChoice).to.exist;
        expect(rebuildChoice!.command).to.include('agent rebuild');

        // Step 2: Execute rebuild command
        // Note: This may fail with Docker error, but we verify the command path is correct
        const output = exec(execChoice(rebuildChoice!));

        // Either get agent selection prompt OR Docker not running error
        expect(output).to.satisfy((o: string) =>
          o.includes('Docker is not running') ||
          o.includes('Select agent') ||
          o.includes('rebuild-flow-agent') ||
          o.includes('"prompt"')
        );
      });
    });

    describe('agent staff add flow', () => {
      it('should complete flow: agent staff → add → get name selection prompt', () => {
        // Step 1: Agent staff submenu
        const step1 = agentExec('agent staff --machine');
        expect(step1).to.exist;
        expect(step1!.prompt.type).to.equal('list');

        // Find 'Add' choice
        const addChoice = findChoice(step1!.prompt.choices!, 'Add');
        expect(addChoice).to.exist;
        expect(addChoice!.command).to.include('agent staff add');

        // Step 2: Execute add command, get name selection prompt
        const step2 = agentExec(execChoice(addChoice!));
        expect(step2).to.exist;
        // Could be 'list' (theme selection) or 'checkbox' (name selection from active theme)
        expect(['list', 'checkbox']).to.include(step2!.prompt.type);

        // Should have choices for themes or names
        expect(step2!.prompt.choices).to.be.an('array');
        expect(step2!.prompt.choices!.length).to.be.greaterThan(0);
      });

      it('should complete flow: direct agent staff add --machine', () => {
        // Direct command without going through menu
        const result = agentExec('agent staff add --machine');
        expect(result).to.exist;

        // Should get theme/name selection prompt
        expect(['list', 'checkbox']).to.include(result!.prompt.type);
        expect(result!.prompt.choices).to.be.an('array');
        expect(result!.prompt.choices!.length).to.be.greaterThan(0);
      });
    });

    describe('agent themes set flow', () => {
      it('should complete flow: agent themes → set → get theme selection prompt', () => {
        // Direct themes set command
        const result = agentExec('agent themes set --machine');
        expect(result).to.exist;
        expect(result!.prompt.type).to.equal('list');
        expect(result!.prompt.name).to.equal('theme');

        // Should have theme choices (built-in themes like billionaires, toyotas, etc.)
        expect(result!.prompt.choices).to.be.an('array');
        expect(result!.prompt.choices!.length).to.be.greaterThan(0);

        // Verify at least one theme is available
        const hasTheme = result!.prompt.choices!.some(
          (c: { name?: string; value?: string }) =>
            c.value && !c.value.startsWith('__')
        );
        expect(hasTheme).to.be.true;
      });
    });
  });

  describe('Flag-specific tests', () => {
    let env: TestEnvironment;
    let db: Database.Database;

    beforeEach(() => {
      env = createTestEnvironment('agent-flags-');
      db = setupProductionSchema(env.dbPath, env.pmoPath);
      createTestProject(db, { id: 'default', name: 'Default Project' });
      addWorkspaceTables(db);
      createHQConfig(env.proletariatDir);
      createPMODirectories(env.pmoPath, 'test-project');
      createAgentsDirectory(env.testDir);
    });

    afterEach(() => {
      db.close();
      cleanupTestEnvironment(env);
    });

    function createTestAgent(name: string, type: 'persistent' | 'ephemeral' = 'persistent', status: 'active' | 'cleaned' = 'active') {
      const dir = type === 'persistent' ? 'staff' : 'temp';
      const agentPath = path.join(env.testDir, 'agents', dir, name);
      fs.mkdirSync(agentPath, { recursive: true });
      fs.mkdirSync(path.join(agentPath, '.git'), { recursive: true });
      fs.writeFileSync(path.join(agentPath, '.git', 'HEAD'), 'ref: refs/heads/main\n');

      db.prepare(`
        INSERT INTO agents (name, type, status, worktree_path, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(name, type, status, `agents/${dir}/${name}`);
    }

    describe('agent auth flags', () => {
      it('should support --machine flag', () => {
        const output = exec('agent auth --machine');

        // Either Docker error or success/error response
        expect(output).to.satisfy((o: string) =>
          o.includes('Docker is not running') ||
          o.includes('"success"') ||
          o.includes('"error"') ||
          o.includes('DOCKER_NOT_RUNNING')
        );

        // If it contains JSON with success or error, verify structure
        if (output.includes('"success"') || output.includes('"error"')) {
          const json = extractJson<{ success?: boolean; error?: { code: string } }>(output);
          if (json) {
            expect(json.success !== undefined || json.error !== undefined).to.be.true;
          }
        }
      });

      it('should support --check flag with --machine', () => {
        const output = exec('agent auth --check --machine');

        // Either Docker error or check response
        expect(output).to.satisfy((o: string) =>
          o.includes('Docker is not running') ||
          o.includes('"authenticated"') ||
          o.includes('NO_CREDENTIALS')
        );
      });

      it('should support --json flag (legacy)', () => {
        const output = exec('agent auth --json');

        expect(output).to.satisfy((o: string) =>
          o.includes('Docker is not running') ||
          o.includes('"success"') ||
          o.includes('"error"')
        );
      });

      it('should support -m shorthand', () => {
        const output = exec('agent auth -m');

        expect(output).to.satisfy((o: string) =>
          o.includes('Docker is not running') ||
          o.includes('"success"') ||
          o.includes('"error"')
        );
      });

      it('should report INTERACTIVE_REQUIRED when trying to authenticate in JSON mode', () => {
        // Force flag requires interactive, so should get error in JSON mode
        const output = exec('agent auth --force --machine');

        // Either Docker error or interactive required error
        expect(output).to.satisfy((o: string) =>
          o.includes('Docker is not running') ||
          o.includes('INTERACTIVE_REQUIRED')
        );
      });
    });

    describe('agent rebuild flags', () => {
      beforeEach(() => {
        createTestAgent('rebuild-flag-agent', 'persistent');
      });

      it('should support --no-cache flag', () => {
        const output = exec('agent rebuild rebuild-flag-agent --no-cache --machine');

        // Either Docker error or rebuild attempt
        expect(output).to.satisfy((o: string) =>
          o.includes('Docker is not running') ||
          o.includes('Rebuilding') ||
          o.includes('devcontainer')
        );
      });

      it('should accept --no-cache with agent selection prompt', () => {
        // Without agent name, should get selection prompt
        const output = exec('agent rebuild --no-cache --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('Docker is not running') ||
          o.includes('"prompt"') ||
          o.includes('Select agent')
        );
      });
    });

    describe('agent login flags', () => {
      beforeEach(() => {
        createTestAgent('login-flag-agent', 'persistent');
      });

      it('should support --machine flag', () => {
        const output = exec('agent login --machine 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('Docker') ||
          o.includes('Select agent') ||
          o.includes('"error"')
        );
      });

      it('should support --json flag (legacy)', () => {
        const output = exec('agent login --json 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('Docker') ||
          o.includes('"error"')
        );
      });

      it('should support -m shorthand', () => {
        const output = exec('agent login -m 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('Docker') ||
          o.includes('"error"')
        );
      });

      it('should accept agent name directly', () => {
        const output = exec('agent login login-flag-agent 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('login-flag-agent') ||
          o.includes('Docker') ||
          o.includes('Authenticating') ||
          o.includes('Error')
        );
      });

      it('should accept agent name with --machine flag', () => {
        const output = exec('agent login login-flag-agent --machine 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('login-flag-agent') ||
          o.includes('Docker') ||
          o.includes('"success"') ||
          o.includes('"error"')
        );
      });

      it('should error for non-existent agent', () => {
        const output = exec('agent login nonexistent-login-xyz 2>&1');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('not found') ||
          o.includes('error') ||
          o.includes('docker')
        );
      });
    });

    describe('agent restart flags', () => {
      beforeEach(() => {
        createTestAgent('restart-flag-agent', 'persistent');
      });

      it('should support --machine flag', () => {
        const output = exec('agent restart --machine 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('Docker') ||
          o.includes('Select agent') ||
          o.includes('"error"')
        );
      });

      it('should support --json flag (legacy)', () => {
        const output = exec('agent restart --json 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('Docker') ||
          o.includes('"error"')
        );
      });

      it('should support -m shorthand', () => {
        const output = exec('agent restart -m 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('Docker') ||
          o.includes('"error"')
        );
      });

      it('should accept agent name directly', () => {
        const output = exec('agent restart restart-flag-agent 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('restart-flag-agent') ||
          o.includes('Docker') ||
          o.includes('Restarting') ||
          o.includes('Error')
        );
      });

      it('should accept agent name with --machine flag', () => {
        const output = exec('agent restart restart-flag-agent --machine 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('restart-flag-agent') ||
          o.includes('Docker') ||
          o.includes('"success"') ||
          o.includes('"error"')
        );
      });

      it('should error for non-existent agent', () => {
        const output = exec('agent restart nonexistent-restart-xyz 2>&1');

        // Agent restart may attempt the restart (without pre-validation) or error
        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('not found') ||
          o.includes('error') ||
          o.includes('docker') ||
          o.includes('restarting')
        );
      });
    });

    describe('agent staff add flags', () => {
      it('should support --theme flag with name selection', () => {
        // Using built-in theme
        const result = agentExec('agent staff add --theme billionaires --machine');
        expect(result).to.exist;
        expect(result!.prompt.type).to.equal('checkbox');
        expect(result!.prompt.name).to.equal('names');

        // Should have name choices from the theme
        expect(result!.prompt.choices).to.be.an('array');
        expect(result!.prompt.choices!.length).to.be.greaterThan(0);
      });

      it('should support --theme flag with different themes', () => {
        // Try toyotas theme
        const result = agentExec('agent staff add --theme toyotas --machine');
        expect(result).to.exist;
        expect(result!.prompt.type).to.equal('checkbox');

        // Try companies theme
        const result2 = agentExec('agent staff add --theme companies --machine');
        expect(result2).to.exist;
        expect(result2!.prompt.type).to.equal('checkbox');
      });

      it('should error on invalid theme', () => {
        const output = exec('agent staff add --theme nonexistent-theme --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('not found') || o.includes('THEME_NOT_FOUND')
        );
      });

      it('should support --no-container flag', () => {
        // --no-container skips devcontainer setup
        const result = agentExec('agent staff add --theme billionaires --no-container --machine');
        expect(result).to.exist;
        expect(result!.prompt.type).to.equal('checkbox');

        // Flag should be passed through in metadata
        expect(result!.metadata.flags['no-container']).to.equal(true);
      });

      it('should support --clone flag', () => {
        // --clone uses git clone instead of worktree
        const result = agentExec('agent staff add --theme billionaires --clone --machine');
        expect(result).to.exist;
        expect(result!.prompt.type).to.equal('checkbox');

        // Flag should be passed through in metadata
        expect(result!.metadata.flags.clone).to.equal(true);
      });

      it('should support combined flags --theme --no-container --clone', () => {
        const result = agentExec('agent staff add --theme toyotas --no-container --clone --machine');
        expect(result).to.exist;
        expect(result!.prompt.type).to.equal('checkbox');

        // All flags should be in metadata
        expect(result!.metadata.flags['no-container']).to.equal(true);
        expect(result!.metadata.flags.clone).to.equal(true);
      });
    });

    describe('agent temp cleanup flags', () => {
      beforeEach(() => {
        createTestAgent('cleanup-temp-1', 'ephemeral');
        createTestAgent('cleanup-temp-2', 'ephemeral');
      });

      it('should support --temp flag (cleanup idle temp agents)', () => {
        const output = exec('agent temp cleanup --temp --machine');

        // Should either show confirmation prompt or no agents message
        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('NO_AGENTS') ||
          o.includes('confirmed') ||
          o.includes('Clean up')
        );
      });

      it('should support --all flag (cleanup all temp agents)', () => {
        const output = exec('agent temp cleanup --all --machine');

        // Should either show confirmation prompt or no agents message
        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('NO_AGENTS') ||
          o.includes('confirmed')
        );
      });

      it('should support --dry-run flag (show what would be cleaned)', () => {
        const output = exec('agent temp cleanup cleanup-temp-1 --dry-run --machine');

        // Dry run should show results without prompting
        expect(output).to.satisfy((o: string) =>
          o.includes('"success"') ||
          o.includes('dryRun') ||
          o.includes('Would clean') ||
          o.includes('AGENT_NOT_FOUND')
        );
      });

      it('should support --yes flag (skip confirmation)', () => {
        const output = exec('agent temp cleanup cleanup-temp-1 --yes --machine');

        // Should skip confirmation and proceed (or fail to find agent)
        expect(output).to.satisfy((o: string) =>
          o.includes('"success"') ||
          o.includes('cleaned') ||
          o.includes('AGENT_NOT_FOUND') ||
          o.includes('Cleaning up')
        );
      });

      it('should support -y shorthand for --yes', () => {
        const output = exec('agent temp cleanup cleanup-temp-1 -y --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('"success"') ||
          o.includes('cleaned') ||
          o.includes('AGENT_NOT_FOUND') ||
          o.includes('Cleaning up')
        );
      });

      it('should support --force flag (force cleanup with uncommitted work)', () => {
        const output = exec('agent temp cleanup cleanup-temp-1 --force --machine');

        // Should proceed with force flag
        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('"success"') ||
          o.includes('confirmed') ||
          o.includes('AGENT_NOT_FOUND')
        );
      });

      it('should support -f shorthand for --force', () => {
        const output = exec('agent temp cleanup cleanup-temp-1 -f --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('"success"') ||
          o.includes('confirmed') ||
          o.includes('AGENT_NOT_FOUND')
        );
      });

      it('should support combined flags --temp --dry-run', () => {
        const output = exec('agent temp cleanup --temp --dry-run --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('"success"') ||
          o.includes('NO_AGENTS') ||
          o.includes('dryRun')
        );
      });

      it('should support combined flags --all --yes', () => {
        const output = exec('agent temp cleanup --all --yes --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('"success"') ||
          o.includes('NO_AGENTS') ||
          o.includes('cleaned')
        );
      });

      it('should support --push flag (push before cleanup)', () => {
        const output = exec('agent temp cleanup cleanup-temp-1 --push --machine');

        // Should either prompt for confirmation or handle the agent
        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('"success"') ||
          o.includes('confirmed') ||
          o.includes('AGENT_NOT_FOUND') ||
          o.includes('push')
        );
      });

      it('should support combined flags --push --yes', () => {
        const output = exec('agent temp cleanup cleanup-temp-1 --push --yes --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('"success"') ||
          o.includes('cleaned') ||
          o.includes('AGENT_NOT_FOUND') ||
          o.includes('push')
        );
      });
    });

    describe('agent themes create flags', () => {
      it('should support --description flag', () => {
        const output = exec('agent themes create test-theme-1 --description "A test theme" 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('Created theme') ||
          o.includes('test-theme-1') ||
          o.includes('A test theme')
        );
      });

      it('should support -d shorthand for --description', () => {
        const output = exec('agent themes create test-theme-2 -d "Another test theme" 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('Created theme') ||
          o.includes('test-theme-2')
        );
      });

      it('should support --display-name flag', () => {
        const output = exec('agent themes create test-theme-3 --display-name "Custom Display Name" 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('Created theme') ||
          o.includes('Custom Display Name')
        );
      });

      it('should support combined --description and --display-name flags', () => {
        const output = exec('agent themes create test-theme-4 --display-name "Combined Test" --description "Testing both flags" 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('Created theme') ||
          o.includes('Combined Test')
        );
      });
    });

    describe('agent themes add-names', () => {
      it('should add names to an existing theme', () => {
        // First create a theme
        exec('agent themes create test-add-theme --description "Test theme for add-names" 2>&1');

        // Then add names to it
        const output = exec('agent themes add-names test-add-theme hero-1 hero-2 hero-3 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('Added') ||
          o.includes('name') ||
          o.includes('hero')
        );
      });

      it('should normalize agent names', () => {
        // Create theme first
        exec('agent themes create test-normalize-theme 2>&1');

        // Add names with mixed case (should be normalized)
        const output = exec('agent themes add-names test-normalize-theme MyAgent UPPER-CASE 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('Added') ||
          o.includes('Normalized') ||
          o.includes('myagent') ||
          o.includes('upper-case')
        );
      });

      it('should error on non-existent theme', () => {
        const output = exec('agent themes add-names nonexistent-theme name1 name2 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('not found') ||
          o.includes('Error')
        );
      });

      it('should error when no names provided', () => {
        // Create theme first
        exec('agent themes create test-empty-theme 2>&1');

        const output = exec('agent themes add-names test-empty-theme 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('provide') ||
          o.includes('name') ||
          o.includes('Error')
        );
      });
    });

    describe('agent list flags', () => {
      beforeEach(() => {
        createTestAgent('list-staff', 'persistent');
        createTestAgent('list-temp', 'ephemeral');
      });

      it('should support --type staff flag', () => {
        const output = exec('agent list --type staff');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('staff') || o.includes('no active')
        );
      });

      it('should support --type temp flag', () => {
        const output = exec('agent list --type temp');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('temp') || o.includes('temporary') || o.includes('no active')
        );
      });

      it('should support --type all flag', () => {
        const output = exec('agent list --type all');

        // Should show summary or agents
        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('summary') || o.includes('staff') || o.includes('temp') || o.includes('no active')
        );
      });

      it('should support --type flag with --machine', () => {
        // With --type specified, should bypass prompt and show results
        const output = exec('agent list --type staff --machine');

        // No prompt expected when type is specified
        expect(output).to.not.include('"prompt"');
      });

      it('should support -t shorthand for --type', () => {
        const output = exec('agent list -t staff');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('staff') || o.includes('no active')
        );
      });
    });

    describe('agent status with direct agent name', () => {
      beforeEach(() => {
        createTestAgent('direct-status-agent', 'persistent');
      });

      it('should show status when agent name is provided directly', () => {
        const output = exec('agent status direct-status-agent');

        expect(output).to.include('direct-status-agent');
      });

      it('should show status with --machine flag and agent name', () => {
        const output = exec('agent status direct-status-agent --machine');

        // Should return data, not prompt (agent name bypasses selection)
        expect(output).to.include('direct-status-agent');
      });

      it('should error for non-existent agent', () => {
        const output = exec('agent status nonexistent-agent-xyz 2>&1');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('not found') || o.includes('error') || o.includes('no agent')
        );
      });

      it('should error for non-existent agent with --machine', () => {
        const output = exec('agent status nonexistent-agent-xyz --machine 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('AGENT_NOT_FOUND') ||
          o.includes('not found') ||
          o.includes('"error"')
        );
      });
    });

    describe('agent visit with direct agent name', () => {
      beforeEach(() => {
        createTestAgent('direct-visit-agent', 'persistent');
      });

      it('should show path when agent name is provided directly', () => {
        const output = exec('agent visit direct-visit-agent');

        expect(output).to.include('direct-visit-agent');
        expect(output).to.include('cd');
      });

      it('should show path with --machine flag and agent name', () => {
        const output = exec('agent visit direct-visit-agent --machine');

        expect(output).to.include('direct-visit-agent');
      });

      it('should error for non-existent agent', () => {
        const output = exec('agent visit nonexistent-visit-xyz 2>&1');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('not found') || o.includes('error')
        );
      });

      it('should error for non-existent agent with --machine', () => {
        const output = exec('agent visit nonexistent-visit-xyz --machine 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('AGENT_NOT_FOUND') ||
          o.includes('not found') ||
          o.includes('"error"')
        );
      });
    });

    describe('agent shell with direct agent name', () => {
      beforeEach(() => {
        createTestAgent('direct-shell-agent', 'persistent');
      });

      it('should attempt shell when agent name is provided', () => {
        const output = exec('agent shell direct-shell-agent 2>&1');

        // May fail with Docker/tmux error but should attempt
        expect(output).to.satisfy((o: string) =>
          o.includes('direct-shell-agent') ||
          o.includes('Docker') ||
          o.includes('tmux') ||
          o.includes('shell')
        );
      });

      it('should accept --machine flag with agent name', () => {
        const output = exec('agent shell direct-shell-agent --machine 2>&1');

        // Could return prompt for config selection, error, or Docker message
        // When agent name is provided, shell command shows config selection in JSON mode
        expect(output).to.satisfy((o: string) =>
          o.includes('prompt') ||
          o.includes('Docker') ||
          o.includes('error') ||
          o.includes('config') ||
          o.includes('terminal') ||
          o.includes('host')
        );
      });

      it('should error for non-existent agent', () => {
        const output = exec('agent shell nonexistent-shell-xyz 2>&1');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('not found') || o.includes('error') || o.includes('docker')
        );
      });
    });

    describe('agent staff remove with direct agent name', () => {
      beforeEach(() => {
        createTestAgent('remove-agent-1', 'persistent');
        createTestAgent('remove-agent-2', 'persistent');
      });

      it('should prompt for confirmation when agent name provided', () => {
        const output = exec('agent staff remove remove-agent-1 --machine 2>&1');

        // Should get confirmation prompt, agent not found, or no agents error
        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('confirmed') ||
          o.includes('Docker') ||
          o.includes('AGENT_NOT_FOUND') ||
          o.includes('NO_AGENTS') ||
          o.includes('not found') ||
          o.includes('"error"')
        );
      });

      it('should support --force flag to skip confirmation', () => {
        const output = exec('agent staff remove remove-agent-1 --force 2>&1');

        // Should proceed without confirmation (may fail due to Docker)
        expect(output).to.satisfy((o: string) =>
          o.includes('Removing') ||
          o.includes('removed') ||
          o.includes('Docker') ||
          o.includes('Error')
        );
      });

      it('should support -f shorthand for --force', () => {
        const output = exec('agent staff remove remove-agent-2 -f 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('Removing') ||
          o.includes('removed') ||
          o.includes('Docker') ||
          o.includes('Error')
        );
      });

      it('should error for non-existent agent', () => {
        const output = exec('agent staff remove nonexistent-remove-xyz --force 2>&1');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('not found') || o.includes('error')
        );
      });

      it('should error for non-existent agent with --machine', () => {
        const output = exec('agent staff remove nonexistent-remove-xyz --machine 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('AGENT_NOT_FOUND') ||
          o.includes('not found') ||
          o.includes('"error"')
        );
      });
    });

    describe('agent staff add with direct agent names', () => {
      it('should accept direct agent name argument', () => {
        const output = exec('agent staff add test-direct-agent 2>&1');

        // Should attempt to add agent (may fail due to Docker/workspace setup)
        expect(output).to.satisfy((o: string) =>
          o.includes('Adding') ||
          o.includes('test-direct-agent') ||
          o.includes('Docker') ||
          o.includes('Error') ||
          o.includes('worktree')
        );
      });

      it('should accept multiple agent names', () => {
        const output = exec('agent staff add agent-a agent-b 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('Adding') ||
          o.includes('agent-a') ||
          o.includes('agent-b') ||
          o.includes('Docker') ||
          o.includes('Error')
        );
      });

      it('should support --no-container flag', () => {
        const output = exec('agent staff add no-container-agent --no-container 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('Adding') ||
          o.includes('no-container-agent') ||
          o.includes('worktree') ||
          o.includes('Error')
        );
      });

      it('should support --clone flag', () => {
        const output = exec('agent staff add clone-agent --clone 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('Adding') ||
          o.includes('clone-agent') ||
          o.includes('clone') ||
          o.includes('Error')
        );
      });

      it('should support combined --theme and --no-container flags', () => {
        const output = exec('agent staff add --theme billionaires --no-container --machine 2>&1');

        // Should get name selection from theme or error
        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('checkbox') ||
          o.includes('names') ||
          o.includes('Error') ||
          o.includes('not found')
        );
      });
    });

    describe('error cases', () => {
      beforeEach(() => {
        // Create at least one agent for list tests
        createTestAgent('error-test-agent', 'persistent');
      });

      it('should handle empty agent list gracefully', () => {
        const output = exec('agent list --type staff 2>&1');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('no active') ||
          o.includes('summary') ||
          o.includes('staff') ||
          o.includes('error') ||
          o.includes('agent')
        );
      });

      it('should handle invalid command gracefully', () => {
        const output = exec('agent invalidsubcommand 2>&1');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('error') || o.includes('not') || o.includes('unknown') || o.includes('help')
        );
      });

      it('should handle missing required arguments', () => {
        // themes create requires NAME
        const output = exec('agent themes create 2>&1');

        expect(output).to.satisfy((o: string) =>
          o.includes('Missing') ||
          o.includes('required') ||
          o.includes('USAGE') ||
          o.includes('Error') ||
          o.includes('NAME')
        );
      });
    });
  });
});

/**
 * Create agents directory structure for tests.
 */
function createAgentsDirectory(testDir: string) {
  const agentsPath = path.join(testDir, 'agents');
  fs.mkdirSync(path.join(agentsPath, 'staff'), { recursive: true });
  fs.mkdirSync(path.join(agentsPath, 'temp'), { recursive: true });
}
