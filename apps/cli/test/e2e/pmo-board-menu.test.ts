import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { exec, extractJson, type AgentPromptResponse } from './test-helpers.js';

/**
 * End-to-end tests for PMO Board Commands (board/index.ts and board/watch.ts)
 * Tests the this.prompt() migration for JSON mode support.
 *
 * Tests:
 * - board --json (JSON mode menu prompt schema)
 * - board --action view (view board)
 * - board --action markdown (show board as markdown)
 * - board --action export (export board.md)
 * - board --action sync --force (sync from board.md)
 */
describe('PMO Board Menu E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-board-menu-e2e-'));
    process.chdir(testDir);

    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    // Create HQ config file
    fs.writeFileSync(path.join(proletariatDir, 'config.json'), JSON.stringify({
      type: 'hq',
      name: 'test-hq',
      hasPmo: true,
    }), 'utf-8');

    // Create PMO directory structure
    fs.mkdirSync(path.join(testDir, 'pmo/projects/default'), { recursive: true });

    // Create PMO config file
    fs.writeFileSync(path.join(testDir, 'pmo', 'config.json'), JSON.stringify({
      storage: 'sqlite',
      template: 'default',
      boardName: 'kanban',
      columns: ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'],
      created: new Date().toISOString(),
    }), 'utf-8');

    // Create an empty database file - the CLI will create schema on first access
    const db = new Database(dbPath);
    db.close();

    // Run a simple command to initialize the database with proper schema
    // This lets the CLI's own schema creation handle all tables, migrations, and seeding
    // The pmo init would be interactive, so instead we manually seed the project after schema creation
    try {
      // This will fail ("No projects found") but still creates the schema
      exec('board --action view');
    } catch {
      // Expected - no project yet
    }

    // Now create the default project in the initialized DB
    const initDb = new Database(dbPath);
    initDb.pragma('foreign_keys = ON');
    const now = new Date().toISOString();
    initDb.prepare(`
      INSERT OR IGNORE INTO pmo_projects (id, name, workflow_id, is_archived, status, created_at, updated_at)
      VALUES ('default', 'Default Project', 'default', 0, 'active', ?, ?)
    `).run(now, now);
    initDb.prepare(`INSERT OR IGNORE INTO pmo_settings (key, value) VALUES ('current_project', 'default')`).run();
    initDb.close();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('board --json (JSON mode prompt schema)', () => {
    it('should output prompt schema with choices in JSON mode', () => {
      const output = exec('board --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt).to.have.property('type', 'list');
      expect(json!.prompt).to.have.property('name', 'action');
      expect(json!.prompt).to.have.property('message');
      expect(json!.prompt.message).to.include('Board Operations');
    });

    it('should include all menu choices', () => {
      const output = exec('board --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      const choices = json!.prompt.choices;
      expect(choices).to.be.an('array');

      const values = choices.map(c => c.value);
      expect(values).to.include('view');
      expect(values).to.include('open');
      expect(values).to.include('markdown');
      expect(values).to.include('export');
      expect(values).to.include('sync');
      expect(values).to.include('watch');
      expect(values).to.include('cancel');
    });

    it('should include command field on each choice for agent navigation', () => {
      const output = exec('board --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      const choices = json!.prompt.choices;

      // All non-cancel choices should have command fields
      const actionChoices = choices.filter(c => c.value !== 'cancel');
      for (const choice of actionChoices) {
        expect(choice.command, `Choice "${choice.name}" missing command`).to.be.a('string');
        expect(choice.command!.length, `Choice "${choice.name}" has empty command`).to.be.greaterThan(0);
      }
    });

    it('should include command fields with --action pattern', () => {
      const output = exec('board --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      const choices = json!.prompt.choices;

      const viewChoice = choices.find(c => c.value === 'view');
      expect(viewChoice).to.not.be.undefined;
      expect(viewChoice!.command).to.include('--action view');

      const exportChoice = choices.find(c => c.value === 'export');
      expect(exportChoice).to.not.be.undefined;
      expect(exportChoice!.command).to.include('--action export');

      const syncChoice = choices.find(c => c.value === 'sync');
      expect(syncChoice).to.not.be.undefined;
      expect(syncChoice!.command).to.include('--action sync');
      expect(syncChoice!.command).to.include('--force');
    });

    it('should include metadata in JSON output', () => {
      const output = exec('board --json');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata).to.have.property('command', 'board');
    });
  });

  describe('board --action view', () => {
    it('should display empty board', () => {
      const output = exec('board --action view');

      expect(output).to.include('Default');
      expect(output).to.include('Total:');
    });

    it('should display board with tickets organized by column', () => {
      createTestTicket(dbPath, 'TKT-001', 'Add login screen', 'default-backlog', 'P1');
      createTestTicket(dbPath, 'TKT-002', 'Setup CI/CD', 'default-backlog', 'P2');
      createTestTicket(dbPath, 'TKT-003', 'Implement navigation', 'default-in-progress', 'P1');

      const output = exec('board --action view');

      expect(output).to.include('TKT-001');
      expect(output).to.include('Add login screen');
      expect(output).to.include('TKT-002');
      expect(output).to.include('Setup CI/CD');
      expect(output).to.include('TKT-003');
      expect(output).to.include('Implement navigation');
    });

    it('should show ticket counts per column', () => {
      createTestTicket(dbPath, 'TKT-001', 'Ticket 1', 'default-backlog', 'P1');
      createTestTicket(dbPath, 'TKT-002', 'Ticket 2', 'default-backlog', 'P2');

      const output = exec('board --action view');

      expect(output).to.include('(2)');
    });

    it('should show total ticket count', () => {
      createTestTicket(dbPath, 'TKT-001', 'Ticket 1', 'default-backlog', 'P1');
      createTestTicket(dbPath, 'TKT-002', 'Ticket 2', 'default-in-progress', 'P2');

      const output = exec('board --action view');

      expect(output).to.include('Total: 2 tickets');
    });
  });

  describe('board --action markdown', () => {
    it('should output board as markdown', () => {
      createTestTicket(dbPath, 'TKT-001', 'Login feature', 'default-backlog', 'P1');

      const output = exec('board --action markdown');

      // Board markdown should contain ticket info
      expect(output).to.include('TKT-001');
      expect(output).to.include('Login feature');
    });

    it('should output markdown for empty board', () => {
      const output = exec('board --action markdown');

      // Should not error on empty board
      expect(output).to.be.a('string');
    });
  });

  describe('board --action export', () => {
    it('should export board to kanban.md file', () => {
      createTestTicket(dbPath, 'TKT-001', 'Export test', 'default-backlog', 'P1');

      const output = exec('board --action export');

      expect(output).to.include('Exported board');

      // Verify file was created
      const kanbanPath = path.join(testDir, 'pmo', 'projects', 'default', 'kanban.md');
      expect(fs.existsSync(kanbanPath)).to.be.true;

      const content = fs.readFileSync(kanbanPath, 'utf-8');
      expect(content).to.include('TKT-001');
      expect(content).to.include('Export test');
    });

    it('should overwrite existing export file', () => {
      createTestTicket(dbPath, 'TKT-001', 'First export', 'default-backlog', 'P1');
      exec('board --action export');

      // Add another ticket and re-export
      createTestTicket(dbPath, 'TKT-002', 'Second export', 'default-backlog', 'P2');
      exec('board --action export');

      const kanbanPath = path.join(testDir, 'pmo', 'projects', 'default', 'kanban.md');
      const content = fs.readFileSync(kanbanPath, 'utf-8');
      expect(content).to.include('TKT-001');
      expect(content).to.include('TKT-002');
    });
  });

  describe('board --action sync --force', () => {
    it('should sync from exported board.md successfully', () => {
      createTestTicket(dbPath, 'TKT-001', 'Sync test', 'default-backlog', 'P1');

      // Export to create the file
      exec('board --action export');

      // Sync should complete without error (either "already in sync" or "synced")
      const output = exec('board --action sync --force');

      // Should either be in sync or apply changes
      expect(output).to.satisfy((s: string) =>
        s.includes('synced') || s.includes('already in sync')
      );
    });

    it('should detect and apply changes from modified board.md', () => {
      createTestTicket(dbPath, 'TKT-001', 'Original title', 'default-backlog', 'P1');

      // Export to create the file
      exec('board --action export');

      // Modify the board.md file - change ticket title
      const kanbanPath = path.join(testDir, 'pmo', 'projects', 'default', 'kanban.md');
      let content = fs.readFileSync(kanbanPath, 'utf-8');
      content = content.replace('Original title', 'Modified title');
      fs.writeFileSync(kanbanPath, content);

      // Sync with --force to bypass confirmation
      const output = exec('board --action sync --force');

      expect(output).to.include('synced');
    });

    it('should error when board.md does not exist', () => {
      const output = exec('board --action sync --force');

      expect(output.toLowerCase()).to.satisfy((s: string) =>
        s.includes('not found') || s.includes('board.md') || s.includes('error')
      );
    });
  });

  describe('board with project flag', () => {
    it('should use specified project with -P flag', () => {
      const output = exec('board --action view -P default');

      expect(output).to.include('Total:');
    });

    it('should show project name in JSON mode', () => {
      const output = exec('board --json -P default');
      const json = extractJson<AgentPromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.message).to.include('Board Operations');
    });
  });
});

/**
 * Create a test ticket directly in the database.
 * Opens a new DB connection, inserts the ticket, and closes.
 * This ensures the CLI subprocess sees the data.
 */
function createTestTicket(
  dbPath: string,
  id: string,
  title: string,
  statusId: string,
  priority: string,
) {
  const db = new Database(dbPath);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO pmo_tickets (
      id, project_id, title, description, priority, category,
      status, status_id, labels, created_at, updated_at
    )
    VALUES (?, 'default', ?, ?, ?, 'feature', 'backlog', ?, '[]', ?, ?)
  `).run(id, title, `Description for ${title}`, priority, statusId, now, now);

  db.close();
}
