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
 * Tests for work start command
 * TKT-513: Permission mode flag for batch spawn
 * TKT-650: Skip permissions flag as alias
 */
describe('Work Start Command', () => {
  let helpOutput: string;

  before(() => {
    // Get help output once for all tests
    helpOutput = runCli(['work', 'start', '--help']);
  });

  describe('Permission Mode Flag (TKT-513)', () => {
    it('shows --permission-mode flag in help', () => {
      expect(helpOutput).to.contain('--permission-mode');
      expect(helpOutput).to.contain('danger');
      expect(helpOutput).to.contain('safe');
    });


    it('accepts danger as permission mode value', () => {
      // Verify the flag accepts 'danger' as an option
      expect(helpOutput).to.match(/--permission-mode.*danger/s);
    });

    it('accepts safe as permission mode value', () => {
      // Verify the flag accepts 'safe' as an option
      expect(helpOutput).to.match(/--permission-mode.*safe/s);
    });

    it('describes permission mode correctly', () => {
      expect(helpOutput).to.contain('Permission mode for Claude Code');
      // The description is split across lines in help output
      expect(helpOutput).to.contain('danger');
      expect(helpOutput).to.contain('safe');
    });
  });

  describe('Skip Permissions Flag (TKT-650)', () => {
    it('shows --skip-permissions flag in help', () => {
      expect(helpOutput).to.contain('--skip-permissions');
    });

    it('describes --skip-permissions as shorthand for --permission-mode danger', () => {
      expect(helpOutput).to.contain('Skip permission checks');
      expect(helpOutput).to.contain('shorthand');
    });

    it('errors when both --skip-permissions and --permission-mode are used', () => {
      const result = runCliWithError([
        'work', 'start', 'TKT-999',
        '--skip-permissions',
        '--permission-mode', 'danger',
      ]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.contain('Cannot use both --skip-permissions and --permission-mode');
    });

    it('error message suggests using only one flag', () => {
      const result = runCliWithError([
        'work', 'start', 'TKT-999',
        '--skip-permissions',
        '--permission-mode', 'safe',
      ]);

      expect(result.stderr).to.contain('Use only one');
    });
  });

  describe('Command Help', () => {
    it('work start help shows required flags', () => {
      expect(helpOutput).to.contain('USAGE');
      expect(helpOutput).to.contain('work start');
    });

    it('shows display mode options', () => {
      expect(helpOutput).to.contain('--display');
      expect(helpOutput).to.contain('foreground');
      expect(helpOutput).to.contain('background');
    });

    it('shows PR creation flags', () => {
      expect(helpOutput).to.contain('--create-pr');
      expect(helpOutput).to.contain('--no-pr');
    });
  });

  describe('Batch Mode Support', () => {
    it('shows --all flag for batch mode', () => {
      expect(helpOutput).to.contain('--all');
    });

    it('shows --force flag', () => {
      expect(helpOutput).to.contain('--force');
    });
  });

  describe('Focus Flag (TKT-496)', () => {
    it('shows --focus flag in help', () => {
      expect(helpOutput).to.contain('--focus');
    });

    it('describes focus flag as bringing terminal to foreground', () => {
      expect(helpOutput).to.contain('foreground');
    });

    it('indicates focus opens tabs without stealing focus by default', () => {
      // The description should mention that default is background
      expect(helpOutput).to.match(/--focus.*background/is);
    });
  });
});
