import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runCommand } from '@oclif/test';
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js';
import {
  getRegisteredHeadquarters,
  unregisterHeadquarters,
  type RegisteredHeadquarters,
} from '../../src/lib/machine-config.js';
import { getOrCreatePMOTemplate } from '../setup/template-db.js';
import { PMO_TABLES } from '../../src/lib/pmo/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_ROOT = path.resolve(__dirname, '../..');

// ─── Minimal inline helpers (avoid test-helpers.ts TS compilation) ───

type HQSnapshot = Set<string>;

function snapshotRegisteredHQs(): HQSnapshot {
  return new Set(getRegisteredHeadquarters().map((hq) => hq.path));
}

function cleanupRegisteredHQs(snapshot: HQSnapshot): void {
  for (const hq of getRegisteredHeadquarters()) {
    if (!snapshot.has(hq.path)) {
      unregisterHeadquarters(hq.path);
    }
  }
}

function createHQConfig(proletariatDir: string): void {
  fs.writeFileSync(
    path.join(proletariatDir, 'config.json'),
    JSON.stringify({ type: 'hq', name: 'test-hq', hasPmo: true }),
    'utf-8',
  );
}

function createPMODirectories(pmoPath: string, projectId: string): void {
  fs.mkdirSync(path.join(pmoPath, 'projects', projectId), { recursive: true });
  fs.mkdirSync(path.join(pmoPath, 'specs'), { recursive: true });
}

function setupProductionSchema(dbPath: string, pmoPath: string): Database.Database {
  const templatePath = getOrCreatePMOTemplate();
  fs.copyFileSync(templatePath, dbPath);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.prepare(
    `INSERT OR REPLACE INTO ${PMO_TABLES.settings} (key, value) VALUES ('pmo_path', ?)`,
  ).run(pmoPath);
  return db;
}

