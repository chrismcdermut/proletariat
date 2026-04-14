/**
 * Tests for PRLT-1239: Auto-bootstrap PMO database on first use.
 *
 * Verifies that PMO tables are automatically created when an HQ workspace.db
 * exists but lacks PMO tables, removing the requirement for explicit `prlt pmo init`.
 */

import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { bootstrapPMOSchema, findPMO } from '../../src/lib/pmo/find-pmo.js';
import { CREATE_TABLES_SQL } from '../../src/lib/database/workspace-schema.js';

describe('PRLT-1239: Auto-bootstrap PMO on first use', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-bootstrap-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  /**
   * Create a minimal workspace.db with core tables but WITHOUT PMO tables.
   * This simulates an HQ created by an older version or with --no-pmo.
   */
  function createWorkspaceDbWithoutPMO(dbPath: string): void {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create core workspace tables only (no PMO tables)
    db.exec(CREATE_TABLES_SQL);

    // Insert workspace record
    db.exec(`
      INSERT OR IGNORE INTO workspace (id, type, workspace_name, has_pmo, created_at)
      VALUES (1, 'hq', 'test-hq', 0, '${new Date().toISOString()}')
    `);

    db.close();
  }

  /**
   * Create a minimal HQ directory structure with config.json.
   */
  function createHQStructure(hqPath: string): string {
    const proletariatDir = path.join(hqPath, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });

    const configPath = path.join(proletariatDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: '1.0.0',
      schemaVersion: 1,
      type: 'hq',
      name: 'test-hq',
    }, null, 2));

    return path.join(proletariatDir, 'workspace.db');
  }

  describe('bootstrapPMOSchema()', () => {
    it('creates PMO tables in a workspace.db that lacks them', () => {
      const hqPath = path.join(tmpDir, 'test-hq');
      const dbPath = createHQStructure(hqPath);
      createWorkspaceDbWithoutPMO(dbPath);

      // Verify PMO tables don't exist yet
      const dbBefore = new Database(dbPath);
      const before = dbBefore.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
      ).get();
      dbBefore.close();
      expect(before).to.be.undefined;

      // Bootstrap
      const result = bootstrapPMOSchema(dbPath, hqPath);
      expect(result).to.be.true;

      // Verify PMO tables now exist (PRLT-1299: pmo_tickets and pmo_workflows removed)
      const dbAfter = new Database(dbPath);
      const pmoProjects = dbAfter.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
      ).get() as { name: string } | undefined;
      const pmoSettings = dbAfter.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_settings'"
      ).get() as { name: string } | undefined;
      dbAfter.close();

      expect(pmoProjects).to.not.be.undefined;
      expect(pmoSettings).to.not.be.undefined;
    });

    it('sets default pmo_path setting to "pmo"', () => {
      const hqPath = path.join(tmpDir, 'test-hq');
      const dbPath = createHQStructure(hqPath);
      createWorkspaceDbWithoutPMO(dbPath);

      bootstrapPMOSchema(dbPath, hqPath);

      const db = new Database(dbPath);
      const setting = db.prepare(
        "SELECT value FROM pmo_settings WHERE key = 'pmo_path'"
      ).get() as { value: string } | undefined;
      db.close();

      expect(setting).to.not.be.undefined;
      expect(setting!.value).to.equal('pmo');
    });

    it('creates the pmo directory if it does not exist', () => {
      const hqPath = path.join(tmpDir, 'test-hq');
      const dbPath = createHQStructure(hqPath);
      createWorkspaceDbWithoutPMO(dbPath);

      const pmoDir = path.join(hqPath, 'pmo');
      expect(fs.existsSync(pmoDir)).to.be.false;

      bootstrapPMOSchema(dbPath, hqPath);

      expect(fs.existsSync(pmoDir)).to.be.true;
    });

    it('is idempotent — safe to call when PMO tables already exist', () => {
      const hqPath = path.join(tmpDir, 'test-hq');
      const dbPath = createHQStructure(hqPath);
      createWorkspaceDbWithoutPMO(dbPath);

      // Bootstrap twice
      const result1 = bootstrapPMOSchema(dbPath, hqPath);
      const result2 = bootstrapPMOSchema(dbPath, hqPath);

      expect(result1).to.be.true;
      expect(result2).to.be.true;

      // Verify tables still exist and aren't duplicated
      const db = new Database(dbPath);
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pmo_%'"
      ).all() as { name: string }[];
      db.close();

      // Each table name should appear exactly once
      const tableNames = tables.map(t => t.name);
      const uniqueNames = [...new Set(tableNames)];
      expect(tableNames.length).to.equal(uniqueNames.length);
    });

    it('does not overwrite existing pmo_path setting', () => {
      const hqPath = path.join(tmpDir, 'test-hq');
      const dbPath = createHQStructure(hqPath);
      createWorkspaceDbWithoutPMO(dbPath);

      // First bootstrap sets pmo_path
      bootstrapPMOSchema(dbPath, hqPath);

      // Manually change pmo_path
      const db = new Database(dbPath);
      db.prepare("UPDATE pmo_settings SET value = ? WHERE key = 'pmo_path'").run('custom/pmo');
      db.close();

      // Second bootstrap should NOT overwrite
      bootstrapPMOSchema(dbPath, hqPath);

      const db2 = new Database(dbPath);
      const setting = db2.prepare(
        "SELECT value FROM pmo_settings WHERE key = 'pmo_path'"
      ).get() as { value: string } | undefined;
      db2.close();

      expect(setting!.value).to.equal('custom/pmo');
    });

    it('returns false when database does not exist', () => {
      const hqPath = path.join(tmpDir, 'nonexistent');
      const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');

      const result = bootstrapPMOSchema(dbPath, hqPath);
      expect(result).to.be.false;
    });

    // PRLT-1299: pmo_workflows and pmo_workflow_statuses tables removed
    it.skip('seeds built-in workflows during bootstrap' /* PRLT-1299: removed */, () => {});

    it.skip('seeds built-in workflow statuses during bootstrap' /* PRLT-1299: removed */, () => {});
  });

  describe('findPMO() auto-bootstrap integration', () => {
    // PRLT-1301: Save/restore env vars so the workspace-sandbox root hook
    // doesn't interfere with findPMO's HQ resolution in these tests.
    let savedHqPath: string | undefined;
    let savedTestEnv: string | undefined;

    beforeEach(() => {
      savedHqPath = process.env.PRLT_HQ_PATH;
      savedTestEnv = process.env.PRLT_TEST_ENV;
    });

    afterEach(() => {
      if (savedHqPath !== undefined) {
        process.env.PRLT_HQ_PATH = savedHqPath;
      } else {
        delete process.env.PRLT_HQ_PATH;
      }
      if (savedTestEnv !== undefined) {
        process.env.PRLT_TEST_ENV = savedTestEnv;
      } else {
        delete process.env.PRLT_TEST_ENV;
      }
    });

    it('auto-bootstraps when HQ has workspace.db without PMO tables', () => {
      const hqPath = path.join(tmpDir, 'test-hq');
      const dbPath = createHQStructure(hqPath);
      createWorkspaceDbWithoutPMO(dbPath);

      // Save and override cwd — use realpath to normalize macOS /private/var symlinks
      const originalCwd = process.cwd();
      process.chdir(hqPath);

      // Clear HQ env vars so findPMO uses cwd-based discovery (which triggers auto-bootstrap)
      delete process.env.PRLT_HQ_PATH;
      delete process.env.PRLT_TEST_ENV;

      try {
        const pmoPath = findPMO();
        expect(pmoPath).to.not.be.null;
        // Normalize both paths to handle macOS /private/var → /var symlinks
        expect(fs.realpathSync(pmoPath!)).to.equal(fs.realpathSync(path.join(hqPath, 'pmo')));

        // Verify PMO tables were created
        const db = new Database(dbPath);
        const table = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
        ).get();
        db.close();
        expect(table).to.not.be.undefined;
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('does not auto-bootstrap when no HQ exists', () => {
      const emptyDir = path.join(tmpDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });

      const originalCwd = process.cwd();
      process.chdir(emptyDir);

      // Clear HQ env vars so findPMO relies on cwd-based discovery (which should find nothing)
      delete process.env.PRLT_HQ_PATH;
      delete process.env.PRLT_TEST_ENV;

      try {
        const pmoPath = findPMO();
        expect(pmoPath).to.be.null;
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Error messages', () => {
    // PRLT-1301: Save/restore env vars so the workspace-sandbox root hook
    // doesn't interfere with "no HQ" error path testing.
    let savedHqPath: string | undefined;
    let savedTestEnv: string | undefined;

    beforeEach(() => {
      savedHqPath = process.env.PRLT_HQ_PATH;
      savedTestEnv = process.env.PRLT_TEST_ENV;
      delete process.env.PRLT_HQ_PATH;
      delete process.env.PRLT_TEST_ENV;
    });

    afterEach(() => {
      if (savedHqPath !== undefined) {
        process.env.PRLT_HQ_PATH = savedHqPath;
      } else {
        delete process.env.PRLT_HQ_PATH;
      }
      if (savedTestEnv !== undefined) {
        process.env.PRLT_TEST_ENV = savedTestEnv;
      } else {
        delete process.env.PRLT_TEST_ENV;
      }
    });

    it('getPMOContext error message does not reference "prlt pmo init"', async () => {
      // getPMOContext should throw with updated error message when no workspace found
      const { getPMOContext } = await import('../../src/lib/pmo/pmo-context.js');

      const emptyDir = path.join(tmpDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });

      const originalCwd = process.cwd();
      process.chdir(emptyDir);

      try {
        await getPMOContext();
        expect.fail('Should have thrown');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).to.not.include('pmo init');
        expect(message).to.include('prlt new');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
