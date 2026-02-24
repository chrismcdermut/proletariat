import { runCommand } from '@oclif/test';
import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root directory for the CLI - needed for @oclif/test to find commands
const root = path.resolve(__dirname, '../..');

/**
 * Environment variables that can cause the init hook or PMOCommand.init()
 * to detect ambient workspace state and emit preflight output to stdout.
 * Clearing these ensures help assertions get clean output regardless of
 * whether the test runs locally (with a valid HQ at /hq) or in CI (no HQ).
 */
const WORKSPACE_ENV_VARS = [
  'PRLT_HQ_PATH',
  'PRLT_PMO_PATH',
  'PRLT_DATABASE_PATH',
  'PRLT_CONFIG_PATH',
  'DEVCONTAINER',
  'PRLT_TEST_ENV',
  'PRLT_JSON',
  'PRLT_FORCE_TEXT',
] as const;

/**
 * Creates a minimal HQ directory structure that satisfies findHQRoot() and
 * isFirstTimeUser() checks so the init hook does not emit preflight output.
 * This is lighter than the full createTestEnvironment() from E2E helpers
 * since --help tests don't need a database or PMO tables.
 */
function createMinimalHQDir(): { dir: string; cleanup: () => void } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-unit-')));
  const proletariatDir = path.join(dir, '.proletariat');
  fs.mkdirSync(proletariatDir, { recursive: true });
  fs.writeFileSync(
    path.join(proletariatDir, 'config.json'),
    JSON.stringify({ type: 'hq', name: 'unit-test', hasPmo: false }),
    'utf-8'
  );
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Unit tests for Agent Command JSON Mode (TKT-741)
 *
 * These tests use runCommand() to invoke commands with --help and assert on
 * stdout content. They require workspace isolation because:
 *
 * 1. The init hook (src/hooks/init.ts) checks isFirstTimeUser() before every
 *    command. Without a valid HQ, it emits warning output to stdout.
 * 2. runCommand() passes args via oclif internals, not process.argv, so the
 *    init hook's process.argv.includes('--help') check can miss --help.
 * 3. Non-TTY environments (CI) can trigger JSON auto-detection in commands.
 *
 * The before/after hooks below ensure a minimal HQ directory exists and that
 * environment variables don't leak ambient workspace state into the tests.
 */
describe('Agent Command JSON Mode (TKT-741)', () => {
  let hqDir: { dir: string; cleanup: () => void };
  let originalCwd: string;
  let savedEnv: Record<string, string | undefined>;

  before(() => {
    // Save original state
    originalCwd = process.cwd();
    savedEnv = {};
    for (const key of WORKSPACE_ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    // Force text output in non-TTY environments (CI) so help assertions
    // see human-readable text, not JSON auto-detected by isNonTTY()
    process.env.PRLT_FORCE_TEXT = '1';

    // Create minimal HQ so isFirstTimeUser() returns false
    hqDir = createMinimalHQDir();
    process.chdir(hqDir.dir);
  });

  after(() => {
    // Restore original state
    process.chdir(originalCwd);
    hqDir.cleanup();
    for (const key of WORKSPACE_ENV_VARS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  describe('agent auth', function (this: Mocha.Suite) {
    // First test in suite loads better-sqlite3 native module; allow extra time
    this.timeout(120_000);

    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'auth', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output as JSON for AI agents/scripts');
    });

    it('should have --check flag for status checking', async () => {
      const { stdout } = await runCommand(['agent', 'auth', '--help'], { root });
      expect(stdout).to.include('--check');
    });
  });

  describe('agent discover', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'discover', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output as JSON for AI agents/scripts');
    });

    it('should have --dry-run flag', async () => {
      const { stdout } = await runCommand(['agent', 'discover', '--help'], { root });
      expect(stdout).to.include('--dry-run');
    });
  });

  describe('agent shell (agentPrompt migration)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'shell', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output as JSON for AI agents/scripts');
    });

    it('should accept agent name as argument', async () => {
      const { stdout } = await runCommand(['agent', 'shell', '--help'], { root });
      expect(stdout).to.include('ARGUMENTS');
      expect(stdout).to.match(/name/i);
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'shell', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent status (agentPrompt migration)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'status', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output as JSON for AI agents/scripts');
    });

    it('should accept agent name as argument', async () => {
      const { stdout } = await runCommand(['agent', 'status', '--help'], { root });
      expect(stdout).to.include('ARGUMENTS');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'status', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent visit (agentPrompt migration)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'visit', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output as JSON for AI agents/scripts');
    });

    it('should accept agent name as argument', async () => {
      const { stdout } = await runCommand(['agent', 'visit', '--help'], { root });
      expect(stdout).to.include('ARGUMENTS');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'visit', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent login (agentPrompt migration)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'login', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output as JSON for AI agents/scripts');
    });

    it('should accept agent name as argument', async () => {
      const { stdout } = await runCommand(['agent', 'login', '--help'], { root });
      expect(stdout).to.include('ARGUMENTS');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'login', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent list (agentPrompt migration)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'list', '--help'], { root });
      expect(stdout).to.include('--json');
      // Uses pmoBaseFlags so check for either description pattern
      expect(stdout).to.match(/Output.*JSON/);
    });

    it('should have --type flag for filtering', async () => {
      const { stdout } = await runCommand(['agent', 'list', '--help'], { root });
      expect(stdout).to.include('--type');
      expect(stdout).to.include('staff');
      expect(stdout).to.include('temp');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'list', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent restart (already using selectFromList)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'restart', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output as JSON for AI agents/scripts');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'restart', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent rebuild (already using selectFromList)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'rebuild', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output as JSON for AI agents/scripts');
    });

    it('should have --no-cache flag', async () => {
      const { stdout } = await runCommand(['agent', 'rebuild', '--help'], { root });
      expect(stdout).to.include('--no-cache');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'rebuild', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent index (agentPrompt migration)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output as JSON for AI agents/scripts');
    });

    it('should list all subcommands', async () => {
      const { stdout } = await runCommand(['agent', '--help'], { root });
      expect(stdout).to.include('COMMANDS');
      // Check for key subcommands
      expect(stdout).to.include('list');
      expect(stdout).to.include('status');
      expect(stdout).to.include('shell');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });
});

