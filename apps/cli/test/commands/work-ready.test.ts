import { expect } from 'chai';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root directory for the CLI - needed for @oclif/test to find commands
const root = path.resolve(__dirname, '../..');

// Helper to run CLI commands directly and get stdout
function runCli(args: string[]): string {
  const binPath = path.join(root, 'bin', 'run.js');
  try {
    return execSync(`node ${binPath} ${args.join(' ')}`, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error: unknown) {
    // Return stdout even on error (for --help commands that may exit with code 0)
    return (error as { stdout?: string })?.stdout || '';
  }
}

// Helper to run CLI and capture stderr (for error testing)
function runCliWithError(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const binPath = path.join(root, 'bin', 'run.js');
  try {
    const stdout = execSync(`node ${binPath} ${args.join(' ')}`, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status || 1,
    };
  }
}

/**
 * Tests for work ready command
 * TKT-838: Conflicting PR flags validation
 */
describe('Work Ready Command', () => {
  let helpOutput: string;

  before(() => {
    // Get help output once for all tests
    helpOutput = runCli(['work', 'ready', '--help']);
  });

  describe('Conflicting PR Flags (TKT-838)', () => {
    it('errors when both --pr and --no-pr are used', () => {
      const result = runCliWithError([
        'work', 'ready', 'TKT-999',
        '--pr',
        '--no-pr',
      ]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.contain('--pr and --no-pr are mutually exclusive');
    });

    it('error message names both conflicting flags', () => {
      const result = runCliWithError([
        'work', 'ready', 'TKT-999',
        '--pr',
        '--no-pr',
      ]);

      expect(result.stderr).to.contain('--pr');
      expect(result.stderr).to.contain('--no-pr');
    });
  });

  describe('Command Help', () => {
    it('work ready help shows usage', () => {
      expect(helpOutput).to.contain('USAGE');
      expect(helpOutput).to.contain('work ready');
    });

    it('shows PR creation flags', () => {
      expect(helpOutput).to.contain('--pr');
      expect(helpOutput).to.contain('--no-pr');
    });

    it('shows draft flag', () => {
      expect(helpOutput).to.contain('--draft');
    });
  });
});
