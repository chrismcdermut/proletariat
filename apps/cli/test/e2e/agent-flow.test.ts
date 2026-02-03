/**
 * E2E tests for agent namespace commands with --machine flag support.
 *
 * These tests verify that agent commands properly output JSON prompts
 * when invoked with --machine, allowing AI agents to navigate through
 * the CLI programmatically.
 */
import { expect } from 'chai';
import {
  agentExec,
  findChoice,
  execChoice,
  hasContextError,
  execProduction,
  AgentPromptResponse,
} from './test-helpers.js';

describe('Agent Flow E2E (--machine flag)', () => {
  // Agent commands may require workspace context

  describe('agent index', () => {
    it('should output JSON prompt with --machine flag', () => {
      const result = agentExec('agent --machine');

      // If no workspace, we might get a context error
      if (!result) {
        // Skip - no workspace context
        return;
      }

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('like to do');
      expect(result.prompt.choices).to.be.an('array');

      // Verify key choices have command fields
      const listChoice = findChoice(result.prompt.choices, 'List');
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('prlt agent list --machine');

      const statusChoice = findChoice(result.prompt.choices, 'status');
      expect(statusChoice).to.exist;
      expect(statusChoice!.command).to.include('prlt agent status --machine');

      const shellChoice = findChoice(result.prompt.choices, 'shell');
      expect(shellChoice).to.exist;
      expect(shellChoice!.command).to.include('prlt agent shell --machine');
    });

    it('should include metadata in JSON response', () => {
      const result = agentExec('agent --machine');

      if (!result) return;

      expect(result.metadata).to.exist;
      expect(result.metadata.command).to.equal('agent');
    });
  });

  describe('agent list', () => {
    it('should output JSON prompt with --machine flag when no type specified', () => {
      const result = agentExec('agent list --machine');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('agents');

      // Should have type filter choices
      const allChoice = findChoice(result.prompt.choices, 'All');
      expect(allChoice).to.exist;
      expect(allChoice!.command).to.include('--type all --machine');

      const staffChoice = findChoice(result.prompt.choices, 'Staff');
      expect(staffChoice).to.exist;
      expect(staffChoice!.command).to.include('--type staff --machine');

      const tempChoice = findChoice(result.prompt.choices, 'Temp');
      expect(tempChoice).to.exist;
      expect(tempChoice!.command).to.include('--type temp --machine');
    });

    it('should bypass prompt when --type is specified', () => {
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

  describe('agent status', () => {
    it('should output JSON prompt with --machine flag when no agent specified', () => {
      const result = agentExec('agent status --machine');

      // If no agents, might get error
      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('status');

      // Choices should have command field with --machine
      if (result.prompt.choices.length > 0) {
        const firstChoice = result.prompt.choices[0];
        expect(firstChoice.command).to.include('--machine');
        expect(firstChoice.command).to.include('prlt agent status');
      }
    });
  });

  describe('agent visit', () => {
    it('should output JSON prompt with --machine flag when no agent specified', () => {
      const result = agentExec('agent visit --machine');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('visit');

      // Choices should have command field with --machine
      if (result.prompt.choices.length > 0) {
        const firstChoice = result.prompt.choices[0];
        expect(firstChoice.command).to.include('--machine');
        expect(firstChoice.command).to.include('prlt agent visit');
      }
    });
  });

  describe('agent shell', () => {
    it('should output JSON prompt with --machine flag when no agent specified', () => {
      const result = agentExec('agent shell --machine');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('shell');

      // Choices should have command field with --machine
      if (result.prompt.choices.length > 0) {
        const firstChoice = result.prompt.choices[0];
        expect(firstChoice.command).to.include('--machine');
        expect(firstChoice.command).to.include('prlt agent shell');
      }
    });
  });

  describe('agent login', () => {
    it('should output JSON prompt with --machine flag when no agent specified', () => {
      const result = agentExec('agent login --machine');

      // Might fail if Docker not running
      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('authenticate');

      // Choices should have command field with --machine
      if (result.prompt.choices.length > 0) {
        const firstChoice = result.prompt.choices[0];
        expect(firstChoice.command).to.include('--machine');
        expect(firstChoice.command).to.include('prlt agent login');
      }
    });
  });

  describe('agent restart', () => {
    it('should output JSON prompt with --machine flag when no agent specified', () => {
      const result = agentExec('agent restart --machine');

      // Might fail if Docker not running
      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('restart');

      // Choices should have command field with --machine
      if (result.prompt.choices.length > 0) {
        const firstChoice = result.prompt.choices[0];
        expect(firstChoice.command).to.include('--machine');
        expect(firstChoice.command).to.include('prlt agent restart');
      }
    });
  });

  describe('agent rebuild', () => {
    it('should output JSON prompt with --machine flag when no agent specified', () => {
      const result = agentExec('agent rebuild --machine');

      // Might fail if Docker not running
      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('rebuild');

      // Choices should have command field with --machine
      if (result.prompt.choices.length > 0) {
        const firstChoice = result.prompt.choices[0];
        expect(firstChoice.command).to.include('--machine');
        expect(firstChoice.command).to.include('prlt agent rebuild');
      }
    });
  });

  describe('agent themes', () => {
    it('should output JSON prompt with --machine flag', () => {
      const result = agentExec('agent themes --machine');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('like to do');

      // Check for key choices
      const listChoice = findChoice(result.prompt.choices, 'List');
      expect(listChoice).to.exist;

      const createChoice = findChoice(result.prompt.choices, 'Create');
      expect(createChoice).to.exist;
      expect(createChoice!.command).to.include('--machine');
    });
  });

  describe('agent staff', () => {
    it('should output JSON prompt with --machine flag', () => {
      const result = agentExec('agent staff --machine');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('like to do');

      // Check for key choices
      const listChoice = findChoice(result.prompt.choices, 'List');
      expect(listChoice).to.exist;

      const addChoice = findChoice(result.prompt.choices, 'Add');
      expect(addChoice).to.exist;
    });
  });

  describe('legacy --json flag support', () => {
    it('should work with deprecated --json flag', () => {
      const result = agentExec('agent --json');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
      // Should work the same as --machine
    });

    it('agent list should work with deprecated --json flag', () => {
      const result = agentExec('agent list --json');

      if (!result) return;

      expect(result.prompt).to.exist;
      expect(result.prompt.type).to.equal('list');
    });
  });
});

describe('Agent Flow Navigation', () => {

  describe('agent index -> list flow', () => {
    it('should navigate from index to list command', () => {
      // Step 1: Get agent index menu
      const step1 = agentExec('agent --machine');
      if (!step1) return;

      // Find the list choice
      const listChoice = findChoice(step1.prompt.choices, 'List');
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.exist;

      // Step 2: Execute the list command
      const step2Cmd = execChoice(listChoice!);
      expect(step2Cmd).to.include('agent list');
      expect(step2Cmd).to.include('--machine');

      // Execute and verify we get next prompt
      const step2 = agentExec(step2Cmd);
      if (!step2) return;

      expect(step2.prompt).to.exist;
      expect(step2.prompt.type).to.equal('list');
    });
  });

  describe('agent index -> status flow', () => {
    it('should navigate from index to status command', () => {
      // Step 1: Get agent index menu
      const step1 = agentExec('agent --machine');
      if (!step1) return;

      // Find the status choice
      const statusChoice = findChoice(step1.prompt.choices, 'status');
      expect(statusChoice).to.exist;
      expect(statusChoice!.command).to.exist;

      // Step 2: Execute the status command
      const step2Cmd = execChoice(statusChoice!);
      expect(step2Cmd).to.include('agent status');
      expect(step2Cmd).to.include('--machine');
    });
  });

  describe('agent index -> shell flow', () => {
    it('should navigate from index to shell command', () => {
      // Step 1: Get agent index menu
      const step1 = agentExec('agent --machine');
      if (!step1) return;

      // Find the shell choice
      const shellChoice = findChoice(step1.prompt.choices, 'shell');
      expect(shellChoice).to.exist;
      expect(shellChoice!.command).to.exist;

      // Step 2: Execute the shell command
      const step2Cmd = execChoice(shellChoice!);
      expect(step2Cmd).to.include('agent shell');
      expect(step2Cmd).to.include('--machine');
    });
  });
});
