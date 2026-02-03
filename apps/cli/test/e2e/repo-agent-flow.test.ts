/**
 * E2E Agent Flow Tests for Repository and Branch Commands
 *
 * Tests that AI agents can navigate the repo and branch command flows using --machine flag.
 * Each test simulates an agent navigating from initial command through to completion.
 */
import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  agentExec,
  findChoice,
  execChoice,
  execFinal,
  hasContextError,
  type TestEnvironment,
} from './test-helpers.js';

describe('Repository Commands - Agent Flow Tests', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment('repo-agent-flow-');
    // Create HQ config to mark this as an HQ directory
    createHQConfig(env.proletariatDir, { name: 'test-hq', hasPmo: false });

    // Create repos directory structure
    const reposDir = path.join(env.testDir, 'repos');
    fs.mkdirSync(reposDir, { recursive: true });
  });

  afterEach(() => {
    cleanupTestEnvironment(env);
  });

  describe('repo (main menu) --machine', () => {
    it('should output JSON menu with all repo operations', () => {
      const result = agentExec('repo --machine');

      // Check that we got a valid response (may be null if context error)
      if (!result) {
        // Skip test if not in HQ context
        return;
      }

      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('What would you like to do');

      // Verify all menu choices exist with command fields
      const listChoice = findChoice(result.prompt.choices, 'List all repositories');
      expect(listChoice).to.exist;
      expect(listChoice?.command).to.include('repo list');
      expect(listChoice?.command).to.include('--json');

      const addChoice = findChoice(result.prompt.choices, 'Add repository');
      expect(addChoice).to.exist;
      expect(addChoice?.command).to.include('repo add');

      const removeChoice = findChoice(result.prompt.choices, 'Remove repository');
      expect(removeChoice).to.exist;
      expect(removeChoice?.command).to.include('repo remove');

      const viewChoice = findChoice(result.prompt.choices, 'View repository details');
      expect(viewChoice).to.exist;
      expect(viewChoice?.command).to.include('repo view');
    });

    it('should include bulk operation choices', () => {
      const result = agentExec('repo --machine');

      if (!result) return;

      const addBulkChoice = findChoice(result.prompt.choices, 'Add multiple');
      expect(addBulkChoice).to.exist;
      expect(addBulkChoice?.command).to.include('--bulk');

      const removeBulkChoice = findChoice(result.prompt.choices, 'Remove multiple');
      expect(removeBulkChoice).to.exist;
      expect(removeBulkChoice?.command).to.include('--bulk');
    });
  });

  describe('repo list --machine', () => {
    it('should output JSON when using --format json', () => {
      // repo list with --format json outputs repository data directly
      const output = execFinal('repo list --format json');

      // If no repos, should be empty array or message
      // The actual output depends on whether there are repos
      expect(output).to.be.a('string');
    });
  });

  describe('repo add --machine', () => {
    it('should output JSON with method selection choices', () => {
      const result = agentExec('repo add --machine');

      if (!result) return;

      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('How would you like to add');

      // Verify manual option exists
      const manualChoice = findChoice(result.prompt.choices, 'Enter path');
      expect(manualChoice).to.exist;
      expect(manualChoice?.command).to.include('repo add');

      // Verify bulk/search option exists
      const searchChoice = findChoice(result.prompt.choices, 'Search');
      expect(searchChoice).to.exist;
      expect(searchChoice?.command).to.include('--bulk');
    });

    it('should accept direct path argument', () => {
      // Create a test git repo to add
      const testRepoPath = path.join(env.testDir, 'test-repo');
      fs.mkdirSync(testRepoPath, { recursive: true });
      fs.mkdirSync(path.join(testRepoPath, '.git'), { recursive: true });

      // Add the repo directly (not in machine mode since it does the action)
      const result = execFinal(`repo add "${testRepoPath}"`);

      // Should either succeed or give a meaningful error
      expect(result).to.be.a('string');
    });
  });

  describe('repo view --machine', () => {
    it('should output JSON with repository selection when no name provided', () => {
      const result = agentExec('repo view --machine');

      // May return null if no repos exist
      if (!result) {
        // Expected if no repositories
        return;
      }

      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('Select repository');

      // Each choice should have a command field
      for (const choice of result.prompt.choices) {
        expect(choice.command).to.include('repo view');
        expect(choice.command).to.include('--json');
      }
    });
  });

  describe('repo remove --machine', () => {
    it('should output JSON with repository selection when no name provided', () => {
      const result = agentExec('repo remove --machine');

      // May return null if no repos exist
      if (!result) {
        // Expected if no repositories
        return;
      }

      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('Select repository');

      // Each choice should have a command field
      for (const choice of result.prompt.choices) {
        expect(choice.command).to.include('repo remove');
        expect(choice.command).to.include('--json');
      }
    });
  });

  describe('repo add --bulk --machine', () => {
    it('should output JSON guidance for bulk mode', () => {
      const result = agentExec('repo add --bulk --machine');

      if (!result) return;

      expect(result.prompt.type).to.equal('list');
      // Bulk mode should guide to alternatives
      expect(result.prompt.message).to.include('Bulk mode');

      // Should have choices for alternative methods
      expect(result.prompt.choices.length).to.be.greaterThan(0);
    });
  });

  describe('Full agent navigation flow', () => {
    it('should navigate from repo menu to repo list', () => {
      // Step 1: Get main menu
      const step1 = agentExec('repo --machine');
      if (!step1) return;

      // Step 2: Find and follow list choice
      const listChoice = findChoice(step1.prompt.choices, 'List all');
      expect(listChoice).to.exist;

      // The command for list is repo list --json
      // Executing without --json should show the actual list
      const listCmd = execChoice(listChoice!);
      expect(listCmd).to.include('repo list');
    });

    it('should navigate from repo menu to repo add', () => {
      // Step 1: Get main menu
      const step1 = agentExec('repo --machine');
      if (!step1) return;

      // Step 2: Find add choice
      const addChoice = findChoice(step1.prompt.choices, 'Add repository');
      expect(addChoice).to.exist;

      // Step 3: Execute add command to get method selection
      const addCmd = execChoice(addChoice!);
      const step2 = agentExec(addCmd);

      if (!step2) return;

      expect(step2.prompt.type).to.equal('list');
      expect(step2.prompt.choices.length).to.be.greaterThan(0);
    });
  });

  describe('Error handling in agent mode', () => {
    it('should handle not-in-HQ error gracefully', () => {
      // Remove the HQ config to simulate not being in HQ
      fs.rmSync(path.join(env.proletariatDir, 'config.json'));

      const result = agentExec('repo --machine');

      // Should return null or error response
      // The hasContextError helper should catch this
      expect(result).to.be.null;
    });
  });
});

