import { expect } from 'chai';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';

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

// Helper to run CLI commands and get both stdout and exit code
function runCliWithExitCode(args: string[], cwd?: string): { stdout: string; exitCode: number } {
  const binPath = path.join(root, 'bin', 'run.js');
  try {
    const stdout = execSync(`node ${binPath} ${args.join(' ')}`, {
      cwd: cwd || root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getIsolatedEnv(),
    });
    return { stdout, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; status?: number };
    return {
      stdout: err.stdout || '',
      exitCode: err.status ?? 1
    };
  }
}

/**
 * Tests for config command
 * TKT-496: Terminal tab focus configuration
 */
describe('Config Command', () => {
  let helpOutput: string;

  before(() => {
    // Get help output once for all tests
    helpOutput = runCli(['config', '--help']);
  });

  describe('Command Help', () => {
    it('shows config command in help', () => {
      expect(helpOutput).to.contain('USAGE');
      expect(helpOutput).to.contain('config');
    });

    it('shows --json flag', () => {
      expect(helpOutput).to.contain('--json');
    });

    it('shows --list flag', () => {
      expect(helpOutput).to.contain('--list');
    });

    it('shows --set flag', () => {
      expect(helpOutput).to.contain('--set');
    });

    it('describes JSON output mode', () => {
      expect(helpOutput).to.contain('Output configuration as JSON');
    });
  });

  describe('Configuration Options', () => {
    it('help shows terminal.app example', () => {
      expect(helpOutput).to.contain('terminal.app');
    });

    it('help shows terminal.openInBackground example', () => {
      expect(helpOutput).to.contain('openInBackground');
    });
  });

  /**
   * Tests for non-TTY behavior
   * TKT-797: Fix config command exiting with code 2 in non-TTY
   */
  describe('Non-TTY Behavior', () => {
    let testWorkspacePath: string;

    before(() => {
      // Create a temporary workspace for testing
      testWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-config-test-'));
      // Initialize workspace
      const binPath = path.join(root, 'bin', 'run.js');
      execSync(`node ${binPath} init --json --name test-config --no-pmo`, {
        cwd: testWorkspacePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    });

    after(() => {
      // Cleanup temporary workspace
      if (testWorkspacePath && fs.existsSync(testWorkspacePath)) {
        fs.rmSync(testWorkspacePath, { recursive: true, force: true });
      }
    });

    it('outputs readable config list in non-TTY without --json flag and exits with code 0', () => {
      const workspaceDir = path.join(testWorkspacePath, 'test-config-hq');
      const result = runCliWithExitCode(['config'], workspaceDir);

      // Should output readable format, not JSON prompt
      expect(result.stdout).to.contain('Workspace Configuration');
      expect(result.stdout).to.contain('Terminal');
      expect(result.stdout).to.contain('app:');
      expect(result.stdout).to.not.contain('"prompt"');

      // Should exit with code 0, not code 2
      expect(result.exitCode).to.equal(0);
    });

    it('outputs JSON when --json flag is explicitly set', () => {
      const workspaceDir = path.join(testWorkspacePath, 'test-config-hq');
      const result = runCliWithExitCode(['config', '--json'], workspaceDir);

      // Should output JSON format
      const output = JSON.parse(result.stdout);
      expect(output).to.have.property('success', true);
      expect(output).to.have.property('result');
      expect(output.result).to.have.property('terminal');
      expect(output.result).to.have.property('shell');

      // Should exit with code 0
      expect(result.exitCode).to.equal(0);
    });

    it('outputs prompt JSON with --setting --json and exits with code 2', () => {
      const workspaceDir = path.join(testWorkspacePath, 'test-config-hq');
      const result = runCliWithExitCode(['config', '--setting', 'terminal.app', '--json'], workspaceDir);

      // Should output prompt JSON
      const output = JSON.parse(result.stdout);
      expect(output).to.have.property('prompt');
      expect(output.prompt).to.have.property('type', 'list');
      expect(output.prompt).to.have.property('choices');

      // Should exit with code 2 (needs input)
      expect(result.exitCode).to.equal(2);
    });

    it('--list flag outputs readable format in non-TTY', () => {
      const workspaceDir = path.join(testWorkspacePath, 'test-config-hq');
      const result = runCliWithExitCode(['config', '--list'], workspaceDir);

      // Should output readable format
      expect(result.stdout).to.contain('Workspace Configuration');
      expect(result.stdout).to.contain('Terminal');
      expect(result.stdout).to.not.contain('"prompt"');

      // Should exit with code 0
      expect(result.exitCode).to.equal(0);
    });
  });
});
