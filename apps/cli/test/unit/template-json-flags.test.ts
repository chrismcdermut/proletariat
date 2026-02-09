import { expect } from 'chai';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, '../../bin/run.js');

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
 */
describe('Template Commands Machine Output Mode Support', () => {
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

  // Helper to run CLI and get output
  function runCli(args: string, options?: { cwd?: string }): string {
    try {
      return execSync(`node ${CLI_PATH} ${args} 2>&1`, {
        encoding: 'utf-8',
        timeout: 10000,
        env: getIsolatedEnv(),
        cwd: options?.cwd,
      });
    } catch (error) {
      // Return stderr/stdout even on error (JSON mode exits with code 2)
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

  // Minimal workspace for tests that run commands (not just --help)
  let tempHQ: string;
  let db: Database.Database;

  before(() => {
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
  });

  after(() => {
    if (db) db.close();
    if (tempHQ && fs.existsSync(tempHQ)) {
      fs.rmSync(tempHQ, { recursive: true, force: true });
    }
  });

  describe('template index (machineOutputFlags)', () => {
    it('should have --json flag with -m shorthand in help', () => {
      const output = runCli('template --help');
      expect(output).to.include('--json');
      expect(output).to.include('-m');
    });

    it('should output JSON with command field for each choice', () => {
      const output = runCli('template --json', { cwd: tempHQ });
      const json = parseJson(output) as { prompt: { type: string; choices: Array<{ command?: string }> } };
      expect(json).to.not.be.null;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.every((c) => c.command !== undefined)).to.be.true;
    });

    it('should include navigation commands in choices', () => {
      const output = runCli('template --json', { cwd: tempHQ });
      const json = parseJson(output) as { prompt: { choices: Array<{ command: string }> } };
      expect(json).to.not.be.null;
      const commands = json.prompt.choices.map((c) => c.command);
      expect(commands).to.include('prlt template list --json');
      expect(commands).to.include('prlt template create --json');
      expect(commands).to.include('prlt template apply --json');
    });
  });

  describe('template delete (machineOutputFlags via pmoBaseFlags)', () => {
    it('should have --json flag with -m shorthand in help', () => {
      const output = runCli('template delete --help');
      expect(output).to.include('--json');
      expect(output).to.include('-m');
    });
  });

  describe('template create', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template create --help');
      expect(output).to.include('--json');
    });

    it('should have --subtask flag in help', () => {
      const output = runCli('template create --help');
      expect(output).to.include('--subtask');
    });

    it('should have --ac flag in help', () => {
      const output = runCli('template create --help');
      expect(output).to.include('--ac');
    });

    it('should have --label flag in help', () => {
      const output = runCli('template create --help');
      expect(output).to.include('--label');
    });

    it('should have --title-pattern flag in help', () => {
      const output = runCli('template create --help');
      expect(output).to.include('--title-pattern');
    });

    it('should have --description-template flag in help', () => {
      const output = runCli('template create --help');
      expect(output).to.include('--description-template');
    });

    it('should have --priority flag in help', () => {
      const output = runCli('template create --help');
      expect(output).to.include('--priority');
    });

    it('should have --category flag in help', () => {
      const output = runCli('template create --help');
      expect(output).to.include('--category');
    });

    it('should output JSON type prompt when --json is used without --type', () => {
      const output = runCli('template create --json', { cwd: tempHQ });
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
    it('should have --json flag in help', () => {
      const output = runCli('template list --help');
      expect(output).to.include('--json');
    });
  });

  describe('template apply', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template apply --help');
      expect(output).to.include('--json');
    });
  });

  describe('template save', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template save --help');
      expect(output).to.include('--json');
    });

    it('should have --template-name flag in help', () => {
      const output = runCli('template save --help');
      expect(output).to.include('--template-name');
      expect(output).to.include('-n');
    });

    it('should have -m shorthand for --json in help', () => {
      const output = runCli('template save --help');
      expect(output).to.include('-m');
    });
  });

  describe('template update', () => {
    it('should have --json flag in help', () => {
      const output = runCli('template update --help');
      expect(output).to.include('--json');
    });
  });
});
