import { runCommand } from '@oclif/test';
import { expect } from 'chai';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js';

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
 * Helper to run CLI via execSync for tests that trigger process.exit()
 * (e.g. --json mode calls outputPromptAsJson which exits the process).
 * These cannot use runCommand() since it runs in-process.
 */
function execCli(args: string, options?: { cwd?: string }): string {
  const binPath = path.join(root, 'bin', 'run.js');
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of WORKSPACE_ENV_VARS) {
    delete env[key];
  }
  try {
    return execSync(`node ${binPath} ${args} 2>&1`, {
      encoding: 'utf-8',
      timeout: 30000,
      env,
      cwd: options?.cwd,
    });
  } catch (error) {
    return (error as { stdout?: string; stderr?: string }).stdout ||
           (error as { stderr?: string }).stderr || '';
  }
}

// Helper to parse JSON from CLI output (handles warnings/noise)
function parseJson(output: string): Record<string, unknown> | null {
  const lines = output.split('\n');
  let jsonStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('{')) {
      jsonStart = i;
      break;
    }
  }
  if (jsonStart === -1) return null;
  try {
    return JSON.parse(lines.slice(jsonStart).join('\n'));
  } catch {
    return null;
  }
}

/**
 * Unit tests for template/* command machine-readable output mode support
 * Verifies that all template commands properly use machineOutputFlags for JSON mode
 *
 * Template commands use a flat structure:
 *   template          - index (menu)
 *   template create   - create ticket or phase template
 *   template list     - list templates
 *   template apply    - apply a template
 *   template save     - save ticket as template
 *   template update   - update phase template
 *   template delete   - delete templates
 *
 * Help tests use runCommand() (in-process via @oclif/test) for speed and
 * reliability. Functional --json tests use execSync because those commands
 * call process.exit() via outputPromptAsJson, which would kill the test
 * runner if run in-process.
 */
describe('Template Commands Machine Output Mode Support', function (this: Mocha.Suite) {
  // First test in suite loads better-sqlite3 native module; allow extra time
  this.timeout(120_000);

  let tempHQ: string;
  let db: Database.Database;
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

    // Create temp HQ with database for functional tests
    tempHQ = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-')));
    const proletariatDir = path.join(tempHQ, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    fs.writeFileSync(path.join(proletariatDir, 'config.json'), JSON.stringify({
      type: 'hq',
      name: 'test-hq',
      hasPmo: true,
    }));

    // Create database with PMO tables for commands that need storage
    const dbPath = path.join(proletariatDir, 'workspace.db');
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    initializePMOTables(db);

    // Create PMO directory and set path in settings
    const pmoPath = path.join(tempHQ, 'pmo');
    fs.mkdirSync(path.join(pmoPath, 'projects', 'test-project'), { recursive: true });
    db.prepare("INSERT OR REPLACE INTO pmo_settings (key, value) VALUES ('pmo_path', ?)").run(pmoPath);

    // Create a test project
    db.prepare("INSERT INTO pmo_projects (id, name, description, workflow_id) VALUES (?, ?, ?, ?)").run(
      'test-project', 'Test Project', 'Test project for template tests', 'default'
    );

    process.chdir(tempHQ);
  });

  after(() => {
    // Restore original state
    process.chdir(originalCwd);
    if (db) db.close();
    if (tempHQ && fs.existsSync(tempHQ)) {
      fs.rmSync(tempHQ, { recursive: true, force: true });
    }
    for (const key of WORKSPACE_ENV_VARS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  describe('template index (machineOutputFlags)', () => {
    it('should have --json flag with -m shorthand in help', async () => {
      const { stdout } = await runCommand(['template', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('-m');
    });

    // Functional test: uses execSync because template --json calls process.exit()
    it('should output JSON with command field for each choice', () => {
      const output = execCli('template --json', { cwd: tempHQ });
      const json = parseJson(output) as { prompt: { type: string; choices: Array<{ command?: string }> } };
      expect(json).to.not.be.null;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.every((c) => c.command !== undefined)).to.be.true;
    });

    // Functional test: uses execSync because template --json calls process.exit()
    it('should include navigation commands in choices', () => {
      const output = execCli('template --json', { cwd: tempHQ });
      const json = parseJson(output) as { prompt: { choices: Array<{ command: string }> } };
      expect(json).to.not.be.null;
      const commands = json.prompt.choices.map((c) => c.command);
      expect(commands).to.include('prlt template list --json');
      expect(commands).to.include('prlt template create --json');
      expect(commands).to.include('prlt template apply --json');
    });
  });

  describe('template delete (machineOutputFlags via pmoBaseFlags)', () => {
    it('should have --json flag with -m shorthand in help', async () => {
      const { stdout } = await runCommand(['template', 'delete', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('-m');
    });
  });

  describe('template create', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['template', 'create', '--help'], { root });
      expect(stdout).to.include('--json');
    });

    it('should have --subtask flag in help', async () => {
      const { stdout } = await runCommand(['template', 'create', '--help'], { root });
      expect(stdout).to.include('--subtask');
    });

    it('should have --ac flag in help', async () => {
      const { stdout } = await runCommand(['template', 'create', '--help'], { root });
      expect(stdout).to.include('--ac');
    });

    it('should have --label flag in help', async () => {
      const { stdout } = await runCommand(['template', 'create', '--help'], { root });
      expect(stdout).to.include('--label');
    });

    it('should have --title-pattern flag in help', async () => {
      const { stdout } = await runCommand(['template', 'create', '--help'], { root });
      expect(stdout).to.include('--title-pattern');
    });

    it('should have --description-template flag in help', async () => {
      const { stdout } = await runCommand(['template', 'create', '--help'], { root });
      expect(stdout).to.include('--description-template');
    });

    it('should have --priority flag in help', async () => {
      const { stdout } = await runCommand(['template', 'create', '--help'], { root });
      expect(stdout).to.include('--priority');
    });

    it('should have --category flag in help', async () => {
      const { stdout } = await runCommand(['template', 'create', '--help'], { root });
      expect(stdout).to.include('--category');
    });

    // Functional test: uses execSync because template create --json calls process.exit()
    it('should output JSON type prompt when --json is used without --type', () => {
      const output = execCli('template create --json', { cwd: tempHQ });
      const json = parseJson(output) as { prompt: { type: string; name: string; choices: Array<{ value: string }> } };
      expect(json).to.not.be.null;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('type');
      const values = json.prompt.choices.map(c => c.value);
      expect(values).to.include('ticket');
      expect(values).to.include('phase');
    });
  });

  describe('template list', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['template', 'list', '--help'], { root });
      expect(stdout).to.include('--json');
    });
  });

  describe('template apply', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['template', 'apply', '--help'], { root });
      expect(stdout).to.include('--json');
    });
  });

  describe('template save', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['template', 'save', '--help'], { root });
      expect(stdout).to.include('--json');
    });

    it('should have --template-name flag in help', async () => {
      const { stdout } = await runCommand(['template', 'save', '--help'], { root });
      expect(stdout).to.include('--template-name');
      expect(stdout).to.include('-n');
    });

    it('should have -m shorthand for --json in help', async () => {
      const { stdout } = await runCommand(['template', 'save', '--help'], { root });
      expect(stdout).to.include('-m');
    });
  });

  describe('template update', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['template', 'update', '--help'], { root });
      expect(stdout).to.include('--json');
    });
  });
});
