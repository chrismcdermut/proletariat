import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { RuntimeCommand, machineOutputFlags, runtimeBaseFlags } from '../../src/lib/runtime-command.js';
import { PMOCommand, pmoBaseFlags } from '../../src/lib/pmo/index.js';
import { CREATE_TABLES_SQL } from '../../src/lib/database/workspace-schema.js';
import { Flags, Config } from '@oclif/core';
import { runDrizzleMigrations } from '../../src/lib/database/migrator.js';
import { ALL_MIGRATIONS } from '../../src/lib/database/migrations/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Unit tests for RuntimeCommand base class.
 *
 * Validates the command hierarchy: PromptCommand → RuntimeCommand → PMOCommand
 * and that RuntimeCommand works as a standalone base for commands that need
 * workspace.db but NOT a ticket provider (PMO, Linear, etc.).
 */
describe('RuntimeCommand', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  // Save container env vars to restore after each test
  let savedHqPath: string | undefined;
  let savedDevcontainer: string | undefined;
  let savedTestEnv: string | undefined;
  let savedAgentName: string | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();

    // Save and override env vars so tests don't pick up the container's /hq
    savedHqPath = process.env.PRLT_HQ_PATH;
    savedDevcontainer = process.env.DEVCONTAINER;
    savedTestEnv = process.env.PRLT_TEST_ENV;
    savedAgentName = process.env.PRLT_AGENT_NAME;

    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-cmd-test-'));
    process.chdir(testDir);

    // Point PRLT_HQ_PATH to our test dir (with PRLT_TEST_ENV=true to enable it)
    process.env.PRLT_TEST_ENV = 'true';
    process.env.PRLT_HQ_PATH = testDir;
    // Clear container env vars to avoid read-only mount detection
    delete process.env.DEVCONTAINER;
    delete process.env.PRLT_AGENT_NAME;

    // Create minimal HQ workspace structure (no PMO)
    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    // Create workspace.db with core tables (NOT PMO tables)
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    runDrizzleMigrations(db, ALL_MIGRATIONS);
    db.exec(CREATE_TABLES_SQL);

    // Insert workspace row with has_pmo = false
    db.prepare(`
      INSERT OR IGNORE INTO workspace (id, type, workspace_name, has_pmo, created_at)
      VALUES (1, 'hq', 'test-hq', 0, ?)
    `).run(new Date().toISOString());

    db.close();

    // Create HQ config file (required for findHQRoot to work)
    const configPath = path.join(proletariatDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      type: 'hq',
      name: 'test-hq',
      hasPmo: false,
    }), 'utf-8');
  });

  afterEach(() => {
    process.chdir(originalCwd);

    // Restore env vars
    if (savedHqPath !== undefined) {
      process.env.PRLT_HQ_PATH = savedHqPath;
    } else {
      delete process.env.PRLT_HQ_PATH;
    }
    if (savedDevcontainer !== undefined) {
      process.env.DEVCONTAINER = savedDevcontainer;
    } else {
      delete process.env.DEVCONTAINER;
    }
    if (savedTestEnv !== undefined) {
      process.env.PRLT_TEST_ENV = savedTestEnv;
    } else {
      delete process.env.PRLT_TEST_ENV;
    }
    if (savedAgentName !== undefined) {
      process.env.PRLT_AGENT_NAME = savedAgentName;
    } else {
      delete process.env.PRLT_AGENT_NAME;
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('runtimeBaseFlags and machineOutputFlags', () => {
    it('should export machineOutputFlags with json and machine flags', () => {
      expect(machineOutputFlags.json).to.exist;
      expect(machineOutputFlags.machine).to.exist;
    });

    it('should export runtimeBaseFlags that include machineOutputFlags', () => {
      expect(runtimeBaseFlags.json).to.exist;
      expect(runtimeBaseFlags.machine).to.exist;
    });
  });

  describe('RuntimeCommand lifecycle', () => {
    // Testable command that tracks lifecycle events
    class TestRuntimeCommand extends RuntimeCommand {
      static id = 'test-runtime';
      static flags = { ...runtimeBaseFlags };

      static executeCalled = false;
      static cleanupCalled = false;
      static hqPathValue: string | null = null;
      static dbAvailable = false;
      static settingsAvailable = false;
      static workspaceConfigAvailable = false;

      static reset() {
        this.executeCalled = false;
        this.cleanupCalled = false;
        this.hqPathValue = null;
        this.dbAvailable = false;
        this.settingsAvailable = false;
        this.workspaceConfigAvailable = false;
      }

      async execute(): Promise<void> {
        TestRuntimeCommand.executeCalled = true;
        TestRuntimeCommand.hqPathValue = this.hqPath;
        TestRuntimeCommand.dbAvailable = this.db !== null;
        TestRuntimeCommand.settingsAvailable = this.settings !== null;
        TestRuntimeCommand.workspaceConfigAvailable = this.workspaceConfig !== null;
      }

      protected async cleanup(): Promise<void> {
        TestRuntimeCommand.cleanupCalled = true;
        await super.cleanup();
      }
    }

    beforeEach(() => {
      TestRuntimeCommand.reset();
    });

    it('should resolve HQ path in init()', async () => {
      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await TestRuntimeCommand.run([], config);

      expect(TestRuntimeCommand.hqPathValue).to.equal(testDir);
    });

    it('should open workspace.db and provide database access', async () => {
      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await TestRuntimeCommand.run([], config);

      expect(TestRuntimeCommand.dbAvailable).to.be.true;
    });

    it('should provide SettingsStore', async () => {
      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await TestRuntimeCommand.run([], config);

      expect(TestRuntimeCommand.settingsAvailable).to.be.true;
    });

    it('should provide workspace config', async () => {
      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await TestRuntimeCommand.run([], config);

      expect(TestRuntimeCommand.workspaceConfigAvailable).to.be.true;
    });

    it('should call execute() then cleanup()', async () => {
      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await TestRuntimeCommand.run([], config);

      expect(TestRuntimeCommand.executeCalled).to.be.true;
      expect(TestRuntimeCommand.cleanupCalled).to.be.true;
    });

    it('should call cleanup even when execute throws', async () => {
      class ErrorRuntimeCommand extends RuntimeCommand {
        static id = 'test-error-runtime';
        static flags = { ...runtimeBaseFlags };
        static cleanupCalled = false;

        async execute(): Promise<void> {
          throw new Error('Test error from RuntimeCommand');
        }

        protected async cleanup(): Promise<void> {
          ErrorRuntimeCommand.cleanupCalled = true;
          await super.cleanup();
        }
      }

      const config = await Config.load({ root: path.join(__dirname, '../..') });
      try {
        await ErrorRuntimeCommand.run([], config);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect((error as Error).message).to.equal('Test error from RuntimeCommand');
      }

      expect(ErrorRuntimeCommand.cleanupCalled).to.be.true;
    });
  });

  describe('RuntimeCommand without HQ', () => {
    it('should have null hqPath and db when not in an HQ workspace', async () => {
      // Point env to a non-existent HQ so findHQRoot returns null
      const nonHqDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-hq-'));
      process.chdir(nonHqDir);
      process.env.PRLT_HQ_PATH = nonHqDir; // No .proletariat/ here → invalid HQ

      class NoHqCommand extends RuntimeCommand {
        static id = 'test-no-hq';
        static flags = { ...runtimeBaseFlags };
        static hqPathValue: string | null = 'should-be-null';
        static dbAvailable: boolean | null = null;

        async execute(): Promise<void> {
          NoHqCommand.hqPathValue = this.hqPath;
          NoHqCommand.dbAvailable = this.db !== null;
        }
      }

      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await NoHqCommand.run([], config);

      expect(NoHqCommand.hqPathValue).to.be.null;
      expect(NoHqCommand.dbAvailable).to.be.false;

      fs.rmSync(nonHqDir, { recursive: true, force: true });
    });

    it('requireHQ() should throw when not in HQ workspace', async () => {
      const nonHqDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-hq-'));
      process.chdir(nonHqDir);
      process.env.PRLT_HQ_PATH = nonHqDir;

      class RequireHqCommand extends RuntimeCommand {
        static id = 'test-require-hq';
        static flags = { ...runtimeBaseFlags };
        static threwError = false;
        static errorMessage = '';

        async execute(): Promise<void> {
          try {
            this.requireHQ();
          } catch (error: unknown) {
            RequireHqCommand.threwError = true;
            RequireHqCommand.errorMessage = (error as Error).message;
          }
        }
      }

      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await RequireHqCommand.run([], config);

      expect(RequireHqCommand.threwError).to.be.true;
      expect(RequireHqCommand.errorMessage).to.include('prlt new');

      fs.rmSync(nonHqDir, { recursive: true, force: true });
    });
  });

  describe('RuntimeCommand settings access', () => {
    it('should read and write workspace_settings via SettingsStore', async () => {
      class SettingsCommand extends RuntimeCommand {
        static id = 'test-settings';
        static flags = { ...runtimeBaseFlags };
        static readValue: string | null = null;
        static hasValue = false;

        async execute(): Promise<void> {
          const settings = this.requireSettings();
          settings.set('test.key', 'test-value');
          SettingsCommand.readValue = settings.get('test.key');
          SettingsCommand.hasValue = settings.has('test.key');
        }
      }

      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await SettingsCommand.run([], config);

      expect(SettingsCommand.readValue).to.equal('test-value');
      expect(SettingsCommand.hasValue).to.be.true;
    });
  });

  describe('RuntimeCommand works without PMO tables', () => {
    it('should initialize successfully with workspace.db that has no PMO tables', async () => {
      // The test setup creates workspace.db WITHOUT PMO tables
      // This verifies RuntimeCommand doesn't need PMO to function

      class NoPmoCommand extends RuntimeCommand {
        static id = 'test-no-pmo';
        static flags = { ...runtimeBaseFlags };
        static succeeded = false;
        static hasPmo: boolean | null = null;

        async execute(): Promise<void> {
          NoPmoCommand.succeeded = true;
          NoPmoCommand.hasPmo = this.workspaceConfig?.has_pmo ?? null;
        }
      }

      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await NoPmoCommand.run([], config);

      expect(NoPmoCommand.succeeded).to.be.true;
      expect(NoPmoCommand.hasPmo).to.be.false;
    });
  });

  describe('PMOCommand still works extending RuntimeCommand', () => {
    it('PMOCommand should be a subclass of RuntimeCommand', () => {
      expect(PMOCommand.prototype).to.be.instanceOf(RuntimeCommand);
    });

    it('pmoBaseFlags should include project flag', () => {
      expect(pmoBaseFlags.project).to.exist;
      expect(pmoBaseFlags.project.char).to.equal('P');
    });

    it('machineOutputFlags re-exported from pmo/index should match RuntimeCommand export', async () => {
      const { machineOutputFlags: pmoFlags } = await import('../../src/lib/pmo/index.js');
      // They should be the same object (re-export, not copy)
      expect(pmoFlags).to.equal(machineOutputFlags);
    });
  });

  describe('Command hierarchy', () => {
    it('RuntimeCommand extends PromptCommand', async () => {
      const { PromptCommand } = await import('../../src/lib/prompt-command.js');
      expect(RuntimeCommand.prototype).to.be.instanceOf(PromptCommand);
    });

    it('PMOCommand extends RuntimeCommand', () => {
      expect(PMOCommand.prototype).to.be.instanceOf(RuntimeCommand);
    });

    it('RuntimeCommand is NOT a PMOCommand', async () => {
      // RuntimeCommand should not require PMO
      expect(RuntimeCommand.prototype).to.not.be.instanceOf(PMOCommand);
    });
  });
});
