/**
 * E2E tests for agent namespace commands with --machine/--json flag support.
 *
 * These tests verify that agent commands properly output JSON prompts
 * when invoked with --machine or --json, allowing AI agents to navigate
 * through the CLI programmatically.
 *
 * Test categories:
 * 1. JSON output format validation
 * 2. --machine flag support (new semantic name)
 * 3. Flag accumulation in choice commands
 * 4. End-to-end agent navigation flows
 *
 * Note: Run with --timeout 30000 to prevent hanging:
 *   pnpm test -- --grep "Agent Commands JSON Mode" --timeout 30000
 */
import { expect } from 'chai';
import {
  agentExec,
  findChoice,
  execChoice,
  hasContextError,
  execProduction,
} from './test-helpers.js';

/**
 * Extract JSON from CLI output that may contain warnings or other noise.
 */
function extractJson<T>(output: string): T | null {
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
    return null;
  }

  const jsonLines = lines.slice(jsonStart).join('\n');
  try {
    return JSON.parse(jsonLines) as T;
  } catch {
    return null;
  }
}

describe('Agent Commands JSON Mode', () => {

  describe('JSON Output Format', () => {

    it('should output valid JSON with prompt schema for agent index', () => {
      const result = agentExec('agent --machine');

      if (!result) {
        // Skip - no workspace context or Docker not running
        return;
      }

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.name).to.be.a('string');
      expect(result.prompt.message).to.be.a('string');
      expect(result.prompt.choices).to.be.an('array');
      expect(result.metadata).to.exist;
      expect(result.metadata.command).to.equal('agent');
    });

    it('should output valid JSON with prompt schema for agent list', () => {
      const result = agentExec('agent list --machine');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.choices).to.be.an('array');
      expect(result.metadata).to.exist;
    });

    it('should output valid JSON with prompt schema for agent status', () => {
      const result = agentExec('agent status --machine');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.metadata).to.exist;
    });

    it('should output valid JSON with prompt schema for agent visit', () => {
      const result = agentExec('agent visit --machine');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.metadata).to.exist;
    });

    it('should output valid JSON with prompt schema for agent shell', () => {
      const result = agentExec('agent shell --machine');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.metadata).to.exist;
    });

    it('should output valid JSON with prompt schema for agent login', () => {
      const result = agentExec('agent login --machine');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.metadata).to.exist;
    });

    it('should output valid JSON with prompt schema for agent restart', () => {
      const result = agentExec('agent restart --machine');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.metadata).to.exist;
    });

    it('should output valid JSON with prompt schema for agent rebuild', () => {
      const result = agentExec('agent rebuild --machine');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.metadata).to.exist;
    });
  });

  describe('--machine Flag Support', () => {

    it('should recognize --machine flag for agent index', () => {
      const output = execProduction('agent --machine');

      if (hasContextError(output)) return;

      const json = extractJson<{ metadata: { flags: { machine: boolean } } }>(output);
      expect(json).to.exist;
      expect(json!.metadata.flags.machine).to.equal(true);
    });

    it('should recognize -m shorthand flag', () => {
      const output = execProduction('agent -m');

      if (hasContextError(output)) return;

      const json = extractJson<{ metadata: { flags: { machine: boolean } } }>(output);
      expect(json).to.exist;
      expect(json!.metadata.flags.machine).to.equal(true);
    });

    it('should work with --machine flag for agent list', () => {
      const output = execProduction('agent list --machine');

      if (hasContextError(output)) return;

      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);
      expect(json).to.exist;
      expect(json!.prompt).to.exist;
    });

    it('should work with --machine flag for agent status', () => {
      const output = execProduction('agent status --machine');

      if (hasContextError(output)) return;

      // May get prompt JSON or error JSON if no agents
      const json = extractJson<{ prompt?: { type: string }; error?: { code: string } }>(output);

      // If no JSON found, that's a context error - skip
      if (!json) return;

      // Should have either prompt or error
      expect(json.prompt !== undefined || json.error !== undefined).to.be.true;
    });

    it('should work with --machine flag for agent auth --check', () => {
      const output = execProduction('agent auth --check --machine');

      if (hasContextError(output)) return;

      const json = extractJson<{ success?: boolean; error?: { code: string } }>(output);
      // Should output either success or error JSON
      expect(json).to.exist;
      expect(json!.success === true || json!.error !== undefined).to.be.true;
    });

    it('should work with --machine flag for agent discover', () => {
      const output = execProduction('agent discover --machine');

      if (hasContextError(output)) return;

      const json = extractJson<{ success?: boolean; error?: { code: string } }>(output);
      expect(json).to.exist;
    });
  });

  describe('Flag Accumulation in Choices', () => {

    it('should include --machine flag in choice commands for agent index', () => {
      const result = agentExec('agent --machine');

      if (!result) return;

      // All choices should have command field with --machine
      for (const choice of result.prompt.choices) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command).to.include('--machine');
          expect(choice.command).to.include('prlt agent');
        }
      }
    });

    it('should include --machine flag in choice commands for agent list', () => {
      const result = agentExec('agent list --machine');

      if (!result) return;

      for (const choice of result.prompt.choices) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command).to.include('--machine');
        }
      }
    });

    it('should include --machine flag in choice commands for agent status', () => {
      const result = agentExec('agent status --machine');

      if (!result) return;

      for (const choice of result.prompt.choices) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command).to.include('--machine');
          expect(choice.command).to.include('prlt agent status');
        }
      }
    });

    it('should include --machine flag in choice commands for agent visit', () => {
      const result = agentExec('agent visit --machine');

      if (!result) return;

      for (const choice of result.prompt.choices) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command).to.include('--machine');
          expect(choice.command).to.include('prlt agent visit');
        }
      }
    });

    it('should include --machine flag in choice commands for agent shell', () => {
      const result = agentExec('agent shell --machine');

      if (!result) return;

      for (const choice of result.prompt.choices) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command).to.include('--machine');
          expect(choice.command).to.include('prlt agent shell');
        }
      }
    });

    it('should include --machine flag in choice commands for agent login', () => {
      const result = agentExec('agent login --machine');

      if (!result) return;

      for (const choice of result.prompt.choices) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command).to.include('--machine');
          expect(choice.command).to.include('prlt agent login');
        }
      }
    });

    it('should include --machine flag in choice commands for agent restart', () => {
      const result = agentExec('agent restart --machine');

      if (!result) return;

      for (const choice of result.prompt.choices) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command).to.include('--machine');
          expect(choice.command).to.include('prlt agent restart');
        }
      }
    });

    it('should include --machine flag in choice commands for agent rebuild', () => {
      const result = agentExec('agent rebuild --machine');

      if (!result) return;

      for (const choice of result.prompt.choices) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command).to.include('--machine');
          expect(choice.command).to.include('prlt agent rebuild');
        }
      }
    });
  });

  describe('Legacy --json Flag Support', () => {

    it('should work with deprecated --json flag for agent index', () => {
      const result = agentExec('agent --json');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
    });

    it('should work with deprecated --json flag for agent list', () => {
      const result = agentExec('agent list --json');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
    });

    it('should produce same structure with --json and --machine', () => {
      const jsonResult = agentExec('agent --json');
      const machineResult = agentExec('agent --machine');

      if (!jsonResult || !machineResult) return;

      // Same prompt structure
      expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type);
      expect(machineResult.prompt.name).to.equal(jsonResult.prompt.name);
      expect(machineResult.prompt.choices.length).to.equal(jsonResult.prompt.choices.length);
    });

    it('should work with deprecated --json flag for agent auth', () => {
      const output = execProduction('agent auth --check --json');

      if (hasContextError(output)) return;

      const json = extractJson<{ success?: boolean; error?: { code: string } }>(output);
      expect(json).to.exist;
    });

    it('should work with deprecated --json flag for agent discover', () => {
      const output = execProduction('agent discover --json');

      if (hasContextError(output)) return;

      const json = extractJson<{ success?: boolean; error?: { code: string } }>(output);
      expect(json).to.exist;
    });
  });

  describe('End-to-End Agent Flows', () => {

    it('should navigate from agent index to list command', () => {
      // Step 1: Get agent index menu
      const step1 = agentExec('agent --machine');
      if (!step1) return;

      // Find the list choice
      const listChoice = findChoice(step1.prompt.choices, 'List');
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.exist;

      // Step 2: Verify the command is properly formatted
      const step2Cmd = execChoice(listChoice!);
      expect(step2Cmd).to.include('agent list');
      expect(step2Cmd).to.include('--machine');

      // Step 3: Execute and verify we get next prompt
      const step2 = agentExec(step2Cmd);
      if (!step2) {
        // No agents available, which is valid
        return;
      }

      expect(step2.prompt).to.exist;
      expect(step2.prompt.type).to.equal('list');
    });

    it('should navigate from agent index to status command', () => {
      // Step 1: Get agent index menu
      const step1 = agentExec('agent --machine');
      if (!step1) return;

      // Find the status choice
      const statusChoice = findChoice(step1.prompt.choices, 'status');
      expect(statusChoice).to.exist;
      expect(statusChoice!.command).to.exist;

      // Step 2: Verify the command is properly formatted
      const step2Cmd = execChoice(statusChoice!);
      expect(step2Cmd).to.include('agent status');
      expect(step2Cmd).to.include('--machine');
    });

    it('should navigate from agent index to shell command', () => {
      // Step 1: Get agent index menu
      const step1 = agentExec('agent --machine');
      if (!step1) return;

      // Find the shell choice
      const shellChoice = findChoice(step1.prompt.choices, 'shell');
      expect(shellChoice).to.exist;
      expect(shellChoice!.command).to.exist;

      // Step 2: Verify the command is properly formatted
      const step2Cmd = execChoice(shellChoice!);
      expect(step2Cmd).to.include('agent shell');
      expect(step2Cmd).to.include('--machine');
    });

    it('should navigate from agent index to visit command', () => {
      // Step 1: Get agent index menu
      const step1 = agentExec('agent --machine');
      if (!step1) return;

      // Find the visit choice
      const visitChoice = findChoice(step1.prompt.choices, 'Visit');
      expect(visitChoice).to.exist;
      expect(visitChoice!.command).to.exist;

      // Step 2: Verify the command is properly formatted
      const step2Cmd = execChoice(visitChoice!);
      expect(step2Cmd).to.include('agent visit');
      expect(step2Cmd).to.include('--machine');
    });

    it('should navigate from agent index to restart command', () => {
      // Step 1: Get agent index menu
      const step1 = agentExec('agent --machine');
      if (!step1) return;

      // Find the restart choice
      const restartChoice = findChoice(step1.prompt.choices, 'Restart');
      expect(restartChoice).to.exist;
      expect(restartChoice!.command).to.exist;

      // Step 2: Verify the command is properly formatted
      const step2Cmd = execChoice(restartChoice!);
      expect(step2Cmd).to.include('agent restart');
      expect(step2Cmd).to.include('--machine');
    });

    it('should navigate from agent index to rebuild command', () => {
      // Step 1: Get agent index menu
      const step1 = agentExec('agent --machine');
      if (!step1) return;

      // Find the rebuild choice
      const rebuildChoice = findChoice(step1.prompt.choices, 'Rebuild');
      expect(rebuildChoice).to.exist;
      expect(rebuildChoice!.command).to.exist;

      // Step 2: Verify the command is properly formatted
      const step2Cmd = execChoice(rebuildChoice!);
      expect(step2Cmd).to.include('agent rebuild');
      expect(step2Cmd).to.include('--machine');
    });

    it('should navigate from agent index to discover command', () => {
      // Step 1: Get agent index menu
      const step1 = agentExec('agent --machine');
      if (!step1) return;

      // Find the discover choice
      const discoverChoice = findChoice(step1.prompt.choices, 'Discover');
      expect(discoverChoice).to.exist;
      expect(discoverChoice!.command).to.exist;

      // Step 2: Verify the command is properly formatted
      const step2Cmd = execChoice(discoverChoice!);
      expect(step2Cmd).to.include('agent discover');
      expect(step2Cmd).to.include('--machine');
    });

    it('should navigate agent list type filter flow', () => {
      // Step 1: Get agent list type filter menu
      const step1 = agentExec('agent list --machine');
      if (!step1) return;

      // Should have type filter choices
      const allChoice = findChoice(step1.prompt.choices, 'All');
      expect(allChoice).to.exist;
      expect(allChoice!.command).to.include('--type all');
      expect(allChoice!.command).to.include('--machine');

      const staffChoice = findChoice(step1.prompt.choices, 'Staff');
      expect(staffChoice).to.exist;
      expect(staffChoice!.command).to.include('--type staff');
      expect(staffChoice!.command).to.include('--machine');

      const tempChoice = findChoice(step1.prompt.choices, 'Temp');
      expect(tempChoice).to.exist;
      expect(tempChoice!.command).to.include('--type temp');
      expect(tempChoice!.command).to.include('--machine');
    });

    it('should bypass prompt when --type is specified for agent list', () => {
      // When --type is provided, should not prompt
      const output = execProduction('agent list --type all --machine');

      // Should either output data or context error
      // Not a prompt response since type was provided
      if (hasContextError(output)) return;

      // If there are agents, we might get output
      // If no agents, we get a message
      expect(output).to.satisfy((o: string) =>
        o.includes('agents') || o.includes('No active') || o.includes('Staff') || o.includes('{')
      );
    });
  });

  describe('Error Handling in JSON Mode', () => {

    it('should output structured error JSON for agent auth when Docker not running', () => {
      // This test relies on Docker not being available
      // We can't reliably test this without mocking, so we verify the format when it fails
      const output = execProduction('agent auth --check --machine');

      const json = extractJson<{ error?: { code: string; message: string }; success?: boolean }>(output);

      // Should have valid JSON output (either success or error)
      expect(json).to.exist;

      // If error, verify structure
      if (json!.error) {
        expect(json!.error.code).to.be.a('string');
        expect(json!.error.message).to.be.a('string');
      }

      // If success, verify structure
      if (json!.success) {
        expect(json!.success).to.equal(true);
      }
    });

    it('should output structured error JSON for agent discover when not in workspace', () => {
      const output = execProduction('agent discover --machine');

      const json = extractJson<{ error?: { code: string; message: string }; success?: boolean; result?: unknown }>(output);

      // Should have valid JSON output
      expect(json).to.exist;

      // Either error or success with result
      if (json!.error) {
        expect(json!.error.code).to.be.a('string');
        expect(json!.error.message).to.be.a('string');
      } else {
        expect(json!.success).to.equal(true);
        expect(json!.result).to.exist;
      }
    });
  });
});
