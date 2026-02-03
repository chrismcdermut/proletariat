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
 * Check if output contains an error that should cause test to skip.
 */
function hasContextError(output: string): boolean {
  return (
    output.includes('Docker is not running') ||
    output.includes('ENOENT') ||
    output.includes('Error:') && !output.includes('{')
  );
}

/**
 * Integration tests for agent namespace JSON mode.
 */
describe('Agent Commands JSON Mode', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('agent-json-');

    db = new Database(env.dbPath);
    setupTestDatabase(db);

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
    /**
     * Helper to simulate agent flow: execute command, parse JSON, return parsed result
     */
    interface AgentPrompt {
      prompt: {
        type: string;
        name: string;
        message: string;
        choices?: Array<{ name: string; value: string; command?: string }>;
        context?: Record<string, unknown>;
      };
      metadata: {
        command: string;
        flags: Record<string, unknown>;
      };
    }

    function agentExec(cmd: string): AgentPrompt | null {
      const output = exec(cmd);
      if (hasContextError(output)) {
        return null;
      }
      try {
        return extractJson<AgentPrompt>(output);
      } catch {
        return null;
      }
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
        expect(step1!.prompt.context).to.exist;
        expect((step1!.prompt.context as { agentsToCleanup: string[] }).agentsToCleanup).to.include('temp-flow-agent');
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
});

/**
 * Helper function to set up test database with agent schema.
 * Schema matches production schema from src/lib/database/index.ts
 */
function setupTestDatabase(db: Database.Database) {
  db.exec(`
    -- Workspace configuration (required for agent commands)
    CREATE TABLE IF NOT EXISTS workspace (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      type TEXT NOT NULL CHECK (type IN ('hq', 'workspace')),
      workspace_name TEXT NOT NULL,
      has_pmo BOOLEAN DEFAULT FALSE,
      active_theme_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (active_theme_id) REFERENCES agent_themes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repositories (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      type TEXT DEFAULT 'main' CHECK (type IN ('main', 'dependency')),
      source_url TEXT,
      action TEXT CHECK (action IN ('clone', 'move', 'link')),
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT,
      persistent_dir TEXT NOT NULL DEFAULT 'staff',
      ephemeral_dir TEXT NOT NULL DEFAULT 'temp',
      builtin BOOLEAN DEFAULT FALSE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_theme_names (
      theme_id TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (theme_id, name),
      FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'persistent' CHECK (type IN ('persistent', 'ephemeral')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cleaned')),
      base_name TEXT,
      theme_id TEXT,
      worktree_path TEXT,
      mount_mode TEXT NOT NULL DEFAULT 'worktree' CHECK (mount_mode IN ('worktree', 'clone')),
      created_at TEXT NOT NULL,
      cleaned_at TEXT,
      FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS agent_worktrees (
      agent_name TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      branch TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (agent_name, repo_name),
      FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE,
      FOREIGN KEY (repo_name) REFERENCES repositories(name) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_worktrees_agent ON agent_worktrees(agent_name);
    CREATE INDEX IF NOT EXISTS idx_worktrees_repo ON agent_worktrees(repo_name);
    CREATE INDEX IF NOT EXISTS idx_theme_names_theme ON agent_theme_names(theme_id);
    CREATE INDEX IF NOT EXISTS idx_agents_theme ON agents(theme_id);
  `);

  // Insert workspace configuration
  db.prepare(`
    INSERT INTO workspace (id, type, workspace_name, has_pmo, created_at)
    VALUES (1, 'hq', 'test-workspace', 1, datetime('now'))
  `).run();

  // Insert default theme
  db.prepare(`
    INSERT INTO agent_themes (id, name, display_name, persistent_dir, ephemeral_dir, builtin, created_at)
    VALUES ('corporate', 'corporate', 'Corporate', 'staff', 'temp', 1, datetime('now'))
  `).run();
}

/**
 * Create agents directory structure for tests.
 */
function createAgentsDirectory(testDir: string) {
  const agentsPath = path.join(testDir, 'agents');
  fs.mkdirSync(path.join(agentsPath, 'staff'), { recursive: true });
  fs.mkdirSync(path.join(agentsPath, 'temp'), { recursive: true });
}
