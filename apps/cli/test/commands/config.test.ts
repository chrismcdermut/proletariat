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
});
