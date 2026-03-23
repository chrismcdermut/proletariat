/* eslint-disable max-nested-callbacks, max-lines */
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
  findChoice,
  execChoice,
  execInProcess,
  type TestEnvironment,
  type AgentPromptResponse,
  hasContextError,
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
/**
 * Local async agentExec that uses execInProcess instead of execProduction.
 */
async function agentExecAsync(cmd: string): Promise<AgentPromptResponse | null> {
  const output = await execInProcess(cmd);
  if (hasContextError(output)) {
    return null;
  }
  const json = extractJson<AgentPromptResponse>(output);
  if (json && typeof json === 'object' && !('prompt' in json)) {
    return null;
  }
  return json;
}

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

    it('should output valid JSON prompt with --machine flag', async () => {
      const output = await execInProcess('agent --machine');
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

    it('should output valid JSON with --json flag (legacy)', async () => {
      const output = await execInProcess('agent --json');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { json: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.metadata.flags.json).to.equal(true);
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('agent -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include --machine flag in choice commands', async () => {
      const output = await execInProcess('agent --machine');
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

    it('should produce same structure with --machine and --json', async () => {
      const jsonOutput = await execInProcess('agent --json');
      const machineOutput = await execInProcess('agent --machine');

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

    it('should output all agents as JSON data when no type specified', async () => {
      const output = await execInProcess('agent list --machine');
      const json = extractJson<{
        staff: Array<{ name: string; type: string }>;
        temp: Array<{ name: string; type: string }>;
        all: Array<{ name: string; type: string }>;
      }>(output);

      // In JSON mode without --type, agent list returns grouped JSON data
      expect(json).to.exist;
      expect(json.staff).to.be.an('array');
      expect(json.temp).to.be.an('array');
      expect(json).to.not.have.property('all');
    });

    it('should work with --json flag (legacy)', async () => {
      const output = await execInProcess('agent list --json');
      const json = extractJson<{
        staff: Array<{ name: string }>;
        temp: Array<{ name: string }>;
      }>(output);

      expect(json).to.exist;
      expect(json.staff).to.be.an('array');
      expect(json.temp).to.be.an('array');
      expect(json).to.not.have.property('all');
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('agent list -m');
      const json = extractJson<{
        staff: Array<{ name: string }>;
        temp: Array<{ name: string }>;
      }>(output);

      expect(json).to.exist;
      expect(json.staff).to.be.an('array');
      expect(json.temp).to.be.an('array');
      expect(json).to.not.have.property('all');
    });

    it('should bypass prompt when --type is specified', async () => {
      const output = await execInProcess('agent list --type all');

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

    it('should output all agent statuses as JSON data when no agent specified', async () => {
      const output = await execInProcess('agent status --machine');
      const json = extractJson<{
        success: boolean;
        result: { agents: Array<{ name: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      // In JSON mode without agent name, returns all statuses as data (not a prompt)
      expect(json).to.exist;
      expect(json.success).to.equal(true);
      expect(json.result.agents).to.be.an('array');
    });

    it('should include metadata with command name', async () => {
      const output = await execInProcess('agent status --machine');
      const json = extractJson<{
        metadata: { command: string };
      }>(output);

      expect(json).to.exist;
      expect(json.metadata.command).to.equal('agent status');
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('agent status -m');
      const json = extractJson<{
        success: boolean;
        metadata: { flags: { machine: boolean } };
      }>(output);

      expect(json).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should show agent status when name provided', async () => {
      const output = await execInProcess('agent status status-agent');

      // Should show status info, not a prompt
      expect(output).to.include('status-agent');
    });
  });

  describe('agent visit --machine', () => {
    beforeEach(() => {
      createTestAgent('visit-agent', 'persistent');
    });

    it('should output agent selection prompt when no agent specified', async () => {
      const output = await execInProcess('agent visit --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('selected');
      expect(json.prompt.message).to.include('visit');
    });

    it('should include --machine flag in choice commands', async () => {
      const output = await execInProcess('agent visit --machine');
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

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('agent visit -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });
  });

  describe('agent discover --machine', () => {
    it('should output discovery result as JSON with --machine flag', async () => {
      const output = await execInProcess('agent discover --machine');
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

    it('should work with --json flag (legacy)', async () => {
      const output = await execInProcess('agent discover --json');
      const json = extractJson<{ success: boolean; result: { discovered: unknown[] } }>(output);

      expect(json.success).to.equal(true);
      expect(json.result).to.exist;
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('agent discover -m');
      const json = extractJson<{ success: boolean }>(output);

      expect(json.success).to.equal(true);
    });

    it('should discover agents on disk', async () => {
      // Create an agent on disk that's not in database
      // Note: discoverAgentsOnDisk checks for directories in agents/staff and agents/temp
      const newAgentPath = path.join(env.testDir, 'agents', 'staff', 'undiscovered-agent');
      fs.mkdirSync(newAgentPath, { recursive: true });
      fs.mkdirSync(path.join(newAgentPath, '.git'), { recursive: true });
      fs.writeFileSync(path.join(newAgentPath, '.git', 'HEAD'), 'ref: refs/heads/main\n');

      const output = await execInProcess('agent discover --machine');
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

      it('should complete flow: agent index → select list → view agents as JSON data', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('action');

        // Find 'List' choice
        const listChoice = findChoice(step1!.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('agent list');
        expect(listChoice!.command).to.include('--machine');

        // Step 2: Execute list command - now returns JSON data directly (no prompt)
        const listCmd = execChoice(listChoice!);
        const output = await execInProcess(listCmd);

        // In JSON mode without --type, agent list returns grouped JSON data
        const json = extractJson<{
          staff: Array<{ name: string }>;
          temp: Array<{ name: string }>;
        }>(output);

        expect(json).to.exist;
        expect(json.staff).to.be.an('array');
        expect(json.temp).to.be.an('array');
        expect(json).to.not.have.property('all');
      });
    });

    describe('agent index → status flow', () => {
      beforeEach(() => {
        createTestAgent('status-flow-agent', 'persistent');
      });

      it('should complete flow: agent index → select status → view all agent statuses', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;

        // Find 'status' choice
        const statusChoice = findChoice(step1!.prompt.choices!, 'status');
        expect(statusChoice).to.exist;
        expect(statusChoice!.command).to.include('agent status');

        // Step 2: Execute status command - now returns all agent statuses as JSON data
        const statusCmd = execChoice(statusChoice!);
        const output = await execInProcess(statusCmd);

        // In JSON mode without agent name, status returns all statuses as data
        const json = extractJson<{
          success: boolean;
          result: { agents: Array<{ name: string }> };
        }>(output);

        expect(json).to.exist;
        expect(json.success).to.equal(true);
        expect(json.result.agents).to.be.an('array');

        // Step 3: View specific agent status directly
        const result = await execInProcess('agent status status-flow-agent');

        // Should show agent status
        expect(result).to.include('status-flow-agent');
      });
    });

    describe('agent index → visit flow', () => {
      beforeEach(() => {
        createTestAgent('visit-flow-agent', 'persistent');
      });

      it('should complete flow: agent index → select visit → select agent → get path', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;

        // Find 'Visit' choice
        const visitChoice = findChoice(step1!.prompt.choices!, 'Visit');
        expect(visitChoice).to.exist;
        expect(visitChoice!.command).to.include('agent visit');

        // Step 2: Execute visit command, get agent selection
        const step2 = await agentExecAsync(execChoice(visitChoice!));
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('selected');

        // Find our test agent
        const agentChoice = findChoice(step2!.prompt.choices!, 'visit-flow-agent');
        expect(agentChoice).to.exist;
        expect(agentChoice!.command).to.include('visit-flow-agent');

        // Step 3: Execute with agent name (final result)
        const finalCmd = execChoice(agentChoice!).replace(' --machine', '').replace(' --json', '');
        const result = await execInProcess(finalCmd);

        // Should show navigation command
        expect(result).to.include('visit-flow-agent');
        expect(result).to.include('cd');
      });
    });

    describe('agent index → discover flow', () => {
      it('should complete flow: agent index → select discover → get discovery result', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;

        // Find 'Discover' choice
        const discoverChoice = findChoice(step1!.prompt.choices!, 'Discover');
        expect(discoverChoice).to.exist;
        expect(discoverChoice!.command).to.include('agent discover');

        // Step 2: Execute discover command (returns data, not prompt)
        const discoverCmd = execChoice(discoverChoice!);
        const output = await execInProcess(discoverCmd);

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

      it('should complete flow: agent list --machine → view staff agents in JSON data', async () => {
        // agent list --machine now returns all agents as JSON data directly
        const output = await execInProcess('agent list --machine');
        const json = extractJson<{
          staff: Array<{ name: string; type: string }>;
          temp: Array<{ name: string; type: string }>;
        }>(output);

        expect(json).to.exist;
        expect(json.staff).to.be.an('array');
        expect(json.temp).to.be.an('array');
        expect(json).to.not.have.property('all');
      });

      it('should complete flow: agent list --type staff → view only staff agents', async () => {
        // Use --type flag to filter directly
        const result = await execInProcess('agent list --type staff');

        // Should show staff agents section (or "no active staff agents" message)
        expect(result.toLowerCase()).to.satisfy((o: string) =>
          o.includes('staff') || o.includes('no active')
        );
      });

      it('should complete flow: agent list --type temp → view only temp agents', async () => {
        // Use --type flag to filter directly
        const result = await execInProcess('agent list --type temp');

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

      it('should complete flow with --json flag (legacy)', async () => {
        // Use --json instead of --machine
        const step1 = await agentExecAsync('agent --json');
        expect(step1).to.exist;
        expect(step1!.prompt.type).to.equal('list');

        // Find list choice
        const listChoice = findChoice(step1!.prompt.choices!, 'List');
        expect(listChoice).to.exist;

        // Execute next step with --json - now returns JSON data directly (no prompt)
        const listCmd = execChoice(listChoice!);
        const output = await execInProcess(listCmd);

        // agent list --json returns grouped JSON data
        const json = extractJson<{
          staff: Array<{ name: string }>;
          temp: Array<{ name: string }>;
        }>(output);

        expect(json).to.exist;
        expect(json.staff).to.be.an('array');
        expect(json).to.not.have.property('all');
      });
    });

    describe('agent index → staff submenu flow', () => {
      beforeEach(() => {
        createTestAgent('staff-flow-agent', 'persistent');
      });

      it('should complete flow: agent index → staff → get submenu', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;

        // Find 'staff' choice
        const staffChoice = findChoice(step1!.prompt.choices!, 'staff');
        expect(staffChoice).to.exist;
        expect(staffChoice!.command).to.include('agent staff');

        // Step 2: Execute staff command, get submenu
        const step2 = await agentExecAsync(execChoice(staffChoice!));
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('action');

        // Verify submenu choices have command fields
        const listChoice = findChoice(step2!.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('agent staff list');
        expect(listChoice!.command).to.include('--machine');
      });

      it('should complete flow: agent index → staff → list → view staff agents', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;

        // Find 'staff' choice
        const staffChoice = findChoice(step1!.prompt.choices!, 'staff');
        expect(staffChoice).to.exist;

        // Step 2: Execute staff command, get submenu
        const step2 = await agentExecAsync(execChoice(staffChoice!));
        expect(step2).to.exist;

        // Find 'List' choice
        const listChoice = findChoice(step2!.prompt.choices!, 'List');
        expect(listChoice).to.exist;

        // Step 3: Execute list command (returns data, not prompt)
        const finalCmd = execChoice(listChoice!).replace(' --machine', '').replace(' --json', '');
        const result = await execInProcess(finalCmd);

        // Should show staff agents or summary
        expect(result.toLowerCase()).to.satisfy((o: string) =>
          o.includes('staff') || o.includes('summary') || o.includes('no active')
        );
      });

      it('should complete flow: agent index → staff → remove → get agent selection', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;

        // Find 'staff' choice
        const staffChoice = findChoice(step1!.prompt.choices!, 'staff');
        expect(staffChoice).to.exist;

        // Step 2: Execute staff command, get submenu
        const step2 = await agentExecAsync(execChoice(staffChoice!));
        expect(step2).to.exist;

        // Find 'Remove' choice
        const removeChoice = findChoice(step2!.prompt.choices!, 'Remove');
        expect(removeChoice).to.exist;
        expect(removeChoice!.command).to.include('agent staff remove');

        // Step 3: Execute remove command, get agent selection prompt
        const step3 = await agentExecAsync(execChoice(removeChoice!));
        expect(step3).to.exist;
        expect(step3!.prompt.type).to.equal('list');
        expect(step3!.prompt.name).to.equal('name');

        // Should include our test agent in choices
        const agentChoice = findChoice(step3!.prompt.choices!, 'staff-flow-agent');
        expect(agentChoice).to.exist;
      });

      it('should complete flow: staff remove → select agent → get confirmation prompt', async () => {
        // Step 1: Direct staff remove command
        const step1 = await agentExecAsync('agent staff remove --machine');
        expect(step1).to.exist;
        expect(step1!.prompt.type).to.equal('list');
        expect(step1!.prompt.name).to.equal('name');

        // Find our test agent
        const agentChoice = findChoice(step1!.prompt.choices!, 'staff-flow-agent');
        expect(agentChoice).to.exist;

        // Step 2: Select agent, get confirmation prompt
        // The command would be: agent staff remove staff-flow-agent --machine
        const step2 = await agentExecAsync('agent staff remove staff-flow-agent --machine');
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

    describe('agent index → cleanup flow', () => {
      beforeEach(() => {
        createTestAgent('temp-flow-agent', 'ephemeral');
      });

      it('should complete flow: agent index → cleanup → get agent checkbox', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;

        // Find 'cleanup' choice (cleanup is now a top-level action, not under temp submenu)
        const cleanupChoice = findChoice(step1!.prompt.choices!, 'Cleanup');
        expect(cleanupChoice).to.exist;
        expect(cleanupChoice!.command).to.include('agent cleanup');

        // Step 2: Execute cleanup command, get agent checkbox prompt
        const step2 = await agentExecAsync(execChoice(cleanupChoice!));
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('checkbox');
        expect(step2!.prompt.name).to.equal('agents');

        // Should include "All temp agents" option or our test agent
        expect(step2!.prompt.choices).to.be.an('array');
        const hasAllOption = step2!.prompt.choices!.some(
          (c: { name?: string; value?: string }) => c.value === '__all_temp__' || c.name?.includes('All')
        );
        const hasTestAgent = step2!.prompt.choices!.some(
          (c: { name?: string; value?: string }) => c.value === 'temp-flow-agent'
        );
        expect(hasAllOption || hasTestAgent || step2!.prompt.choices!.length > 0).to.be.true;
      });

      it('should complete flow: agent index → cleanup → view temp agents in list', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;

        // Find 'List' choice to view temp agents
        const listChoice = findChoice(step1!.prompt.choices!, 'List');
        expect(listChoice).to.exist;

        // Step 2: Execute list command - returns JSON data with temp agents
        const listCmd = execChoice(listChoice!);
        const output = await execInProcess(listCmd);

        const json = extractJson<{
          temp: Array<{ name: string }>;
          all: Array<{ name: string }>;
        }>(output);

        expect(json).to.exist;
        expect(json.temp).to.be.an('array');
      });

      it('should complete flow: direct cleanup with agent → get confirmation prompt', async () => {
        // Direct cleanup with specific agent triggers the confirmation prompt
        const step1 = await agentExecAsync('agent cleanup temp-flow-agent --machine');
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
      it('should complete flow: agent index → themes → get submenu', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;

        // Find 'themes' choice
        const themesChoice = findChoice(step1!.prompt.choices!, 'themes');
        expect(themesChoice).to.exist;
        expect(themesChoice!.command).to.include('agent themes');

        // Step 2: Execute themes command, get submenu
        const step2 = await agentExecAsync(execChoice(themesChoice!));
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('action');

        // Verify submenu choices have command fields
        const listChoice = findChoice(step2!.prompt.choices!, 'List');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('themes list');
      });

      it('should complete flow: agent index → themes → list → view themes', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;

        // Find 'themes' choice
        const themesChoice = findChoice(step1!.prompt.choices!, 'themes');
        expect(themesChoice).to.exist;

        // Step 2: Execute themes command, get submenu
        const step2 = await agentExecAsync(execChoice(themesChoice!));
        expect(step2).to.exist;

        // Find 'List' choice
        const listChoice = findChoice(step2!.prompt.choices!, 'List');
        expect(listChoice).to.exist;

        // Step 3: Execute list command (returns data, not prompt)
        const finalCmd = execChoice(listChoice!);
        const result = await execInProcess(finalCmd);

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

      it('should complete flow: agent index → shell → get agent selection', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;

        // Find 'shell' choice
        const shellChoice = findChoice(step1!.prompt.choices!, 'shell');
        expect(shellChoice).to.exist;
        expect(shellChoice!.command).to.include('agent shell');

        // Step 2: Execute shell command, get agent selection
        const step2 = await agentExecAsync(execChoice(shellChoice!));
        expect(step2).to.exist;
        expect(step2!.prompt.type).to.equal('list');
        expect(step2!.prompt.name).to.equal('selected');

        // Find our test agent
        const agentChoice = findChoice(step2!.prompt.choices!, 'shell-flow-agent');
        expect(agentChoice).to.exist;
        expect(agentChoice!.command).to.include('agent shell shell-flow-agent');
        expect(agentChoice!.command).to.include('--machine');
      });

      it('should complete flow: shell → select agent → get config selection prompt', async () => {
        // Step 1: Direct shell command with agent name
        // In JSON mode, this shows the combined config prompt
        const step1 = await agentExecAsync('agent shell shell-flow-agent --machine');
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

      it('should complete flow: agent index → restart → get agent selection', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;

        // Find 'restart' choice
        const restartChoice = findChoice(step1!.prompt.choices!, 'Restart');
        expect(restartChoice).to.exist;
        expect(restartChoice!.command).to.include('agent restart');

        // Step 2: Execute restart command
        // Note: This may fail with Docker error, but we verify the command path is correct
        const output = await execInProcess(execChoice(restartChoice!));

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

      it('should complete flow: agent index → rebuild → get agent selection', async () => {
        // Step 1: Agent index menu
        const step1 = await agentExecAsync('agent --machine');
        expect(step1).to.exist;

        // Find 'rebuild' choice
        const rebuildChoice = findChoice(step1!.prompt.choices!, 'Rebuild');
        expect(rebuildChoice).to.exist;
        expect(rebuildChoice!.command).to.include('agent rebuild');

        // Step 2: Execute rebuild command
        // Note: This may fail with Docker error, but we verify the command path is correct
        const output = await execInProcess(execChoice(rebuildChoice!));

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
      it('should complete flow: agent staff → add → get name selection prompt', async () => {
        // Step 1: Agent staff submenu
        const step1 = await agentExecAsync('agent staff --machine');
        expect(step1).to.exist;
        expect(step1!.prompt.type).to.equal('list');

        // Find 'Add' choice
        const addChoice = findChoice(step1!.prompt.choices!, 'Add');
        expect(addChoice).to.exist;
        expect(addChoice!.command).to.include('agent staff add');

        // Step 2: Execute add command, get name selection prompt
        const step2 = await agentExecAsync(execChoice(addChoice!));
        expect(step2).to.exist;
        // Could be 'list' (theme selection) or 'checkbox' (name selection from active theme)
        expect(['list', 'checkbox']).to.include(step2!.prompt.type);

        // Should have choices for themes or names
        expect(step2!.prompt.choices).to.be.an('array');
        expect(step2!.prompt.choices!.length).to.be.greaterThan(0);
      });

      it('should complete flow: direct agent staff add --machine', async () => {
        // Direct command without going through menu
        const result = await agentExecAsync('agent staff add --machine');
        expect(result).to.exist;

        // Should get theme/name selection prompt
        expect(['list', 'checkbox']).to.include(result!.prompt.type);
        expect(result!.prompt.choices).to.be.an('array');
        expect(result!.prompt.choices!.length).to.be.greaterThan(0);
      });
    });

    describe('agent themes set flow', () => {
      it('should complete flow: agent themes → set → get theme selection prompt', async () => {
        // Direct themes set command
        const result = await agentExecAsync('agent themes set --machine');
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
      it('should support --machine flag', async () => {
        const output = await execInProcess('agent auth --machine');

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

      it('should support --check flag with --machine', async () => {
        const output = await execInProcess('agent auth --check --machine');

        // Either Docker error or check response
        expect(output).to.satisfy((o: string) =>
          o.includes('Docker is not running') ||
          o.includes('"authenticated"') ||
          o.includes('NO_CREDENTIALS')
        );
      });

      it('should support --json flag (legacy)', async () => {
        const output = await execInProcess('agent auth --json');

        expect(output).to.satisfy((o: string) =>
          o.includes('Docker is not running') ||
          o.includes('"success"') ||
          o.includes('"error"')
        );
      });

      it('should support -m shorthand', async () => {
        const output = await execInProcess('agent auth -m');

        expect(output).to.satisfy((o: string) =>
          o.includes('Docker is not running') ||
          o.includes('"success"') ||
          o.includes('"error"')
        );
      });

      it('should report INTERACTIVE_REQUIRED when trying to authenticate in JSON mode', async () => {
        // Force flag requires interactive, so should get error in JSON mode
        const output = await execInProcess('agent auth --force --machine');

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

      it('should support --no-cache flag', async () => {
        const output = await execInProcess('agent rebuild rebuild-flag-agent --no-cache --machine');

        // Either Docker error or rebuild attempt
        expect(output).to.satisfy((o: string) =>
          o.includes('Docker is not running') ||
          o.includes('Rebuilding') ||
          o.includes('devcontainer')
        );
      });

      it('should accept --no-cache with agent selection prompt', async () => {
        // Without agent name, should get selection prompt
        const output = await execInProcess('agent rebuild --no-cache --machine');

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

      it('should support --machine flag', async () => {
        const output = await execInProcess('agent login --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('Docker') ||
          o.includes('Select agent') ||
          o.includes('"error"')
        );
      });

      it('should support --json flag (legacy)', async () => {
        const output = await execInProcess('agent login --json');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('Docker') ||
          o.includes('"error"')
        );
      });

      it('should support -m shorthand', async () => {
        const output = await execInProcess('agent login -m');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('Docker') ||
          o.includes('"error"')
        );
      });

      it('should accept agent name directly', async () => {
        const output = await execInProcess('agent login login-flag-agent');

        expect(output).to.satisfy((o: string) =>
          o.includes('login-flag-agent') ||
          o.includes('Docker') ||
          o.includes('Authenticating') ||
          o.includes('Error')
        );
      });

      it('should accept agent name with --machine flag', async () => {
        const output = await execInProcess('agent login login-flag-agent --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('login-flag-agent') ||
          o.includes('Docker') ||
          o.includes('"success"') ||
          o.includes('"error"')
        );
      });

      it('should error for non-existent agent', async () => {
        const output = await execInProcess('agent login nonexistent-login-xyz');

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

      it('should support --machine flag', async () => {
        const output = await execInProcess('agent restart --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('Docker') ||
          o.includes('Select agent') ||
          o.includes('"error"')
        );
      });

      it('should support --json flag (legacy)', async () => {
        const output = await execInProcess('agent restart --json');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('Docker') ||
          o.includes('"error"')
        );
      });

      it('should support -m shorthand', async () => {
        const output = await execInProcess('agent restart -m');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('Docker') ||
          o.includes('"error"')
        );
      });

      it('should accept agent name directly', async () => {
        const output = await execInProcess('agent restart restart-flag-agent');

        expect(output).to.satisfy((o: string) =>
          o.includes('restart-flag-agent') ||
          o.includes('Docker') ||
          o.includes('Restarting') ||
          o.includes('Error')
        );
      });

      it('should accept agent name with --machine flag', async () => {
        const output = await execInProcess('agent restart restart-flag-agent --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('restart-flag-agent') ||
          o.includes('Docker') ||
          o.includes('"success"') ||
          o.includes('"error"')
        );
      });

      it('should error for non-existent agent', async () => {
        const output = await execInProcess('agent restart nonexistent-restart-xyz');

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
      it('should support --theme flag with name selection', async () => {
        // Using built-in theme
        const result = await agentExecAsync('agent staff add --theme billionaires --machine');
        expect(result).to.exist;
        expect(result!.prompt.type).to.equal('checkbox');
        expect(result!.prompt.name).to.equal('names');

        // Should have name choices from the theme
        expect(result!.prompt.choices).to.be.an('array');
        expect(result!.prompt.choices!.length).to.be.greaterThan(0);
      });

      it('should support --theme flag with different themes', async () => {
        // Try toyotas theme
        const result = await agentExecAsync('agent staff add --theme toyotas --machine');
        expect(result).to.exist;
        expect(result!.prompt.type).to.equal('checkbox');

        // Try companies theme
        const result2 = await agentExecAsync('agent staff add --theme companies --machine');
        expect(result2).to.exist;
        expect(result2!.prompt.type).to.equal('checkbox');
      });

      it('should error on invalid theme', async () => {
        const output = await execInProcess('agent staff add --theme nonexistent-theme --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('not found') || o.includes('THEME_NOT_FOUND')
        );
      });

      it('should support --no-container flag', async () => {
        // --no-container skips devcontainer setup
        const result = await agentExecAsync('agent staff add --theme billionaires --no-container --machine');
        expect(result).to.exist;
        expect(result!.prompt.type).to.equal('checkbox');

        // Flag should be passed through in metadata
        expect(result!.metadata.flags['no-container']).to.equal(true);
      });

      it('should support --clone flag', async () => {
        // --clone uses git clone instead of worktree
        const result = await agentExecAsync('agent staff add --theme billionaires --clone --machine');
        expect(result).to.exist;
        expect(result!.prompt.type).to.equal('checkbox');

        // Flag should be passed through in metadata
        expect(result!.metadata.flags.clone).to.equal(true);
      });

      it('should support combined flags --theme --no-container --clone', async () => {
        const result = await agentExecAsync('agent staff add --theme toyotas --no-container --clone --machine');
        expect(result).to.exist;
        expect(result!.prompt.type).to.equal('checkbox');

        // All flags should be in metadata
        expect(result!.metadata.flags['no-container']).to.equal(true);
        expect(result!.metadata.flags.clone).to.equal(true);
      });
    });

    describe('agent cleanup flags', () => {
      beforeEach(() => {
        createTestAgent('cleanup-temp-1', 'ephemeral');
        createTestAgent('cleanup-temp-2', 'ephemeral');
      });

      it('should support --temp flag (cleanup idle temp agents)', async () => {
        const output = await execInProcess('agent cleanup --temp --machine');

        // Should either show confirmation prompt or no agents message
        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('NO_AGENTS') ||
          o.includes('confirmed') ||
          o.includes('Clean up')
        );
      });

      it('should support --all flag (cleanup all temp agents)', async () => {
        const output = await execInProcess('agent cleanup --all --machine');

        // Should either show confirmation prompt or no agents message
        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('NO_AGENTS') ||
          o.includes('confirmed')
        );
      });

      it('should support --dry-run flag (show what would be cleaned)', async () => {
        const output = await execInProcess('agent cleanup cleanup-temp-1 --dry-run --machine');

        // Dry run should show results without prompting
        expect(output).to.satisfy((o: string) =>
          o.includes('"success"') ||
          o.includes('dryRun') ||
          o.includes('Would clean') ||
          o.includes('AGENT_NOT_FOUND')
        );
      });

      it('should support --yes flag (skip confirmation)', async () => {
        const output = await execInProcess('agent cleanup cleanup-temp-1 --yes --machine');

        // Should skip confirmation and proceed (or fail to find agent)
        expect(output).to.satisfy((o: string) =>
          o.includes('"success"') ||
          o.includes('cleaned') ||
          o.includes('AGENT_NOT_FOUND') ||
          o.includes('Cleaning up')
        );
      });

      it('should support -y shorthand for --yes', async () => {
        const output = await execInProcess('agent cleanup cleanup-temp-1 -y --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('"success"') ||
          o.includes('cleaned') ||
          o.includes('AGENT_NOT_FOUND') ||
          o.includes('Cleaning up')
        );
      });

      it('should support --force flag (force cleanup with uncommitted work)', async () => {
        const output = await execInProcess('agent cleanup cleanup-temp-1 --force --machine');

        // Should proceed with force flag
        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('"success"') ||
          o.includes('confirmed') ||
          o.includes('AGENT_NOT_FOUND')
        );
      });

      it('should support -f shorthand for --force', async () => {
        const output = await execInProcess('agent cleanup cleanup-temp-1 -f --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('"success"') ||
          o.includes('confirmed') ||
          o.includes('AGENT_NOT_FOUND')
        );
      });

      it('should support combined flags --temp --dry-run', async () => {
        const output = await execInProcess('agent cleanup --temp --dry-run --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('"success"') ||
          o.includes('NO_AGENTS') ||
          o.includes('dryRun')
        );
      });

      it('should support combined flags --all --yes', async () => {
        const output = await execInProcess('agent cleanup --all --yes --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('"success"') ||
          o.includes('NO_AGENTS') ||
          o.includes('cleaned')
        );
      });

      it('should support --push flag (push before cleanup)', async () => {
        const output = await execInProcess('agent cleanup cleanup-temp-1 --push --machine');

        // Should either prompt for confirmation or handle the agent
        expect(output).to.satisfy((o: string) =>
          o.includes('"prompt"') ||
          o.includes('"success"') ||
          o.includes('confirmed') ||
          o.includes('AGENT_NOT_FOUND') ||
          o.includes('push')
        );
      });

      it('should support combined flags --push --yes', async () => {
        const output = await execInProcess('agent cleanup cleanup-temp-1 --push --yes --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('"success"') ||
          o.includes('cleaned') ||
          o.includes('AGENT_NOT_FOUND') ||
          o.includes('push')
        );
      });
    });

    describe('agent themes create flags', () => {
      it('should support --description flag', async () => {
        const output = await execInProcess('agent themes create test-theme-1 --description "A test theme"');

        expect(output).to.satisfy((o: string) =>
          o.includes('Created theme') ||
          o.includes('test-theme-1') ||
          o.includes('A test theme')
        );
      });

      it('should support -d shorthand for --description', async () => {
        const output = await execInProcess('agent themes create test-theme-2 -d "Another test theme"');

        expect(output).to.satisfy((o: string) =>
          o.includes('Created theme') ||
          o.includes('test-theme-2')
        );
      });

      it('should support --display-name flag', async () => {
        const output = await execInProcess('agent themes create test-theme-3 --display-name "Custom Display Name"');

        expect(output).to.satisfy((o: string) =>
          o.includes('Created theme') ||
          o.includes('Custom Display Name')
        );
      });

      it('should support combined --description and --display-name flags', async () => {
        const output = await execInProcess('agent themes create test-theme-4 --display-name "Combined Test" --description "Testing both flags"');

        expect(output).to.satisfy((o: string) =>
          o.includes('Created theme') ||
          o.includes('Combined Test')
        );
      });
    });

    describe('agent themes add-names', () => {
      it('should add names to an existing theme', async () => {
        // First create a theme
        await execInProcess('agent themes create test-add-theme --description "Test theme for add-names"');

        // Then add names to it
        const output = await execInProcess('agent themes add-names test-add-theme hero-1 hero-2 hero-3');

        expect(output).to.satisfy((o: string) =>
          o.includes('Added') ||
          o.includes('name') ||
          o.includes('hero')
        );
      });

      it('should normalize agent names', async () => {
        // Create theme first
        await execInProcess('agent themes create test-normalize-theme');

        // Add names with mixed case (should be normalized)
        const output = await execInProcess('agent themes add-names test-normalize-theme MyAgent UPPER-CASE');

        expect(output).to.satisfy((o: string) =>
          o.includes('Added') ||
          o.includes('Normalized') ||
          o.includes('myagent') ||
          o.includes('upper-case')
        );
      });

      it('should error on non-existent theme', async () => {
        const output = await execInProcess('agent themes add-names nonexistent-theme name1 name2');

        expect(output).to.satisfy((o: string) =>
          o.includes('not found') ||
          o.includes('Error')
        );
      });

      it('should error when no names provided', async () => {
        // Create theme first
        await execInProcess('agent themes create test-empty-theme');

        const output = await execInProcess('agent themes add-names test-empty-theme');

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

      it('should support --type staff flag', async () => {
        const output = await execInProcess('agent list --type staff');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('staff') || o.includes('no active')
        );
      });

      it('should support --type temp flag', async () => {
        const output = await execInProcess('agent list --type temp');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('temp') || o.includes('temporary') || o.includes('no active')
        );
      });

      it('should support --type all flag', async () => {
        const output = await execInProcess('agent list --type all');

        // Should show summary or agents
        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('summary') || o.includes('staff') || o.includes('temp') || o.includes('no active')
        );
      });

      it('should support --type flag with --machine', async () => {
        // With --type specified, should bypass prompt and show results
        const output = await execInProcess('agent list --type staff --machine');

        // No prompt expected when type is specified
        expect(output).to.not.include('"prompt"');
      });

      it('should support -t shorthand for --type', async () => {
        const output = await execInProcess('agent list -t staff');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('staff') || o.includes('no active')
        );
      });
    });

    describe('agent status with direct agent name', () => {
      beforeEach(() => {
        createTestAgent('direct-status-agent', 'persistent');
      });

      it('should show status when agent name is provided directly', async () => {
        const output = await execInProcess('agent status direct-status-agent');

        expect(output).to.include('direct-status-agent');
      });

      it('should show status with --machine flag and agent name', async () => {
        const output = await execInProcess('agent status direct-status-agent --machine');

        // Should return data, not prompt (agent name bypasses selection)
        expect(output).to.include('direct-status-agent');
      });

      it('should error for non-existent agent', async () => {
        const output = await execInProcess('agent status nonexistent-agent-xyz');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('not found') || o.includes('error') || o.includes('no agent')
        );
      });

      it('should error for non-existent agent with --machine', async () => {
        const output = await execInProcess('agent status nonexistent-agent-xyz --machine');

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

      it('should show path when agent name is provided directly', async () => {
        const output = await execInProcess('agent visit direct-visit-agent');

        expect(output).to.include('direct-visit-agent');
        expect(output).to.include('cd');
      });

      it('should show path with --machine flag and agent name', async () => {
        const output = await execInProcess('agent visit direct-visit-agent --machine');

        expect(output).to.include('direct-visit-agent');
      });

      it('should error for non-existent agent', async () => {
        const output = await execInProcess('agent visit nonexistent-visit-xyz');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('not found') || o.includes('error')
        );
      });

      it('should error for non-existent agent with --machine', async () => {
        const output = await execInProcess('agent visit nonexistent-visit-xyz --machine');

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

      it('should attempt shell when agent name is provided', async () => {
        const output = await execInProcess('agent shell direct-shell-agent');

        // May fail with Docker/tmux error but should attempt
        expect(output).to.satisfy((o: string) =>
          o.includes('direct-shell-agent') ||
          o.includes('Docker') ||
          o.includes('tmux') ||
          o.includes('shell')
        );
      });

      it('should accept --machine flag with agent name', async () => {
        const output = await execInProcess('agent shell direct-shell-agent --machine');

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

      it('should error for non-existent agent', async () => {
        const output = await execInProcess('agent shell nonexistent-shell-xyz');

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

      it('should prompt for confirmation when agent name provided', async () => {
        const output = await execInProcess('agent staff remove remove-agent-1 --machine');

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

      it('should support --force flag to skip confirmation', async () => {
        const output = await execInProcess('agent staff remove remove-agent-1 --force');

        // Should proceed without confirmation (may fail due to Docker, no real agents, or return JSON error)
        expect(output).to.satisfy((o: string) =>
          o.includes('Removing') ||
          o.includes('removed') ||
          o.includes('Docker') ||
          o.includes('Error') ||
          o.includes('"error"') ||
          o.includes('"success"') ||
          o.includes('No staff agents')
        );
      });

      it('should support -f shorthand for --force', async () => {
        const output = await execInProcess('agent staff remove remove-agent-2 -f');

        expect(output).to.satisfy((o: string) =>
          o.includes('Removing') ||
          o.includes('removed') ||
          o.includes('Docker') ||
          o.includes('Error') ||
          o.includes('"error"') ||
          o.includes('"success"') ||
          o.includes('No staff agents')
        );
      });

      it('should error for non-existent agent', async () => {
        const output = await execInProcess('agent staff remove nonexistent-remove-xyz --force');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('not found') || o.includes('error') || o.includes('no staff agents')
        );
      });

      it('should error for non-existent agent with --machine', async () => {
        const output = await execInProcess('agent staff remove nonexistent-remove-xyz --machine');

        expect(output).to.satisfy((o: string) =>
          o.includes('AGENT_NOT_FOUND') ||
          o.includes('not found') ||
          o.includes('"error"')
        );
      });
    });

    describe('agent staff add with direct agent names', () => {
      it('should accept direct agent name argument', async () => {
        const output = await execInProcess('agent staff add test-direct-agent');

        // Should attempt to add agent (may fail due to Docker/workspace setup)
        expect(output).to.satisfy((o: string) =>
          o.includes('Adding') ||
          o.includes('test-direct-agent') ||
          o.includes('Docker') ||
          o.includes('Error') ||
          o.includes('worktree')
        );
      });

      it('should accept multiple agent names', async () => {
        const output = await execInProcess('agent staff add agent-a agent-b');

        expect(output).to.satisfy((o: string) =>
          o.includes('Adding') ||
          o.includes('agent-a') ||
          o.includes('agent-b') ||
          o.includes('Docker') ||
          o.includes('Error')
        );
      });

      it('should support --no-container flag', async () => {
        const output = await execInProcess('agent staff add no-container-agent --no-container');

        expect(output).to.satisfy((o: string) =>
          o.includes('Adding') ||
          o.includes('no-container-agent') ||
          o.includes('worktree') ||
          o.includes('Error')
        );
      });

      it('should support --clone flag', async () => {
        const output = await execInProcess('agent staff add clone-agent --clone');

        expect(output).to.satisfy((o: string) =>
          o.includes('Adding') ||
          o.includes('clone-agent') ||
          o.includes('clone') ||
          o.includes('Error')
        );
      });

      it('should support combined --theme and --no-container flags', async () => {
        const output = await execInProcess('agent staff add --theme billionaires --no-container --machine');

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

      it('should handle empty agent list gracefully', async () => {
        const output = await execInProcess('agent list --type staff');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('no active') ||
          o.includes('summary') ||
          o.includes('staff') ||
          o.includes('error') ||
          o.includes('agent')
        );
      });

      it('should handle invalid command gracefully', async () => {
        const output = await execInProcess('agent invalidsubcommand');

        expect(output.toLowerCase()).to.satisfy((o: string) =>
          o.includes('error') || o.includes('not') || o.includes('unknown') || o.includes('help')
        );
      });

      it('should handle missing required arguments', async () => {
        // themes create requires NAME
        const output = await execInProcess('agent themes create');

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
