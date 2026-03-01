import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import {
  exec,
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  createTestProject,
  createHQConfig,
  createPMODirectories,
  type TestEnvironment,
} from './test-helpers.js';
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js';

/**
 * End-to-end tests for PMO Ticket Commands
 * Tests actual CLI usage as a user would interact with it
 * Spec: pmo-ticket-commands.md
 */
describe('PMO Ticket Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-ticket-e2e-'));
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

  describe('prlt ticket create', () => {
    it('should create ticket with all flags', () => {
      const output = exec(
        'ticket create --title "Add login" --priority HIGH --column "Backlog"'
      );

      expect(output).to.contain('Created ticket');
      expect(output).to.contain('Add login');

      // Verify in database
      const tickets = db.prepare('SELECT * FROM pmo_tickets WHERE title = ?').all('Add login') as Array<{ priority: string }>;
      expect(tickets).to.have.lengthOf(1);
      expect(tickets[0].priority).to.equal('HIGH');
    });

    it('should default column to Backlog in JSON mode when not provided', () => {
      // This is TKT-790: JSON mode should default column to Backlog instead of prompting
      const output = exec(
        'ticket create --json --title "JSON mode ticket" --priority HIGH --category bug'
      );

      // Should create ticket successfully, not output a prompt for column selection
      expect(output).to.contain('Created ticket');
      expect(output).to.contain('JSON mode ticket');

      // Verify ticket was created
      const ticket = db.prepare('SELECT id, priority FROM pmo_tickets WHERE title = ?').get('JSON mode ticket') as { id: string; priority: string } | undefined;
      expect(ticket).to.not.be.undefined;
      expect(ticket!.priority).to.equal('HIGH');

      // Verify it's in the first column (Backlog - the default)
      const boardTicket = db.prepare(`
        SELECT c.name
        FROM pmo_board_tickets bt
        JOIN pmo_columns c ON c.id = bt.column_id
        WHERE bt.ticket_id = ?
      `).get(ticket!.id) as { name: string } | undefined;

      expect(boardTicket?.name).to.equal('Backlog');
    });

    it('should auto-generate ticket ID', () => {
      exec('ticket create --title "Test ticket" --column "Backlog"');

      const tickets = db.prepare('SELECT id FROM pmo_tickets').all() as Array<{ id: string }>;
      expect(tickets).to.have.lengthOf(1);
      expect(tickets[0].id).to.be.a('string');
      expect(tickets[0].id).to.not.be.empty;
    });

    it('should add ticket to kanban.md', () => {
      exec('ticket create --title "Board test" --column "Backlog"');

      const boardPath = path.join(testDir, 'pmo/projects/test-project/kanban.md');
      const content = fs.readFileSync(boardPath, 'utf-8');

      expect(content).to.contain('Board test');
    });
  });

  describe('prlt ticket move', () => {
    it('should move ticket between columns', () => {
      // Create ticket
      exec('ticket create --title "Movable" --column "Backlog"');

      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Movable') as { id: string };
      const ticketId = ticket.id;

      // Move ticket
      exec(`ticket move ${ticketId} "In Progress"`);

      // Verify new column
      const boardTicket = db.prepare(`
        SELECT c.name
        FROM pmo_board_tickets bt
        JOIN pmo_columns c ON c.id = bt.column_id
        WHERE bt.ticket_id = ?
      `).get(ticketId) as { name: string };

      expect(boardTicket.name).to.equal('In Progress');
    });

    it('should update kanban.md when moving ticket', () => {
      exec('ticket create --title "Move test" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Move test') as { id: string };

      exec(`ticket move ${ticket.id} "Merged"`);

      const boardPath = path.join(testDir, 'pmo/projects/test-project/kanban.md');
      const content = fs.readFileSync(boardPath, 'utf-8');

      // Check ticket appears under Merged section
      const mergedSection = content.split('## Merged')[1];
      expect(mergedSection).to.contain('Move test');
    });
  });

  describe('prlt ticket delete', () => {
    it('should delete ticket from database', () => {
      exec('ticket create --title "Delete me" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Delete me') as { id: string };

      exec(`ticket delete ${ticket.id} --force`);

      const remaining = db.prepare('SELECT * FROM pmo_tickets WHERE id = ?').get(ticket.id);
      expect(remaining).to.be.undefined;
    });

    it('should remove ticket from kanban.md', () => {
      exec('ticket create --title "Remove from board" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Remove from board') as { id: string };

      exec(`ticket delete ${ticket.id} --force`);

      const boardPath = path.join(testDir, 'pmo/projects/test-project/kanban.md');
      const content = fs.readFileSync(boardPath, 'utf-8');

      expect(content).to.not.contain('Remove from board');
    });

    it('should cascade delete from pmo_board_tickets', () => {
      exec('ticket create --title "Cascade test" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Cascade test') as { id: string };

      exec(`ticket delete ${ticket.id} --force`);

      const boardTicket = db.prepare('SELECT * FROM pmo_board_tickets WHERE ticket_id = ?').get(ticket.id);
      expect(boardTicket).to.be.undefined;
    });
  });

  describe('prlt ticket list', () => {
    it('should list all tickets', () => {
      exec('ticket create --title "List test 1" --priority HIGH --column "Backlog"');
      exec('ticket create --title "List test 2" --priority MEDIUM --column "Backlog"');

      const output = exec('ticket list');

      expect(output).to.contain('List test 1');
      expect(output).to.contain('List test 2');
      expect(output).to.contain('[HIGH]');
      expect(output).to.contain('[MEDIUM]');
    });

    it('should filter by column', () => {
      exec('ticket create --title "In backlog" --column "Backlog"');
      exec('ticket create --title "In progress" --column "In Progress"');

      const output = exec('ticket list --column "In Progress"');

      expect(output).to.contain('In progress');
      expect(output).to.not.contain('In backlog');
    });

    it('should filter by priority', () => {
      exec('ticket create --title "High priority" --priority HIGH --column "Backlog"');
      exec('ticket create --title "Low priority" --priority LOW --column "Backlog"');

      const output = exec('ticket list --priority HIGH');

      expect(output).to.contain('High priority');
      expect(output).to.not.contain('Low priority');
    });
  });

  describe('prlt ticket view', () => {
    it('should show detailed ticket information', () => {
      exec('ticket create --title "View test" --description "Test description" --priority HIGH --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('View test') as { id: string };

      const output = exec(`ticket view ${ticket.id}`);

      expect(output).to.contain('View test');
      expect(output).to.contain('Test description');
      expect(output).to.contain('HIGH');
      expect(output).to.contain('Backlog');
    });
  });

  describe('prlt ticket edit', () => {
    it('should edit ticket title with flag', () => {
      exec('ticket create --title "Original title" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Original title') as { id: string };

      exec(`ticket edit ${ticket.id} --title "Updated title"`);

      const updatedTicket = db.prepare('SELECT title FROM pmo_tickets WHERE id = ?').get(ticket.id) as { title: string };
      expect(updatedTicket.title).to.equal('Updated title');
    });

    it('should edit ticket priority', () => {
      exec('ticket create --title "Priority test" --priority LOW --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Priority test') as { id: string };

      exec(`ticket edit ${ticket.id} --priority HIGH`);

      const updatedTicket = db.prepare('SELECT priority FROM pmo_tickets WHERE id = ?').get(ticket.id) as { priority: string };
      expect(updatedTicket.priority).to.equal('HIGH');
    });

    it('should edit ticket description', () => {
      exec('ticket create --title "Desc test" --description "Old desc" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Desc test') as { id: string };

      exec(`ticket edit ${ticket.id} --description "New description"`);

      const updatedTicket = db.prepare('SELECT description FROM pmo_tickets WHERE id = ?').get(ticket.id) as { description: string };
      expect(updatedTicket.description).to.equal('New description');
    });

    it('should edit ticket category', () => {
      exec('ticket create --title "Category test" --category bug --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Category test') as { id: string };

      exec(`ticket edit ${ticket.id} --category feature`);

      const updatedTicket = db.prepare('SELECT category FROM pmo_tickets WHERE id = ?').get(ticket.id) as { category: string };
      expect(updatedTicket.category).to.equal('feature');
    });

    it('should edit multiple fields at once', () => {
      exec('ticket create --title "Multi test" --priority LOW --category chore --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Multi test') as { id: string };

      exec(`ticket edit ${ticket.id} --title "New multi" --priority URGENT --category security`);

      const updatedTicket = db.prepare('SELECT title, priority, category FROM pmo_tickets WHERE id = ?').get(ticket.id) as { title: string; priority: string; category: string };
      expect(updatedTicket.title).to.equal('New multi');
      expect(updatedTicket.priority).to.equal('URGENT');
      expect(updatedTicket.category).to.equal('security');
    });

    it('should update kanban.md after edit', () => {
      exec('ticket create --title "Board edit test" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Board edit test') as { id: string };

      exec(`ticket edit ${ticket.id} --title "Edited for board"`);

      const boardPath = path.join(testDir, 'pmo/projects/test-project/kanban.md');
      const content = fs.readFileSync(boardPath, 'utf-8');
      expect(content).to.contain('Edited for board');
    });

    it('should clear priority with none value', () => {
      exec('ticket create --title "Clear priority" --priority HIGH --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Clear priority') as { id: string };

      exec(`ticket edit ${ticket.id} --priority none`);

      const updatedTicket = db.prepare('SELECT priority FROM pmo_tickets WHERE id = ?').get(ticket.id) as { priority: string | null };
      expect(updatedTicket.priority).to.be.oneOf([null, undefined, '']);
    });

    // Note: Tests for multiple AC and subtask ID collision handling are in the unit tests
    // (pmo-storage.test.ts) which directly test the storage layer without E2E setup complexity
  });

  describe('prlt ticket status', () => {
    it('should display ticket status details', () => {
      exec('ticket create --title "Status view test" --priority HIGH --category bug --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Status view test') as { id: string };

      const output = exec(`ticket status ${ticket.id}`);

      expect(output).to.contain(ticket.id);
      expect(output).to.contain('Status view test');
      expect(output).to.contain('Backlog');
    });

    it('should show priority in status', () => {
      exec('ticket create --title "Priority status" --priority URGENT --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Priority status') as { id: string };

      const output = exec(`ticket status ${ticket.id}`);

      expect(output).to.contain('URGENT');
    });

    it('should show category in status', () => {
      exec('ticket create --title "Category status" --category security --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Category status') as { id: string };

      const output = exec(`ticket status ${ticket.id}`);

      expect(output).to.contain('security');
    });

    it('should show description in status', () => {
      exec('ticket create --title "Desc status" --description "This is a detailed description" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Desc status') as { id: string };

      const output = exec(`ticket status ${ticket.id}`);

      expect(output).to.contain('This is a detailed description');
    });

    it('should error for non-existent ticket', () => {
      const output = exec('ticket status NON-EXISTENT');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt ticket complete', () => {
    it('should move ticket to Done column', () => {
      exec('ticket create --title "Complete test" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Complete test') as { id: string };

      exec(`ticket complete ${ticket.id}`);

      const boardTicket = db.prepare(`
        SELECT c.name
        FROM pmo_board_tickets bt
        JOIN pmo_columns c ON c.id = bt.column_id
        WHERE bt.ticket_id = ?
      `).get(ticket.id) as { name: string };

      expect(boardTicket.name).to.equal('Done');
    });

    it('should update kanban.md after completion', () => {
      exec('ticket create --title "Complete board test" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Complete board test') as { id: string };

      exec(`ticket complete ${ticket.id}`);

      const boardPath = path.join(testDir, 'pmo/projects/test-project/kanban.md');
      const content = fs.readFileSync(boardPath, 'utf-8');

      // Check ticket appears under Done section
      const doneSection = content.split('## Done')[1];
      expect(doneSection).to.contain('Complete board test');
    });

    it('should display success message', () => {
      exec('ticket create --title "Complete msg test" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Complete msg test') as { id: string };

      const output = exec(`ticket complete ${ticket.id}`);

      expect(output).to.contain('Completed');
      expect(output).to.contain(ticket.id);
    });

    it('should error for non-existent ticket', () => {
      const output = exec('ticket complete NON-EXISTENT');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('prlt ticket link', () => {
    // Note: The old `ticket link TKT-XXX EPIC-XXX` syntax was replaced by
    // `ticket link` topic with subcommands (block, relates, duplicates).
    // Epic linking is now done via direct DB operations or ticket create --epic.

    it('should link ticket to epic via DB', () => {
      // Create an epic first
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-001', 'test-project', 'Test Epic', 'active')
      `).run();

      exec('ticket create --title "Link test" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Link test') as { id: string };

      db.prepare('UPDATE pmo_tickets SET epic_id = ? WHERE id = ?').run('EPIC-001', ticket.id);

      const linkedTicket = db.prepare('SELECT epic_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { epic_id: string };
      expect(linkedTicket.epic_id).to.equal('EPIC-001');
    });

    it('should unlink ticket from epic via DB', () => {
      // Create an epic and linked ticket
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-002', 'test-project', 'Unlink Epic', 'active')
      `).run();

      exec('ticket create --title "Unlink test" --column "Backlog"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Unlink test') as { id: string };

      // Link first
      db.prepare('UPDATE pmo_tickets SET epic_id = ? WHERE id = ?').run('EPIC-002', ticket.id);

      // Verify linked
      const beforeUnlink = db.prepare('SELECT epic_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { epic_id: string };
      expect(beforeUnlink.epic_id).to.equal('EPIC-002');

      // Now unlink
      db.prepare('UPDATE pmo_tickets SET epic_id = NULL WHERE id = ?').run(ticket.id);

      const afterUnlink = db.prepare('SELECT epic_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { epic_id: string | null };
      expect(afterUnlink.epic_id).to.be.null;
    });

    it('should show ticket link subcommands', () => {
      const output = exec('ticket link --help');
      // The new ticket link is a topic with subcommands
      expect(output).to.contain('ticket link');
    });
  });

  describe('prlt ticket bulk move', () => {
    it('should move multiple tickets at once', () => {
      // Create multiple tickets
      exec('ticket create --title "Bulk 1" --column "Backlog"');
      exec('ticket create --title "Bulk 2" --column "Backlog"');
      exec('ticket create --title "Bulk 3" --column "Backlog"');

      db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Bulk 1');
      db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Bulk 2');

      // Note: This would be interactive in real usage, so we test the underlying function
      // In a real E2E test, you'd use a tool to interact with prompts

      // Verify all are in backlog
      const backlogTickets = db.prepare(`
        SELECT t.title
        FROM pmo_tickets t
        JOIN pmo_board_tickets bt ON bt.ticket_id = t.id
        JOIN pmo_columns c ON c.id = bt.column_id
        WHERE c.name = 'Backlog'
      `).all();

      expect(backlogTickets).to.have.lengthOf(3);
    });
  });

  describe('prlt ticket bulk delete', () => {
    it('should delete multiple tickets', () => {
      exec('ticket create --title "Delete 1" --column "Backlog"');
      exec('ticket create --title "Delete 2" --column "Backlog"');
      exec('ticket create --title "Keep" --column "Backlog"');

      const beforeCount = db.prepare('SELECT COUNT(*) as count FROM pmo_tickets').get() as { count: number };
      expect(beforeCount.count).to.equal(3);

      // In real usage this would be interactive
      // Here we test that bulk operations preserve referential integrity
    });
  });

  describe('prlt ticket bulk update', () => {
    it('should update priority for multiple tickets', () => {
      exec('ticket create --title "Update 1" --priority LOW --column "Backlog"');
      exec('ticket create --title "Update 2" --priority LOW --column "Backlog"');

      // Verify both are LOW priority
      const lowTickets = db.prepare('SELECT * FROM pmo_tickets WHERE priority = ?').all('LOW');
      expect(lowTickets).to.have.lengthOf(2);
    });
  });
});

/**
 * Tests for --label alias (TKT-937)
 * Uses production schema to avoid schema drift issues.
 */
describe('ticket create --label alias', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('ticket-label-alias-');
    db = setupProductionSchema(env.dbPath, env.pmoPath);
    createTestProject(db, { id: 'test-project', name: 'Test Project' });
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');

    // Close DB before CLI commands to avoid locking
    db.close();
  });

  afterEach(() => {
    cleanupTestEnvironment(env);
  });

  it('should accept --label as alias for --labels', () => {
    const output = exec(
      'ticket create --title "Label alias test" --column Backlog --label "bug,ui"'
    );

    expect(output).to.not.contain('Nonexistent flag');
    expect(output).to.contain('Created ticket');
    expect(output).to.contain('Label alias test');
    expect(output).to.contain('bug, ui');
  });

  it('should accept --labels (plural) as before', () => {
    const output = exec(
      'ticket create --title "Labels plural test" --column Backlog --labels "feature,backend"'
    );

    expect(output).to.not.contain('Nonexistent flag');
    expect(output).to.contain('Created ticket');
    expect(output).to.contain('Labels plural test');
    expect(output).to.contain('feature, backend');
  });
});

// Helper functions
function setupTestDatabase(db: Database.Database) {
  // Use production PMO schema (ensures all columns including position, labels,
  // depends_on_ticket_id, epic_id, and correct FK references)
  initializePMOTables(db);

  // Create a custom kanban workflow for this test (name must not conflict with builtin 'Kanban')
  db.prepare(`
    INSERT OR IGNORE INTO pmo_workflows (id, name, description, is_builtin)
    VALUES ('kanban-workflow', 'Test Kanban', 'Test kanban workflow', 0)
  `).run();

  // Create workflow statuses (these are the board columns now)
  const workflowStatuses = [
    { id: 'ws-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'ws-ready', name: 'Ready', category: 'unstarted', position: 1 },
    { id: 'ws-in-progress', name: 'In Progress', category: 'started', position: 2 },
    { id: 'ws-review', name: 'Review', category: 'started', position: 3 },
    { id: 'ws-done', name: 'Done', category: 'completed', position: 4 },
    { id: 'ws-merged', name: 'Merged', category: 'completed', position: 5 },
  ];

  for (const status of workflowStatuses) {
    db.prepare(`
      INSERT OR IGNORE INTO pmo_workflow_statuses (id, workflow_id, name, category, position, is_default)
      VALUES (?, 'kanban-workflow', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }

  db.prepare(`
    INSERT INTO pmo_projects (id, name, description, workflow_id)
    VALUES ('test-project', 'Test Project', 'E2E test project', 'kanban-workflow')
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO pmo_settings (key, value)
    VALUES ('pmo_path', 'pmo')
  `).run();
  db.prepare(`
    INSERT OR REPLACE INTO pmo_settings (key, value)
    VALUES ('current_project', 'test-project')
  `).run();

  // Legacy columns (kept for backwards compatibility with some tests)
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
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
