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

/**
 * Tests for execution config command
 * TKT-799: Implement execution config command
 */
describe('Execution Config Command', () => {
  let helpOutput: string;

  before(() => {
    // Get help output once for all tests
    helpOutput = runCli(['execution', 'config', '--help']);
  });

  describe('Command Help', () => {
    it('shows execution config command in help', () => {
      expect(helpOutput).to.contain('USAGE');
      expect(helpOutput).to.contain('execution config');
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

    it('shows --setting flag', () => {
      expect(helpOutput).to.contain('--setting');
    });

    it('describes JSON output mode', () => {
      expect(helpOutput).to.contain('Output configuration as JSON');
    });
  });

  describe('Configuration Options', () => {
    it('help shows defaultEnvironment example', () => {
      expect(helpOutput).to.contain('defaultEnvironment');
    });

    it('help shows outputMode example', () => {
      expect(helpOutput).to.contain('outputMode');
    });

    it('help shows sandboxed example', () => {
      expect(helpOutput).to.contain('sandboxed');
    });
  });
});
