import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  exec,
  extractJson,
  createHQConfig,
} from './test-helpers.js';

/**
 * Response type for JSON prompts from --machine flag
 */
interface MachinePromptResponse {
  prompt: {
    type: string;
    name: string;
    message: string;
    choices?: Array<{
      name: string;
      value: string;
      command?: string;
    }>;
    default?: string;
    context?: Record<string, unknown>;
  };
  metadata: {
    command: string;
    flags: Record<string, unknown>;
    timestamp?: string;
  };
}

/**
 * E2E tests for terminal title command.
 *
 * Tests both interactive mode (with args to bypass prompts) and
 * JSON/machine mode for AI agent workflows.
 */
describe('Terminal Title Commands E2E Tests', function (this: Mocha.Suite) {
  this.timeout(30000);

  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-title-')));
    process.chdir(testDir);

    // Create minimal HQ config (no database needed for terminal commands)
    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    createHQConfig(proletariatDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // terminal title with args (interactive mode, bypassed with arguments)
  // ===========================================================================

  describe('terminal title with args', () => {
    it('should set terminal title when provided as argument', () => {
      const output = exec('terminal title "My Custom Title"');
      expect(output).to.include('Terminal title set to');
      expect(output).to.include('My Custom Title');
    });

    it('should set terminal title with special characters', () => {
      const output = exec('terminal title "Project Alpha - v2.0"');
      expect(output).to.include('Terminal title set to');
      expect(output).to.include('Project Alpha - v2.0');
    });

    it('should reset terminal title with --reset flag', () => {
      const output = exec('terminal title --reset');
      expect(output).to.include('Terminal title reset to default');
    });

    it('should reset terminal title with -r shorthand', () => {
      const output = exec('terminal title -r');
      expect(output).to.include('Terminal title reset to default');
    });

    it('should set title then reset it', () => {
      // Set title
      const setOutput = exec('terminal title "Temporary Title"');
      expect(setOutput).to.include('Terminal title set to');

      // Reset title
      const resetOutput = exec('terminal title --reset');
      expect(resetOutput).to.include('Terminal title reset to default');
    });
  });

  // ===========================================================================
  // terminal title --machine (JSON mode for AI agents)
  // ===========================================================================

  describe('terminal title --machine', () => {
    it('should output valid JSON input prompt when no title provided', () => {
      const output = exec('terminal title --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('input');
      expect(json!.prompt.name).to.equal('title');
      expect(json!.prompt.message).to.include('terminal title');
      expect(json!.metadata.command).to.equal('terminal title');
      expect(json!.metadata.flags.machine).to.equal(true);
    });

    it('should work with --json flag (legacy)', () => {
      const output = exec('terminal title --json');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('input');
      expect(json!.prompt.name).to.equal('title');
      expect(json!.metadata.flags.json).to.equal(true);
    });

    it('should work with -m shorthand', () => {
      const output = exec('terminal title -m');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('input');
      expect(json!.metadata.flags.machine).to.equal(true);
    });

    it('should have proper metadata structure', () => {
      const output = exec('terminal title --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata).to.exist;
      expect(json!.metadata.command).to.equal('terminal title');
      expect(json!.metadata.flags).to.be.an('object');
      expect(json!.metadata.timestamp).to.be.a('string');
    });

    it('should set title when provided as argument even in machine mode', () => {
      const output = exec('terminal title "Agent Title" --machine');
      expect(output).to.include('Terminal title set to');
      expect(output).to.include('Agent Title');
    });

    it('should handle --reset in machine mode', () => {
      const output = exec('terminal title --reset --machine');
      expect(output).to.include('Terminal title reset to default');
    });

    it('should handle --machine and --json together', () => {
      const output = exec('terminal title --machine --json');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('input');
      expect(json!.metadata.flags.machine).to.equal(true);
    });
  });

  // ===========================================================================
  // End-to-end agent flows
  // ===========================================================================

  describe('End-to-end agent flows', () => {
    it('should complete full agent flow: get prompt → provide title via arg → verify set', () => {
      // Step 1: Agent calls without title, gets JSON prompt describing what input is needed
      const step1Output = exec('terminal title --machine');
      const step1Json = extractJson<MachinePromptResponse>(step1Output);

      expect(step1Json).to.not.be.null;
      expect(step1Json!.prompt.type).to.equal('input');
      expect(step1Json!.prompt.name).to.equal('title');
      // Agent now knows: need to provide a 'title' (input type) to 'terminal title' command

      // Step 2: Agent provides title as argument (bypasses prompt)
      const step2Output = exec('terminal title "Agent Workflow Title"');
      expect(step2Output).to.include('Terminal title set to');
      expect(step2Output).to.include('Agent Workflow Title');
    });

    it('should handle set → reset flow', () => {
      // Agent sets a title
      const setOutput = exec('terminal title "Active Task: TKT-123"');
      expect(setOutput).to.include('Terminal title set to');
      expect(setOutput).to.include('Active Task: TKT-123');

      // Agent resets when done
      const resetOutput = exec('terminal title --reset');
      expect(resetOutput).to.include('Terminal title reset to default');
    });

    it('should handle multiple title changes', () => {
      // Set first title
      const out1 = exec('terminal title "Phase 1: Planning"');
      expect(out1).to.include('Terminal title set to');
      expect(out1).to.include('Phase 1: Planning');

      // Change to second title
      const out2 = exec('terminal title "Phase 2: Implementation"');
      expect(out2).to.include('Terminal title set to');
      expect(out2).to.include('Phase 2: Implementation');

      // Reset when done
      const out3 = exec('terminal title --reset');
      expect(out3).to.include('Terminal title reset to default');
    });
  });
});
