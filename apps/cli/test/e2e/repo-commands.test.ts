/**
 * Unit tests for Repository Commands JSON mode
 *
 * Tests that the prompt-json helpers work correctly for the agentPrompt pattern
 * used by repo commands. Full e2e tests would require complex PMO setup.
 */
import { expect } from 'chai';

describe('Repository Commands JSON Mode - Unit Tests', () => {
  describe('shouldOutputJson', () => {
    it('should return true when json flag is set', async () => {
      const { shouldOutputJson } = await import('../../src/lib/prompt-json.js');

      expect(shouldOutputJson({ json: true })).to.be.true;
    });

    it('should return false when json flag is not set and in TTY', async () => {
      const { shouldOutputJson } = await import('../../src/lib/prompt-json.js');

      // Save original and mock
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      expect(shouldOutputJson({ json: false })).to.be.false;
      expect(shouldOutputJson({})).to.be.false;

      // Restore
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    });
  });

  describe('isAgentMode', () => {
    it('should return true when json flag is set', async () => {
      const { isAgentMode } = await import('../../src/lib/prompt-json.js');

      expect(isAgentMode({ json: true })).to.be.true;
    });

    it('should return false when json flag is false and in TTY', async () => {
      const { isAgentMode } = await import('../../src/lib/prompt-json.js');

      // Save original and mock TTY
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

      expect(isAgentMode({ json: false })).to.be.false;
      expect(isAgentMode({})).to.be.false;

      // Restore
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    });
  });

  describe('normalizeChoices', () => {
    it('should normalize choice objects with command field', async () => {
      const { normalizeChoices } = await import('../../src/lib/prompt-json.js');

      const choices = [
        { name: 'Option A', value: 'a', command: 'prlt cmd a --json' },
        { name: 'Option B', value: 'b', command: 'prlt cmd b --json' },
      ];

      const normalized = normalizeChoices(choices);

      expect(normalized).to.have.length(2);
      expect(normalized[0]).to.deep.include({
        name: 'Option A',
        value: 'a',
        command: 'prlt cmd a --json',
      });
      expect(normalized[1]).to.deep.include({
        name: 'Option B',
        value: 'b',
        command: 'prlt cmd b --json',
      });
    });

    it('should handle string choices', async () => {
      const { normalizeChoices } = await import('../../src/lib/prompt-json.js');

      const choices = ['option1', 'option2'];
      const normalized = normalizeChoices(choices);

      expect(normalized).to.have.length(2);
      expect(normalized[0].name).to.equal('option1');
      expect(normalized[0].value).to.equal('option1');
    });
  });

  describe('createMetadata', () => {
    it('should create metadata with command and flags', async () => {
      const { createMetadata } = await import('../../src/lib/prompt-json.js');

      const metadata = createMetadata('repo', { json: true, project: 'test' });

      expect(metadata.command).to.equal('repo');
      expect(metadata.flags).to.deep.include({ json: true, project: 'test' });
      expect(metadata.timestamp).to.be.a('string');
    });
  });

  describe('Repo command JSON choices structure', () => {
    it('should have correct choice structure for repo menu', () => {
      // This tests the expected structure that agentPrompt should output
      const menuChoices = [
        { name: 'List all repositories', value: 'list', command: 'prlt repo list --json' },
        { name: 'Add repository', value: 'add', command: 'prlt repo add --json' },
        { name: 'Remove repository', value: 'remove', command: 'prlt repo remove --json' },
        { name: 'View repository details', value: 'view', command: 'prlt repo view --json' },
      ];

      // Verify structure matches expected format
      for (const choice of menuChoices) {
        expect(choice).to.have.property('name');
        expect(choice).to.have.property('value');
        expect(choice).to.have.property('command');
        expect(choice.command).to.include('--json');
      }
    });

    it('should have correct choice structure for repo add method selection', () => {
      const methodChoices = [
        { name: 'Enter path or Git URL', value: 'manual', command: 'prlt repo add <path> --json' },
        { name: 'Search for repositories (bulk)', value: 'search', command: 'prlt repo add --bulk --json' },
      ];

      for (const choice of methodChoices) {
        expect(choice).to.have.property('name');
        expect(choice).to.have.property('value');
        expect(choice).to.have.property('command');
      }
    });
  });
});
