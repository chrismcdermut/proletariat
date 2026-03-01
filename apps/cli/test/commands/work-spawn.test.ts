import { expect } from 'chai';
import * as path from 'node:path';
import * as fs from 'node:fs';
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
 * Tests for work spawn command
 * TKT-1095: Consolidated PR flags
 */
describe('Work Spawn Command', () => {
  let helpOutput: string;

  before(() => {
    // Get help output once for all tests
    helpOutput = runCli(['work', 'spawn', '--help']);
  });

  describe('Consolidated PR Flags (TKT-1095)', () => {
    it('--create-pr is described as canonical flag in help', () => {
      expect(helpOutput).to.contain('canonical');
      expect(helpOutput).to.match(/--create-pr.*canonical/s);
    });

    it('--no-pr is marked as deprecated in help', () => {
      expect(helpOutput).to.contain('deprecated');
      expect(helpOutput).to.match(/--no-pr.*deprecated/s);
    });

    it('--create-pr example is shown in help', () => {
      expect(helpOutput).to.contain('--create-pr');
    });

    it('source code emits resolvedPRMode in JSON metadata', () => {
      const spawnTsPath = path.resolve(__dirname, '../../src/commands/work/spawn.ts');
      const source = fs.readFileSync(spawnTsPath, 'utf-8');
      // Verify the source sets resolvedPRMode on metadata
      expect(source).to.include('resolvedPRMode');
    });

    it('source code emits PR mode in human output', () => {
      const spawnTsPath = path.resolve(__dirname, '../../src/commands/work/spawn.ts');
      const source = fs.readFileSync(spawnTsPath, 'utf-8');
      // Verify the source displays PR mode in console output
      expect(source).to.include('PR mode:');
    });

    it('source code emits deprecation warning when --no-pr is used', () => {
      const spawnTsPath = path.resolve(__dirname, '../../src/commands/work/spawn.ts');
      const source = fs.readFileSync(spawnTsPath, 'utf-8');
      // Verify the source has deprecation warning for --no-pr
      expect(source).to.include("--no-pr is deprecated");
      expect(source).to.include("Omit --create-pr instead");
    });
  });

  describe('Command Help', () => {
    it('work spawn help shows usage', () => {
      expect(helpOutput).to.contain('USAGE');
      expect(helpOutput).to.contain('work spawn');
    });

    it('shows PR creation flags', () => {
      expect(helpOutput).to.contain('--create-pr');
      expect(helpOutput).to.contain('--no-pr');
    });
  });
});
