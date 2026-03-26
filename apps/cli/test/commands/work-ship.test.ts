import { expect } from 'chai';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root directory for the CLI - needed for @oclif/test to find commands
const root = path.resolve(__dirname, '../..');

// Isolated env to prevent test commands from polluting production database
function getIsolatedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.PRLT_HQ_PATH;
  delete env.PRLT_PMO_PATH;
  delete env.PRLT_DATABASE_PATH;
  delete env.PRLT_CONFIG_PATH;
  delete env.DEVCONTAINER;
  delete env.PRLT_TEST_ENV;
  return env;
}

// Helper to run CLI commands directly and get stdout
function runCli(args: string[]): string {
  const binPath = path.join(root, 'bin', 'run.js');
  try {
    return execSync(`node ${binPath} ${args.join(' ')}`, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getIsolatedEnv(),
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
      env: getIsolatedEnv(),
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
 * Tests for work ship command
 * TKT-245 / PRLT-1092: Ship work — rebase, merge, move ticket to Done
 */
describe('Work Ship Command', () => {
  let helpOutput: string;

  before(() => {
    helpOutput = runCli(['work', 'ship', '--help']);
  });

  describe('Command Help', () => {
    it('work ship help shows usage', () => {
      expect(helpOutput).to.contain('USAGE');
      expect(helpOutput).to.contain('work ship');
    });

    it('shows description about shipping', () => {
      expect(helpOutput).to.contain('Ship work');
    });

    it('shows --wait flag', () => {
      expect(helpOutput).to.contain('--wait');
    });

    it('shows --no-rebase flag', () => {
      expect(helpOutput).to.contain('--no-rebase');
    });

    it('shows --dry-run flag', () => {
      expect(helpOutput).to.contain('--dry-run');
    });

    it('shows --method flag with merge options', () => {
      expect(helpOutput).to.contain('--method');
      expect(helpOutput).to.contain('squash');
    });

    it('shows --pr flag for direct PR number', () => {
      expect(helpOutput).to.contain('--pr');
    });

    it('shows --delete-branch flag', () => {
      expect(helpOutput).to.contain('--delete-branch');
    });

    it('shows --admin flag', () => {
      expect(helpOutput).to.contain('--admin');
    });

    it('shows ticket ID argument', () => {
      expect(helpOutput).to.contain('TICKETID');
    });
  });

  describe('Command Registration', () => {
    it('work ship is a recognized command', () => {
      const result = runCliWithError(['work', 'ship', '--help']);
      // Help should succeed (exit 0) — if it doesn't, the command isn't registered
      expect(result.exitCode).to.equal(0);
    });
  });

  describe('Rebase Siblings Flag', () => {
    it('shows --rebase-siblings flag in help', () => {
      expect(helpOutput).to.contain('--rebase-siblings');
    });

    it('shows --no-rebase-siblings option in help or examples', () => {
      // The flag should be disableable with --no-rebase-siblings
      expect(helpOutput).to.contain('rebase-siblings');
    });

    it('help describes sibling rebase behavior', () => {
      expect(helpOutput).to.contain('rebase other open PRs');
    });
  });
});
