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

  describe('Conflicting PR Flags (TKT-838)', () => {
    it('errors when both --create-pr and --no-pr are used', () => {
      const result = runCliWithError([
        'work', 'start', 'TKT-999',
        '--create-pr',
        '--no-pr',
      ]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.contain('--create-pr and --no-pr are mutually exclusive');
    });

    it('error message names both conflicting flags', () => {
      const result = runCliWithError([
        'work', 'start', 'TKT-999',
        '--create-pr',
        '--no-pr',
      ]);

      expect(result.stderr).to.contain('--create-pr');
      expect(result.stderr).to.contain('--no-pr');
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

  describe('Environment Selection JSON Commands (TKT-974)', () => {
    it('source code should not reference selectedEnvironment as a flag name', () => {
      // Regression test: the FlagResolver in work/start.ts must not use
      // 'selectedEnvironment' as a flagName, because that generates invalid
      // --selectedEnvironment CLI flags in JSON prompt commands
      const startTsPath = path.resolve(__dirname, '../../src/commands/work/start.ts');
      const source = fs.readFileSync(startTsPath, 'utf-8');

      // Should not have flagName: 'selectedEnvironment' anywhere
      expect(source).to.not.include("flagName: 'selectedEnvironment'");
    });

    it('environment selection should use getCommand callback', () => {
      const startTsPath = path.resolve(__dirname, '../../src/commands/work/start.ts');
      const source = fs.readFileSync(startTsPath, 'utf-8');

      // The environment prompt should use getCommand to generate valid commands
      expect(source).to.include('getCommand');
      // And should reference --run-on-host for host environment
      expect(source).to.include('--run-on-host --json');
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

    it('source code emits deprecation warning when --no-pr is used', () => {
      const startTsPath = path.resolve(__dirname, '../../src/commands/work/start.ts');
      const source = fs.readFileSync(startTsPath, 'utf-8');
      // Verify the source has deprecation warning for --no-pr
      expect(source).to.include("--no-pr is deprecated");
      expect(source).to.include("Omit --create-pr instead");
    });

    it('--no-pr still works (backward compatibility)', () => {
      // --no-pr should not produce a fatal error when used alone
      const result = runCliWithError([
        'work', 'start', 'TKT-999',
        '--no-pr',
      ]);
      // Should NOT fail with a flag parsing error
      // It may fail for other reasons (e.g., PMO not found), but not flag rejection
      expect(result.stderr).to.not.contain('Unexpected argument');
      expect(result.stderr).to.not.contain('is not a valid flag');
    });

    it('--create-pr alone does not trigger deprecation warning path', () => {
      const startTsPath = path.resolve(__dirname, '../../src/commands/work/start.ts');
      const source = fs.readFileSync(startTsPath, 'utf-8');
      // The deprecation warning is only triggered for --no-pr, not --create-pr
      // Check that the conditional is specific to no-pr
      expect(source).to.include("if (flags['no-pr'])");
      expect(source).to.not.include("if (flags['create-pr'])  {\n      this.warn");
    });

    it('source code maintains mutual exclusion for both flags', () => {
      const startTsPath = path.resolve(__dirname, '../../src/commands/work/start.ts');
      const source = fs.readFileSync(startTsPath, 'utf-8');
      // Verify mutual exclusion check still exists
      expect(source).to.include("flags['create-pr'] && flags['no-pr']");
      expect(source).to.include('mutually exclusive');
    });

    it('source code emits resolvedPRMode in JSON metadata', () => {
      const startTsPath = path.resolve(__dirname, '../../src/commands/work/start.ts');
      const source = fs.readFileSync(startTsPath, 'utf-8');
      // Verify the source sets resolvedPRMode on metadata
      expect(source).to.include('resolvedPRMode');
      expect(source).to.include("'create-pr'");
      expect(source).to.include("'no-pr'");
    });

    it('source code emits PR mode in human output', () => {
      const startTsPath = path.resolve(__dirname, '../../src/commands/work/start.ts');
      const source = fs.readFileSync(startTsPath, 'utf-8');
      // Verify the source displays PR mode in console output
      expect(source).to.include('PR mode:');
    });
  });
});