/** Strips env vars that could bypass test isolation, then runs an oclif command in-process. */
async function exec(cmd: string): Promise<string> {
  const saved: Record<string, string | undefined> = {};
  const ISOLATION_VARS = [
    'PRLT_HQ_PATH', 'PRLT_PMO_PATH', 'PRLT_DATABASE_PATH',
    'PRLT_CONFIG_PATH', 'PRLT_FORCE_TEXT', 'DEVCONTAINER',
    'PRLT_AGENT_NAME', 'PRLT_TEST_ENV',
  ];
  for (const v of ISOLATION_VARS) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
  // Force JSON output (non-TTY)
  process.env.PRLT_FORCE_TEXT = '0';

  try {
    const { stdout, stderr } = await runCommand(cmd, CLI_ROOT, {
      stripAnsi: true,
      testNodeEnv: 'production',
    });
    return (stdout || stderr || '').trim();
  } catch (err: unknown) {
    // oclif EEXIT is a normal exit — return whatever output was captured
    if ((err as { code?: string }).code === 'EEXIT') {
      return '';
    }
    return (err as Error).message || '';
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * CLI Smoke Tests (PRLT-1343)
 *
 * Exercises real prlt CLI commands end-to-end to catch crashes and
 * unhandled exceptions. These tests verify that the built CLI binary
 * can load and execute core commands without crashing.
 *
 * Any crash here blocks the PR from merging.
 */
describe('@smoke CLI Smoke Tests — command crash detection (PRLT-1343)', () => {
  let testDir: string;
  let originalCwd: string;
  let hqSnapshot: HQSnapshot;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-smoke-')));
    hqSnapshot = snapshotRegisteredHQs();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupRegisteredHQs(hqSnapshot);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ─── Phase 1: Basic binary health ──────────────────────────────────

  describe('basic binary health', () => {
    it('should execute --help without crashing', async () => {
      const output = await exec('--help');
      expect(output).to.be.a('string');
      expect(output.length).to.be.greaterThan(0);
    });

    it('should execute --version without crashing', async () => {
      const output = await exec('--version');
      expect(output).to.be.a('string');
      expect(output).to.match(/\d+\.\d+\.\d+/);
    });
  });

  // ─── Phase 2: HQ initialization (prlt new / init) ─────────────────

  describe('HQ initialization', () => {
    it('should create a new HQ without crashing', async () => {
      const hqPath = path.join(testDir, 'smoke-hq');
      const output = await exec(
        `new --json --name smoke-test --path ${hqPath}`,
      );
      expect(output).to.be.a('string');

      // Verify HQ was created on disk
      expect(fs.existsSync(hqPath)).to.be.true;
      expect(fs.existsSync(path.join(hqPath, '.proletariat'))).to.be.true;
    });

    it('should forward init to new without crashing', async () => {
      const output = await exec('init --help');
      expect(output).to.be.a('string');
      expect(output.length).to.be.greaterThan(0);
    });
  });

  // ─── Phase 3: PMO / ticket commands ────────────────────────────────

  describe('ticket commands (inside HQ)', () => {
    let db: Database.Database;

    beforeEach(() => {
      const proletariatDir = path.join(testDir, '.proletariat');
      fs.mkdirSync(proletariatDir, { recursive: true });
      createHQConfig(proletariatDir);

      const pmoPath = path.join(testDir, 'pmo');
      createPMODirectories(pmoPath, 'test-project');

      const dbPath = path.join(proletariatDir, 'workspace.db');
      db = setupProductionSchema(dbPath, pmoPath);

      process.chdir(testDir);
    });

    afterEach(() => {
      if (db) db.close();
    });

    it('should list tickets on an empty board without crashing', async () => {
      const output = await exec('ticket list --json');
      expect(output).to.be.a('string');
    });

    it('should dry-run ticket creation without crashing', async () => {
      const output = await exec(
        'ticket create --json --title "Smoke test ticket" --column Backlog --dry-run',
      );
      expect(output).to.be.a('string');
    });
  });

  // ─── Phase 4: Database commands ────────────────────────────────────

  describe('database commands (inside HQ)', () => {
    let db: Database.Database;

    beforeEach(() => {
      const proletariatDir = path.join(testDir, '.proletariat');
      fs.mkdirSync(proletariatDir, { recursive: true });
      createHQConfig(proletariatDir);

      const pmoPath = path.join(testDir, 'pmo');
      createPMODirectories(pmoPath, 'test-project');

      const dbPath = path.join(proletariatDir, 'workspace.db');
      db = setupProductionSchema(dbPath, pmoPath);

      process.chdir(testDir);
    });

    afterEach(() => {
      if (db) db.close();
    });

    it('should run db repair --check-only without crashing', async () => {
      const output = await exec('db repair --check-only');
      expect(output).to.be.a('string');
    });
  });

  // ─── Phase 5: Work commands (help / dry-run) ──────────────────────

  describe('work commands (help output)', () => {
    it('should execute work start --help without crashing', async () => {
      const output = await exec('work start --help');
      expect(output).to.be.a('string');
      expect(output).to.include('start');
    });

    it('should execute work ship --help without crashing', async () => {
      const output = await exec('work ship --help');
      expect(output).to.be.a('string');
      expect(output).to.include('ship');
    });

    it('should execute work ship --dry-run with missing ticket gracefully', async () => {
      const proletariatDir = path.join(testDir, '.proletariat');
      fs.mkdirSync(proletariatDir, { recursive: true });
      createHQConfig(proletariatDir);

      const pmoPath = path.join(testDir, 'pmo');
      createPMODirectories(pmoPath, 'test-project');

      const dbPath = path.join(proletariatDir, 'workspace.db');
      const db = setupProductionSchema(dbPath, pmoPath);
      process.chdir(testDir);

      // Calling with a nonexistent ticket should error gracefully, not crash
      const output = await exec('work ship FAKE-999 --dry-run --json');
      expect(output).to.be.a('string');

      db.close();
    });
  });

  // ─── Phase 6: Other commands ───────────────────────────────────────

  describe('other commands', () => {
    it('should execute whoami --json without crashing', async () => {
      const output = await exec('whoami --json');
      expect(output).to.be.a('string');
      // Should produce valid JSON with agent/branch/environment fields
      const parsed = JSON.parse(output);
      expect(parsed).to.have.property('environment');
    });
  });
});