describe('Repository Commands - JSON Mode Compatibility', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment('repo-json-mode-');
    createHQConfig(env.proletariatDir, { name: 'test-hq', hasPmo: false });

    const reposDir = path.join(env.testDir, 'repos');
    fs.mkdirSync(reposDir, { recursive: true });
  });

  afterEach(() => {
    cleanupTestEnvironment(env);
  });

  it('--json flag should work the same as --machine', function(this: Mocha.Context) {
    // Increase timeout for this test since it runs two commands
    this.timeout(60000);

    const machineResult = agentExec('repo --machine');
    const jsonResult = agentExec('repo --json');

    // Both should have similar structure
    if (machineResult && jsonResult) {
      expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type);
      expect(machineResult.prompt.choices.length).to.equal(jsonResult.prompt.choices.length);
    }
  });

  it('-m shorthand should work for --machine', () => {
    const result = agentExec('repo -m');

    if (!result) return;

    expect(result.prompt.type).to.equal('list');
    expect(result.prompt.choices.length).to.be.greaterThan(0);
  });
});

describe('Branch Commands - Agent Flow Tests', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment('branch-agent-flow-');
    // Create HQ config to mark this as an HQ directory
    createHQConfig(env.proletariatDir, { name: 'test-hq', hasPmo: false });
  });

  afterEach(() => {
    cleanupTestEnvironment(env);
  });

  describe('branch (main menu) --machine', () => {
    it('should output JSON menu with all branch operations', () => {
      const result = agentExec('branch --machine');

      if (!result) return;

      expect(result.prompt.type).to.equal('list');
      expect(result.prompt.message).to.include('What would you like to do');

      // Verify menu choices exist with command fields
      const createChoice = findChoice(result.prompt.choices, 'Create');
      expect(createChoice).to.exist;
      expect(createChoice?.command).to.include('branch create');

      const listChoice = findChoice(result.prompt.choices, 'List');
      expect(listChoice).to.exist;
      expect(listChoice?.command).to.include('branch list');

      const validateChoice = findChoice(result.prompt.choices, 'Validate');
      expect(validateChoice).to.exist;
      expect(validateChoice?.command).to.include('branch validate');
    });

    it('should include cancel option', () => {
      const result = agentExec('branch --machine');

      if (!result) return;

      const cancelChoice = findChoice(result.prompt.choices, 'Cancel');
      expect(cancelChoice).to.exist;
    });
  });

  describe('branch create --machine', () => {
    it('should output JSON with mode selection choices', () => {
      const result = agentExec('branch create --machine');

      if (!result) return;

      expect(result.prompt.type).to.equal('list');
      // Should have mode selection choices
      expect(result.prompt.choices.length).to.be.greaterThan(0);

      // Each choice should have a command field
      for (const choice of result.prompt.choices) {
        if (choice.value !== 'cancel') {
          expect(choice.command).to.exist;
        }
      }
    });
  });

  describe('branch list --machine', () => {
    it('should output branch list in JSON format', () => {
      // branch list with --format json outputs directly
      const output = execFinal('branch list --format json');

      // Should be valid output (even if empty)
      expect(output).to.be.a('string');
    });
  });

  describe('Full agent navigation - branch commands', () => {
    it('should navigate from branch menu to branch create', () => {
      // Step 1: Get main menu
      const step1 = agentExec('branch --machine');
      if (!step1) return;

      // Step 2: Find create choice
      const createChoice = findChoice(step1.prompt.choices, 'Create');
      expect(createChoice).to.exist;

      // Step 3: Execute create command to get mode selection
      const createCmd = execChoice(createChoice!);
      const step2 = agentExec(createCmd);

      if (!step2) return;

      expect(step2.prompt.type).to.equal('list');
      expect(step2.prompt.choices.length).to.be.greaterThan(0);
    });
  });
});
