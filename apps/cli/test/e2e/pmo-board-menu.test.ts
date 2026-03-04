import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import {
  exec,
  agentExec,
  findChoice,
  findChoiceByValue,
  execChoice,
  execFinal,
  setupProductionSchema,
} from './test-helpers.js';

/**
 * End-to-end tests for PMO Board Commands (board/index.ts and board/watch.ts)
 * Tests the this.prompt() migration for JSON mode support.
 *
 * Full agentic E2E flow tests:
 *   1. board --machine → get menu JSON with choices
 *   2. findChoice() → pick a menu item
 *   3. execChoice() → extract the command from the choice
 *   4. execFinal() → execute the command, verify END RESULT
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

    // Initialize database with production schema (creates all PMO tables)
    const pmoPath = path.join(testDir, 'pmo');
    const initDb = setupProductionSchema(dbPath, pmoPath);

    // Create the default project
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

  // =========================================================================
  // JSON mode prompt schema validation
  // =========================================================================
  describe('board --machine (prompt schema)', () => {
    it('should output prompt schema with correct structure', () => {
      const menu = agentExec('board --machine');

      expect(menu).to.not.be.null;
      expect(menu!.prompt).to.have.property('type', 'list');
      expect(menu!.prompt).to.have.property('name', 'action');
      expect(menu!.prompt.message).to.include('Board Operations');
    });

    it('should include all menu choices with command fields', () => {
      const menu = agentExec('board --machine');

      expect(menu).to.not.be.null;
      const choices = menu!.prompt.choices;
      expect(choices).to.be.an('array');

      // Verify all expected actions are present
      const values = choices.map(c => c.value);
      expect(values).to.include('view');
      expect(values).to.include('open');
      expect(values).to.include('markdown');
      expect(values).to.include('export');
      expect(values).to.include('sync');
      expect(values).to.include('watch');
      expect(values).to.include('cancel');

      // Every non-cancel choice must have a non-empty command field
      const actionChoices = choices.filter(c => c.value !== 'cancel');
      for (const choice of actionChoices) {
        expect(choice.command, `Choice "${choice.name}" missing command`).to.be.a('string');
        expect(choice.command!.length, `Choice "${choice.name}" has empty command`).to.be.greaterThan(0);
      }
    });

    it('should include metadata with command name', () => {
      const menu = agentExec('board --machine');

      expect(menu).to.not.be.null;
      expect(menu!.metadata).to.have.property('command', 'board');
    });

    it('should include --action pattern and project flag in commands', () => {
      const menu = agentExec('board --machine');

      expect(menu).to.not.be.null;
      const choices = menu!.prompt.choices;

      const viewChoice = findChoiceByValue(choices, 'view');
      expect(viewChoice).to.not.be.undefined;
      expect(viewChoice!.command).to.include('--action view');
      expect(viewChoice!.command).to.include('-P');

      const syncChoice = findChoiceByValue(choices, 'sync');
      expect(syncChoice).to.not.be.undefined;
      expect(syncChoice!.command).to.include('--action sync');
      expect(syncChoice!.command).to.include('--force');
    });
  });

  // =========================================================================
  // Full agentic E2E flows: menu → pick choice → execute → verify result
  // =========================================================================
  describe('full agentic flow: menu → View board', () => {
    it('should navigate: board menu → "View" → display board with tickets', () => {
      createTestTicket(dbPath, 'TKT-101', 'Auth module', 'default-backlog', 'P1');
      createTestTicket(dbPath, 'TKT-102', 'Setup database', 'default-in-progress', 'P2');

      // Step 1: Agent gets the board menu
      const menu = agentExec('board --machine');
      expect(menu).to.not.be.null;

      // Step 2: Agent finds the "View" choice
      const viewChoice = findChoice(menu!.prompt.choices, 'View board');
      expect(viewChoice).to.not.be.undefined;
      expect(viewChoice!.command).to.be.a('string');

      // Step 3: Agent executes the command from the choice
      const result = execFinal(execChoice(viewChoice!));

      // Step 4: Verify end result - board displays with all tickets
      expect(result).to.include('TKT-101');
      expect(result).to.include('Auth module');
      expect(result).to.include('TKT-102');
      expect(result).to.include('Setup database');
      expect(result).to.include('Total: 2 tickets');
    });

    it('should navigate: board menu → "View" → display empty board', () => {
      const menu = agentExec('board --machine');
      expect(menu).to.not.be.null;

      const viewChoice = findChoice(menu!.prompt.choices, 'View board');
      expect(viewChoice).to.not.be.undefined;

      const result = execFinal(execChoice(viewChoice!));

      expect(result).to.include('Total:');
      expect(result).to.include('0 tickets');
    });
  });

  describe('full agentic flow: menu → Show markdown', () => {
    it('should navigate: board menu → "Show as markdown" → display markdown with tickets', () => {
      createTestTicket(dbPath, 'TKT-201', 'Markdown test ticket', 'default-backlog', 'P1');

      // Step 1: Agent gets the board menu
      const menu = agentExec('board --machine');
      expect(menu).to.not.be.null;

      // Step 2: Agent finds the "Show as markdown" choice
      const mdChoice = findChoice(menu!.prompt.choices, 'markdown');
      expect(mdChoice).to.not.be.undefined;
      expect(mdChoice!.command).to.be.a('string');

      // Step 3: Agent executes the command
      const result = execFinal(execChoice(mdChoice!));

      // Step 4: Verify end result - markdown output contains ticket
      expect(result).to.include('TKT-201');
      expect(result).to.include('Markdown test ticket');
    });
  });

  describe('full agentic flow: menu → Export board', () => {
    it('should navigate: board menu → "Export" → create kanban.md file with tickets', () => {
      createTestTicket(dbPath, 'TKT-301', 'Export flow ticket', 'default-backlog', 'P1');

      // Step 1: Agent gets the board menu
      const menu = agentExec('board --machine');
      expect(menu).to.not.be.null;

      // Step 2: Agent finds the "Export" choice
      const exportChoice = findChoice(menu!.prompt.choices, 'Export');
      expect(exportChoice).to.not.be.undefined;
      expect(exportChoice!.command).to.be.a('string');

      // Step 3: Agent executes the export command
      const result = execFinal(execChoice(exportChoice!));

      // Step 4: Verify end result - command output confirms export
      expect(result).to.include('Exported board');

      // Step 5: Verify end result - file was actually created on disk
      const kanbanPath = path.join(testDir, 'pmo', 'projects', 'default', 'kanban.md');
      expect(fs.existsSync(kanbanPath)).to.be.true;

      const content = fs.readFileSync(kanbanPath, 'utf-8');
      expect(content).to.include('TKT-301');
      expect(content).to.include('Export flow ticket');
    });
  });

  describe('full agentic flow: menu → Sync board', () => {
    it('should navigate: board menu → "Sync" → apply changes from board.md', () => {
      createTestTicket(dbPath, 'TKT-401', 'Sync flow ticket', 'default-backlog', 'P1');

      // Pre-condition: export first so there's a board.md to sync from
      exec('board --action export');

      // Step 1: Agent gets the board menu
      const menu = agentExec('board --machine');
      expect(menu).to.not.be.null;

      // Step 2: Agent finds the "Sync" choice
      const syncChoice = findChoice(menu!.prompt.choices, 'Sync');
      expect(syncChoice).to.not.be.undefined;
      expect(syncChoice!.command).to.be.a('string');
      // Sync command should include --force to skip confirmation
      expect(syncChoice!.command).to.include('--force');

      // Step 3: Agent executes the sync command (already has --force in the command)
      const result = execFinal(execChoice(syncChoice!));

      // Step 4: Verify end result - sync completed
      expect(result).to.satisfy((s: string) =>
        s.includes('synced') || s.includes('already in sync')
      );
    });

    it('should navigate: board menu → "Sync" → detect and apply modified titles', () => {
      createTestTicket(dbPath, 'TKT-402', 'Before modification', 'default-backlog', 'P1');

      // Export to create the board.md
      exec('board --action export');

      // Modify the board.md file
      const kanbanPath = path.join(testDir, 'pmo', 'projects', 'default', 'kanban.md');
      let content = fs.readFileSync(kanbanPath, 'utf-8');
      content = content.replace('Before modification', 'After modification');
      fs.writeFileSync(kanbanPath, content);

      // Step 1: Agent gets the board menu
      const menu = agentExec('board --machine');
      expect(menu).to.not.be.null;

      // Step 2: Agent picks "Sync"
      const syncChoice = findChoice(menu!.prompt.choices, 'Sync');
      expect(syncChoice).to.not.be.undefined;

      // Step 3: Agent executes sync (--force is in the command)
      const result = execFinal(execChoice(syncChoice!));

      // Step 4: Verify end result - changes were applied
      expect(result).to.include('synced');
    });
  });

  describe('full agentic flow: menu → Watch', () => {
    it('should navigate: board menu → "Watch" → command includes board watch', () => {
      // Step 1: Agent gets the board menu
      const menu = agentExec('board --machine');
      expect(menu).to.not.be.null;

      // Step 2: Agent finds the "Watch" choice
      const watchChoice = findChoice(menu!.prompt.choices, 'Watch');
      expect(watchChoice).to.not.be.undefined;
      expect(watchChoice!.command).to.be.a('string');
      expect(watchChoice!.command).to.include('board watch');

      // NOTE: We don't execFinal here because watch blocks (runs a foreground watcher).
      // The agent would run this as a long-lived process.
    });
  });

  // =========================================================================
  // Direct --action flag tests (non-agentic, for completeness)
  // =========================================================================
  describe('board --action view (direct)', () => {
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
  });

  describe('board --action markdown (direct)', () => {
    it('should output board as markdown', () => {
      createTestTicket(dbPath, 'TKT-001', 'Login feature', 'default-backlog', 'P1');

      const output = exec('board --action markdown');

      expect(output).to.include('TKT-001');
      expect(output).to.include('Login feature');
    });

    it('should output markdown for empty board', () => {
      const output = exec('board --action markdown');
      expect(output).to.be.a('string');
    });
  });

  describe('board --action export (direct)', () => {
    it('should export board to kanban.md and overwrite on re-export', () => {
      createTestTicket(dbPath, 'TKT-001', 'First export', 'default-backlog', 'P1');
      exec('board --action export');

      createTestTicket(dbPath, 'TKT-002', 'Second export', 'default-backlog', 'P2');
      exec('board --action export');

      const kanbanPath = path.join(testDir, 'pmo', 'projects', 'default', 'kanban.md');
      const content = fs.readFileSync(kanbanPath, 'utf-8');
      expect(content).to.include('TKT-001');
      expect(content).to.include('TKT-002');
    });
  });

  describe('board --action sync --force (direct)', () => {
    it('should sync from exported board.md successfully', () => {
      createTestTicket(dbPath, 'TKT-001', 'Sync test', 'default-backlog', 'P1');
      exec('board --action export');

      const output = exec('board --action sync --force');

      expect(output).to.satisfy((s: string) =>
        s.includes('synced') || s.includes('already in sync')
      );
    });

    it('should detect and apply changes from modified board.md', () => {
      createTestTicket(dbPath, 'TKT-001', 'Original title', 'default-backlog', 'P1');
      exec('board --action export');

      const kanbanPath = path.join(testDir, 'pmo', 'projects', 'default', 'kanban.md');
      let content = fs.readFileSync(kanbanPath, 'utf-8');
      content = content.replace('Original title', 'Modified title');
      fs.writeFileSync(kanbanPath, content);

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

    it('should include project in JSON prompt message', () => {
      const menu = agentExec('board --machine -P default');

      expect(menu).to.not.be.null;
      expect(menu!.prompt.message).to.include('Board Operations');
    });
  });
});

/**
 * Create a test ticket directly in the database.
 * Opens a new DB connection, inserts the ticket, and closes.
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