/**
 * Unit tests for agentPrompt choice structure
 * Verifies that choices include the required 'command' field for JSON mode
 */
describe('Agent Command Choice Structure', () => {
  // These tests verify the contract that agentPrompt choices must have command fields
  // The actual JSON output testing requires a workspace context

  describe('agentPrompt contract', () => {
    it('agent index choices should include command field in code', async () => {
      // This is a static analysis test - verify the source code includes command fields
      const fs = await import('node:fs');
      const indexPath = path.resolve(__dirname, '../../src/commands/agent/index.ts');
      const content = fs.readFileSync(indexPath, 'utf-8');

      // Verify choices have command field with --machine flag
      expect(content).to.include("command: 'prlt agent list --machine'");
      expect(content).to.include("command: 'prlt agent status --machine'");
      expect(content).to.include("command: 'prlt agent shell --machine'");
    });

    it('agent shell choices should include command field in code', async () => {
      const fs = await import('node:fs');
      const shellPath = path.resolve(__dirname, '../../src/commands/agent/shell.ts');
      const content = fs.readFileSync(shellPath, 'utf-8');

      // Verify agent selection choices have command field with --machine flag
      expect(content).to.include('command: `prlt agent shell ${agent.name} --machine`');
    });

    it('agent status choices should include command field in code', async () => {
      const fs = await import('node:fs');
      const statusPath = path.resolve(__dirname, '../../src/commands/agent/status.ts');
      const content = fs.readFileSync(statusPath, 'utf-8');

      // Verify choices have command field with --machine flag
      expect(content).to.include('command: `prlt agent status ${agent.name} --machine`');
    });

    it('agent visit choices should include command field in code', async () => {
      const fs = await import('node:fs');
      const visitPath = path.resolve(__dirname, '../../src/commands/agent/visit.ts');
      const content = fs.readFileSync(visitPath, 'utf-8');

      // Verify choices have command field with --machine flag
      expect(content).to.include('command: `prlt agent visit ${agent.name} --machine`');
    });

    it('agent login choices should include command field in code', async () => {
      const fs = await import('node:fs');
      const loginPath = path.resolve(__dirname, '../../src/commands/agent/login.ts');
      const content = fs.readFileSync(loginPath, 'utf-8');

      // Verify choices have command field with --machine flag
      expect(content).to.include('command: `prlt agent login ${agent.name} --machine`');
    });

    it('agent list choices should include command field in code', async () => {
      const fs = await import('node:fs');
      const listPath = path.resolve(__dirname, '../../src/commands/agent/list.ts');
      const content = fs.readFileSync(listPath, 'utf-8');

      // Verify choices have command field with --machine flag
      expect(content).to.include("command: 'prlt agent list --type all --machine'");
      expect(content).to.include("command: 'prlt agent list --type staff --machine'");
      expect(content).to.include("command: 'prlt agent list --type temp --machine'");
    });
  });

  describe('agentPrompt usage pattern', () => {
    it('migrated files should use this.prompt instead of inquirer.prompt', async () => {
      const fs = await import('node:fs');

      const filesToCheck = [
        '../../src/commands/agent/index.ts',
        '../../src/commands/agent/shell.ts',
        '../../src/commands/agent/status.ts',
        '../../src/commands/agent/visit.ts',
        '../../src/commands/agent/login.ts',
        '../../src/commands/agent/list.ts',
      ];

      for (const file of filesToCheck) {
        const filePath = path.resolve(__dirname, file);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Should use this.prompt
        expect(content, `${file} should use this.prompt`).to.include('this.prompt');

        // Should NOT have standalone inquirer.prompt calls (but may import inquirer for Separator)
        const promptCalls = content.match(/await\s+inquirer\.prompt\(/g) || [];
        expect(promptCalls.length, `${file} should not use inquirer.prompt directly`).to.equal(0);
      }
    });

    it('migrated files should pass agentConfig to prompt', async () => {
      const fs = await import('node:fs');

      const filesToCheck = [
        '../../src/commands/agent/index.ts',
        '../../src/commands/agent/shell.ts',
        '../../src/commands/agent/status.ts',
        '../../src/commands/agent/visit.ts',
        '../../src/commands/agent/login.ts',
        '../../src/commands/agent/list.ts',
      ];

      for (const file of filesToCheck) {
        const filePath = path.resolve(__dirname, file);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Should define agentConfig
        expect(content, `${file} should define agentConfig`).to.include('agentConfig');

        // Should pass agentConfig to prompt (or null for interactive-only prompts)
        expect(content, `${file} should pass agentConfig to prompt`).to.match(
          /this\.prompt.*\],\s*(agentConfig|null)\)/s
        );
      }
    });
  });
});
