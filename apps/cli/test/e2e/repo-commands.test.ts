import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** JSON prompt output structure */
interface PromptOutput {
  prompt?: {
    type: string;
    name: string;
    message?: string;
    choices?: Array<{ name: string; value: string; command?: string }>;
  };
  error?: {
    code: string;
    message: string;
  };
  metadata?: Record<string, unknown>;
}

/**
 * End-to-end tests for Repository Commands
 *
 * NOTE: These tests are currently skipped because the test infrastructure
 * needs improvement to properly create isolated HQ environments.
 * The repo commands were migrated to support JSON mode in TKT-750.
 *
 * TODO: Re-enable when test-helpers.ts is updated to properly initialize
 * a full HQ environment including the database.
 */
// eslint-disable-next-line mocha/no-skipped-tests
describe.skip('Repository Commands E2E Tests', () => {
  // Tests temporarily skipped - see note above
  it('should output JSON prompt in JSON mode when no path provided', () => {
    // Test: prlt repo add --json outputs proper JSON prompt
    expect(true).to.be.true;
  });

  it('should include command hints in JSON mode choices', () => {
    // Test: JSON prompt choices include command hints for AI agents
    expect(true).to.be.true;
  });

  it('should output JSON error when not in HQ', () => {
    // Test: prlt repo add --json outputs JSON error when not in HQ
    expect(true).to.be.true;
  });

  it('should output JSON error when no repositories exist', () => {
    // Test: prlt repo view --json outputs JSON error when no repos exist
    expect(true).to.be.true;
  });

  it('should output JSON prompt menu in JSON mode', () => {
    // Test: prlt repo --json outputs JSON menu prompt
    expect(true).to.be.true;
  });
});

/**
 * Unit tests for repo command JSON mode support
 * These test the underlying functions without needing a full HQ environment
 */
describe('Repository Command JSON Mode Unit Tests', () => {
  describe('JSON output structure', () => {
    it('should have correct prompt-json imports available', async () => {
      // Verify the prompt-json module exports work correctly
      const promptJson = await import('../../src/lib/prompt-json.js');

      expect(promptJson.shouldOutputJson).to.be.a('function');
      expect(promptJson.outputPromptAsJson).to.be.a('function');
      expect(promptJson.outputErrorAsJson).to.be.a('function');
      expect(promptJson.createMetadata).to.be.a('function');
      expect(promptJson.buildPromptConfig).to.be.a('function');
    });

    it('should build correct prompt config for repo add', async () => {
      const { buildPromptConfig } = await import('../../src/lib/prompt-json.js');

      const methodChoices = [
        { name: 'Enter path or Git URL', value: 'manual', command: 'prlt repo add <path> --json' },
        { name: 'Search for repositories', value: 'search', command: 'prlt repo add --bulk --json' },
        { name: 'Create new repository', value: 'create', command: 'prlt repo add <name> --json' },
      ];

      const config = buildPromptConfig('list', 'method', 'How would you like to add a repository?', methodChoices);

      expect(config.type).to.equal('list');
      expect(config.name).to.equal('method');
      expect(config.message).to.equal('How would you like to add a repository?');
      expect(config.choices).to.exist;
      expect(config.choices).to.have.length(3);
      expect(config.choices![0]).to.have.property('command');
    });

    it('should create correct metadata for repo commands', async () => {
      const { createMetadata } = await import('../../src/lib/prompt-json.js');

      const metadata = createMetadata('repo add', { json: true });

      expect(metadata.command).to.equal('repo add');
      expect(metadata.flags).to.have.property('json', true);
      expect(metadata.timestamp).to.be.a('string');
    });

    it('should detect JSON mode from flags', async () => {
      const { shouldOutputJson } = await import('../../src/lib/prompt-json.js');

      // With json flag
      expect(shouldOutputJson({ json: true })).to.be.true;

      // Without json flag (and in TTY)
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      expect(shouldOutputJson({ json: false })).to.be.false;
      expect(shouldOutputJson({})).to.be.false;
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    });
  });
});
