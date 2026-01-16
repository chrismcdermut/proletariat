import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { PMOCommand, pmoBaseFlags } from '../../src/lib/pmo/index.js';
import { PMO_SCHEMA_SQL } from '../../src/lib/pmo/schema.js';
import { Flags, Config } from '@oclif/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Unit tests for PMOCommand base class
 * Tests the automatic initialization and cleanup behavior
 */
describe('PMO Base Command', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-base-cmd-test-'));
    process.chdir(testDir);

    // Setup test environment
    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    db = new Database(dbPath);
    setupTestDatabase(db);
  });

  afterEach(() => {
    if (db) db.close();
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('pmoBaseFlags', () => {
    it('should include project flag with -P shorthand', () => {
      expect(pmoBaseFlags.project).to.exist;
      expect(pmoBaseFlags.project.char).to.equal('P');
    });

    it('should have correct description', () => {
      expect(pmoBaseFlags.project.description).to.include('Project ID');
    });
  });

  describe('PMOCommand class structure', () => {
    // Test command that tracks what happens during execution
    class TestableCommand extends PMOCommand {
      static id = 'testable';
      static flags = {
        ...pmoBaseFlags,
        testFlag: Flags.string({ description: 'Test flag' }),
      };

      // Track lifecycle events
      static initCalled = false;
      static executeCalled = false;
      static cleanupCalled = false;
      static contextWasAvailable = false;
      static pmoPathValue: string | undefined;
      static projectIdValue: string | undefined;
      static projectNameValue: string | undefined;
      static columnsValue: string[] | undefined;
      static storageAvailable = false;

      static reset() {
        this.initCalled = false;
        this.executeCalled = false;
        this.cleanupCalled = false;
        this.contextWasAvailable = false;
        this.pmoPathValue = undefined;
        this.projectIdValue = undefined;
        this.projectNameValue = undefined;
        this.columnsValue = undefined;
        this.storageAvailable = false;
      }

      async init(): Promise<void> {
        TestableCommand.initCalled = true;
        await super.init();
      }

      async execute(): Promise<void> {
        TestableCommand.executeCalled = true;
        TestableCommand.contextWasAvailable = !!this.pmoContext;
        TestableCommand.storageAvailable = !!this.storage;

        if (this.pmoContext) {
          TestableCommand.pmoPathValue = this.pmoPath;
          TestableCommand.projectIdValue = this.projectId;
          TestableCommand.projectNameValue = this.projectName;
          TestableCommand.columnsValue = this.columns;
        }
      }

      protected async cleanup(): Promise<void> {
        TestableCommand.cleanupCalled = true;
        await super.cleanup();
      }
    }

    // Command that tests requireProject()
    class RequireProjectCommand extends PMOCommand {
      static id = 'requireproject';
      static flags = { ...pmoBaseFlags };
      static projectIdValue: string | undefined;

      static reset() {
        this.projectIdValue = undefined;
      }

      async execute(): Promise<void> {
        // When requireProject is called, it should return a project ID
        RequireProjectCommand.projectIdValue = await this.requireProject();
      }
    }

    // Command that throws during execute
    class ErrorCommand extends PMOCommand {
      static id = 'errortest';
      static flags = { ...pmoBaseFlags };
      static cleanupCalled = false;

      static reset() {
        this.cleanupCalled = false;
      }

      async execute(): Promise<void> {
        throw new Error('Test error');
      }

      protected async cleanup(): Promise<void> {
        ErrorCommand.cleanupCalled = true;
        await super.cleanup();
      }
    }

    beforeEach(() => {
      TestableCommand.reset();
      RequireProjectCommand.reset();
      ErrorCommand.reset();
    });

    it('should call init before execute', async () => {
      const config = await Config.load({ root: path.join(__dirname, '../..') });
      // Using oclif's proper run flow
      await TestableCommand.run([], config);

      expect(TestableCommand.initCalled).to.be.true;
      expect(TestableCommand.executeCalled).to.be.true;
    });

    it('should have PMO context available in execute', async () => {
      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await TestableCommand.run([], config);

      expect(TestableCommand.contextWasAvailable).to.be.true;
      expect(TestableCommand.storageAvailable).to.be.true;
    });

    it('should provide correct context values via getters', async () => {
      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await TestableCommand.run([], config);

      expect(TestableCommand.pmoPathValue).to.be.a('string');
      // Project ID defaults to 'default' when no project is selected
      expect(TestableCommand.projectIdValue).to.be.a('string');
    });

    it('should call cleanup after execute', async () => {
      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await TestableCommand.run([], config);

      expect(TestableCommand.cleanupCalled).to.be.true;
    });

    it('should call cleanup even when execute throws', async () => {
      const config = await Config.load({ root: path.join(__dirname, '../..') });

      try {
        await ErrorCommand.run([], config);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).to.equal('Test error');
      }

      expect(ErrorCommand.cleanupCalled).to.be.true;
    });

    it('should allow requireProject to get a project ID', async () => {
      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await RequireProjectCommand.run([], config);

      // Since there's only one project in test DB, it should be selected automatically
      expect(RequireProjectCommand.projectIdValue).to.equal('test-project');
    });

    it('should use -P flag when provided for requireProject', async () => {
      const config = await Config.load({ root: path.join(__dirname, '../..') });
      await RequireProjectCommand.run(['-P', 'test-project'], config);

      expect(RequireProjectCommand.projectIdValue).to.equal('test-project');
    });
  });
});

// Helper functions
function setupTestDatabase(db: Database.Database) {
  // Use actual PMO schema from the single source of truth
  db.exec(PMO_SCHEMA_SQL);

  // Insert test data
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description)
    VALUES ('test-project', 'Test Project', 'Test project for base command')
  `).run();

  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', 'pmo'), ('current_project', 'test-project')
  `).run();

  const columns = [
    { id: 'backlog', name: 'SHIP BL', position: 0 },
    { id: 'ready', name: 'Ready', position: 1 },
    { id: 'in-progress', name: 'In Progress', position: 2 },
    { id: 'in-review', name: 'In Review', position: 3 },
    { id: 'merged', name: 'Merged', position: 4 },
    { id: 'done', name: 'Done', position: 5 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `).run(col.id, col.name, col.position);
  }

  // Workflow statuses (kanban template)
  const statuses = [
    { id: 'status-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'status-todo', name: 'Todo', category: 'unstarted', position: 0 },
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 0 },
    { id: 'status-in-review', name: 'In Review', category: 'started', position: 1 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 0 },
    { id: 'status-canceled', name: 'Canceled', category: 'canceled', position: 0 },
  ];

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_statuses (id, project_id, name, category, position, is_default)
      VALUES (?, 'test-project', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }

  // Create HQ config file (required for findPMO to work)
  const proletariatDir = path.join(process.cwd(), '.proletariat');
  const configPath = path.join(proletariatDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    type: 'hq',
    name: 'test-hq',
    hasPmo: true,
  }), 'utf-8');

  // Create PMO directory structure
  const pmoPath = path.join(process.cwd(), 'pmo/projects/test-project');
  fs.mkdirSync(pmoPath, { recursive: true });
}
