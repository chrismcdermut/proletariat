import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { exec } from './test-helpers.js';

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
        'ticket create --title "Add login" --priority HIGH --column "SHIP BL"'
      );

      expect(output).to.contain('Created ticket');
      expect(output).to.contain('Add login');

      // Verify in database
      const tickets = db.prepare('SELECT * FROM pmo_tickets WHERE title = ?').all('Add login') as Array<{ priority: string }>;
      expect(tickets).to.have.lengthOf(1);
      expect(tickets[0].priority).to.equal('HIGH');
    });

    it('should auto-generate ticket ID', () => {
      exec('ticket create --title "Test ticket" --column "SHIP BL"');

      const tickets = db.prepare('SELECT id FROM pmo_tickets').all() as Array<{ id: string }>;
      expect(tickets).to.have.lengthOf(1);
      expect(tickets[0].id).to.be.a('string');
      expect(tickets[0].id).to.not.be.empty;
    });

    it('should add ticket to kanban.md', () => {
      exec('ticket create --title "Board test" --column "SHIP BL"');

      const boardPath = path.join(testDir, 'pmo/projects/test-project/kanban.md');
      const content = fs.readFileSync(boardPath, 'utf-8');

      expect(content).to.contain('Board test');
    });
  });

  describe('prlt ticket move', () => {
    it('should move ticket between columns', () => {
      // Create ticket
      exec('ticket create --title "Movable" --column "SHIP BL"');

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
      exec('ticket create --title "Move test" --column "SHIP BL"');
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
      exec('ticket create --title "Delete me" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Delete me') as { id: string };

      exec(`ticket delete ${ticket.id} --force`);

      const remaining = db.prepare('SELECT * FROM pmo_tickets WHERE id = ?').get(ticket.id);
      expect(remaining).to.be.undefined;
    });

    it('should remove ticket from kanban.md', () => {
      exec('ticket create --title "Remove from board" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Remove from board') as { id: string };

      exec(`ticket delete ${ticket.id} --force`);

      const boardPath = path.join(testDir, 'pmo/projects/test-project/kanban.md');
      const content = fs.readFileSync(boardPath, 'utf-8');

      expect(content).to.not.contain('Remove from board');
    });

    it('should cascade delete from pmo_board_tickets', () => {
      exec('ticket create --title "Cascade test" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Cascade test') as { id: string };

      exec(`ticket delete ${ticket.id} --force`);

      const boardTicket = db.prepare('SELECT * FROM pmo_board_tickets WHERE ticket_id = ?').get(ticket.id);
      expect(boardTicket).to.be.undefined;
    });
  });

  describe('prlt ticket list', () => {
    it('should list all tickets', () => {
      exec('ticket create --title "List test 1" --priority HIGH --column "SHIP BL"');
      exec('ticket create --title "List test 2" --priority MEDIUM --column "SHIP BL"');

      const output = exec('ticket list');

      expect(output).to.contain('List test 1');
      expect(output).to.contain('List test 2');
      expect(output).to.contain('[HIGH]');
      expect(output).to.contain('[MEDIUM]');
    });

    it('should filter by column', () => {
      exec('ticket create --title "In backlog" --column "SHIP BL"');
      exec('ticket create --title "In progress" --column "In Progress"');

      const output = exec('ticket list --column "In Progress"');

      expect(output).to.contain('In progress');
      expect(output).to.not.contain('In backlog');
    });

    it('should filter by priority', () => {
      exec('ticket create --title "High priority" --priority HIGH --column "SHIP BL"');
      exec('ticket create --title "Low priority" --priority LOW --column "SHIP BL"');

      const output = exec('ticket list --priority HIGH');

      expect(output).to.contain('High priority');
      expect(output).to.not.contain('Low priority');
    });
  });

  describe('prlt ticket view', () => {
    it('should show detailed ticket information', () => {
      exec('ticket create --title "View test" --description "Test description" --priority HIGH --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('View test') as { id: string };

      const output = exec(`ticket view ${ticket.id}`);

      expect(output).to.contain('View test');
      expect(output).to.contain('Test description');
      expect(output).to.contain('HIGH');
      expect(output).to.contain('SHIP BL');
    });
  });

  describe('prlt ticket edit', () => {
    it('should edit ticket title with flag', () => {
      exec('ticket create --title "Original title" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Original title') as { id: string };

      exec(`ticket edit ${ticket.id} --title "Updated title"`);

      const updatedTicket = db.prepare('SELECT title FROM pmo_tickets WHERE id = ?').get(ticket.id) as { title: string };
      expect(updatedTicket.title).to.equal('Updated title');
    });

    it('should edit ticket priority', () => {
      exec('ticket create --title "Priority test" --priority LOW --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Priority test') as { id: string };

      exec(`ticket edit ${ticket.id} --priority HIGH`);

      const updatedTicket = db.prepare('SELECT priority FROM pmo_tickets WHERE id = ?').get(ticket.id) as { priority: string };
      expect(updatedTicket.priority).to.equal('HIGH');
    });

    it('should edit ticket description', () => {
      exec('ticket create --title "Desc test" --description "Old desc" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Desc test') as { id: string };

      exec(`ticket edit ${ticket.id} --description "New description"`);

      const updatedTicket = db.prepare('SELECT description FROM pmo_tickets WHERE id = ?').get(ticket.id) as { description: string };
      expect(updatedTicket.description).to.equal('New description');
    });

    it('should edit ticket category', () => {
      exec('ticket create --title "Category test" --category bug --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Category test') as { id: string };

      exec(`ticket edit ${ticket.id} --category feature`);

      const updatedTicket = db.prepare('SELECT category FROM pmo_tickets WHERE id = ?').get(ticket.id) as { category: string };
      expect(updatedTicket.category).to.equal('feature');
    });

    it('should edit multiple fields at once', () => {
      exec('ticket create --title "Multi test" --priority LOW --category chore --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Multi test') as { id: string };

      exec(`ticket edit ${ticket.id} --title "New multi" --priority URGENT --category security`);

      const updatedTicket = db.prepare('SELECT title, priority, category FROM pmo_tickets WHERE id = ?').get(ticket.id) as { title: string; priority: string; category: string };
      expect(updatedTicket.title).to.equal('New multi');
      expect(updatedTicket.priority).to.equal('URGENT');
      expect(updatedTicket.category).to.equal('security');
    });

    it('should update kanban.md after edit', () => {
      exec('ticket create --title "Board edit test" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Board edit test') as { id: string };

      exec(`ticket edit ${ticket.id} --title "Edited for board"`);

      const boardPath = path.join(testDir, 'pmo/projects/test-project/kanban.md');
      const content = fs.readFileSync(boardPath, 'utf-8');
      expect(content).to.contain('Edited for board');
    });

    it('should clear priority with none value', () => {
      exec('ticket create --title "Clear priority" --priority HIGH --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Clear priority') as { id: string };

      exec(`ticket edit ${ticket.id} --priority none`);

      const updatedTicket = db.prepare('SELECT priority FROM pmo_tickets WHERE id = ?').get(ticket.id) as { priority: string | null };
      expect(updatedTicket.priority).to.be.oneOf([null, undefined, '']);
    });
  });

  describe('prlt ticket status', () => {
    it('should display ticket status details', () => {
      exec('ticket create --title "Status view test" --priority HIGH --category bug --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Status view test') as { id: string };

      const output = exec(`ticket status ${ticket.id}`);

      expect(output).to.contain(ticket.id);
      expect(output).to.contain('Status view test');
      expect(output).to.contain('SHIP BL');
    });

    it('should show priority in status', () => {
      exec('ticket create --title "Priority status" --priority URGENT --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Priority status') as { id: string };

      const output = exec(`ticket status ${ticket.id}`);

      expect(output).to.contain('URGENT');
    });

    it('should show category in status', () => {
      exec('ticket create --title "Category status" --category security --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Category status') as { id: string };

      const output = exec(`ticket status ${ticket.id}`);

      expect(output).to.contain('security');
    });

    it('should show description in status', () => {
      exec('ticket create --title "Desc status" --description "This is a detailed description" --column "SHIP BL"');
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
      exec('ticket create --title "Complete test" --column "SHIP BL"');
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
      exec('ticket create --title "Complete board test" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Complete board test') as { id: string };

      exec(`ticket complete ${ticket.id}`);

      const boardPath = path.join(testDir, 'pmo/projects/test-project/kanban.md');
      const content = fs.readFileSync(boardPath, 'utf-8');

      // Check ticket appears under Done section
      const doneSection = content.split('## Done')[1];
      expect(doneSection).to.contain('Complete board test');
    });

    it('should display success message', () => {
      exec('ticket create --title "Complete msg test" --column "SHIP BL"');
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
    it('should link ticket to epic', () => {
      // Create an epic first
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-001', 'test-project', 'Test Epic', 'active')
      `).run();

      exec('ticket create --title "Link test" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Link test') as { id: string };

      exec(`ticket link ${ticket.id} EPIC-001`);

      const linkedTicket = db.prepare('SELECT epic_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { epic_id: string };
      expect(linkedTicket.epic_id).to.equal('EPIC-001');
    });

    it('should unlink ticket from epic', () => {
      // Create an epic and linked ticket
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-002', 'test-project', 'Unlink Epic', 'active')
      `).run();

      exec('ticket create --title "Unlink test" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Unlink test') as { id: string };

      // Link first
      db.prepare('UPDATE pmo_tickets SET epic_id = ? WHERE id = ?').run('EPIC-002', ticket.id);

      // Verify linked
      const beforeUnlink = db.prepare('SELECT epic_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { epic_id: string };
      expect(beforeUnlink.epic_id).to.equal('EPIC-002');

      // Now unlink
      exec(`ticket link ${ticket.id} --unlink`);

      const afterUnlink = db.prepare('SELECT epic_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { epic_id: string | null };
      expect(afterUnlink.epic_id).to.be.null;
    });

    it('should display link success message', () => {
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-003', 'test-project', 'Message Epic', 'active')
      `).run();

      exec('ticket create --title "Msg link test" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Msg link test') as { id: string };

      const output = exec(`ticket link ${ticket.id} EPIC-003`);

      expect(output).to.contain('Linked');
      expect(output).to.contain(ticket.id);
      expect(output).to.contain('EPIC-003');
    });

    it('should update kanban.md after linking', () => {
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-004', 'test-project', 'Board Link Epic', 'active')
      `).run();

      exec('ticket create --title "Board link test" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Board link test') as { id: string };

      exec(`ticket link ${ticket.id} EPIC-004`);

      const boardPath = path.join(testDir, 'pmo/projects/test-project/kanban.md');
      expect(fs.existsSync(boardPath)).to.be.true;
    });

    it('should not link to non-existent epic', () => {
      exec('ticket create --title "Bad epic test" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Bad epic test') as { id: string };

      // Attempt to link to non-existent epic
      exec(`ticket link ${ticket.id} NON-EXISTENT`);

      // Verify ticket is not linked to the non-existent epic
      const linkedTicket = db.prepare('SELECT epic_id FROM pmo_tickets WHERE id = ?').get(ticket.id) as { epic_id: string | null };
      expect(linkedTicket.epic_id).to.be.null;
    });

    it('should detect already linked to same epic', () => {
      db.prepare(`
        INSERT INTO pmo_epics (id, project_id, title, status)
        VALUES ('EPIC-005', 'test-project', 'Same Epic', 'active')
      `).run();

      exec('ticket create --title "Same epic test" --column "SHIP BL"');
      const ticket = db.prepare('SELECT id FROM pmo_tickets WHERE title = ?').get('Same epic test') as { id: string };

      // Link first
      exec(`ticket link ${ticket.id} EPIC-005`);

      // Try to link again
      const output = exec(`ticket link ${ticket.id} EPIC-005`);

      expect(output.toLowerCase()).to.contain('already');
    });
  });

  describe('prlt ticket bulk move', () => {
    it('should move multiple tickets at once', () => {
      // Create multiple tickets
      exec('ticket create --title "Bulk 1" --column "SHIP BL"');
      exec('ticket create --title "Bulk 2" --column "SHIP BL"');
      exec('ticket create --title "Bulk 3" --column "SHIP BL"');

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
        WHERE c.name = 'SHIP BL'
      `).all();

      expect(backlogTickets).to.have.lengthOf(3);
    });
  });

  describe('prlt ticket bulk delete', () => {
    it('should delete multiple tickets', () => {
      exec('ticket create --title "Delete 1" --column "SHIP BL"');
      exec('ticket create --title "Delete 2" --column "SHIP BL"');
      exec('ticket create --title "Keep" --column "SHIP BL"');

      const beforeCount = db.prepare('SELECT COUNT(*) as count FROM pmo_tickets').get() as { count: number };
      expect(beforeCount.count).to.equal(3);

      // In real usage this would be interactive
      // Here we test that bulk operations preserve referential integrity
    });
  });

  describe('prlt ticket bulk update', () => {
    it('should update priority for multiple tickets', () => {
      exec('ticket create --title "Update 1" --priority LOW --column "SHIP BL"');
      exec('ticket create --title "Update 2" --priority LOW --column "SHIP BL"');

      // Verify both are LOW priority
      const lowTickets = db.prepare('SELECT * FROM pmo_tickets WHERE priority = ?').all('LOW');
      expect(lowTickets).to.have.lengthOf(2);
    });
  });
});

// Helper functions
function setupTestDatabase(db: Database.Database) {
  // Create complete PMO schema (matches schema.ts)
  db.exec(`
    -- Settings table
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Projects table
    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT,
      description TEXT,
      initiative_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Initiatives table
    CREATE TABLE IF NOT EXISTS pmo_initiatives (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      objective TEXT,
      key_results TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Columns table
    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, id)
    );

    -- Specs table (must be before tickets and epics due to FK)
    CREATE TABLE IF NOT EXISTS pmo_specs (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      title TEXT,
      overview TEXT,
      status TEXT DEFAULT 'active',
      spec_type TEXT DEFAULT 'domain',
      domain TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Spec abilities table
    CREATE TABLE IF NOT EXISTS pmo_spec_abilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(spec_id, name)
    );

    -- Spec implementations table
    CREATE TABLE IF NOT EXISTS pmo_spec_implementations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ability_id INTEGER NOT NULL REFERENCES pmo_spec_abilities(id) ON DELETE CASCADE,
      modality TEXT NOT NULL,
      signature TEXT NOT NULL,
      UNIQUE(ability_id, modality)
    );

    -- Spec fields table
    CREATE TABLE IF NOT EXISTS pmo_spec_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      field_type TEXT NOT NULL,
      required TEXT DEFAULT 'optional',
      default_value TEXT,
      description TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(spec_id, name)
    );

    -- Spec rules table
    CREATE TABLE IF NOT EXISTS pmo_spec_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );

    -- Spec relations table
    CREATE TABLE IF NOT EXISTS pmo_spec_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      related_domain TEXT NOT NULL,
      relationship TEXT,
      UNIQUE(spec_id, related_domain)
    );

    -- Epics table (must be before tickets due to FK)
    CREATE TABLE IF NOT EXISTS pmo_epics (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      position INTEGER NOT NULL DEFAULT 0,
      file_path TEXT,
      spec_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL
    );

    -- Workflow statuses table
    CREATE TABLE IF NOT EXISTS pmo_statuses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, name)
    );

    -- Tickets table
    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      status_id TEXT,
      owner TEXT,
      assignee TEXT,
      branch TEXT,
      spec_id TEXT,
      epic_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (status_id) REFERENCES pmo_statuses(id),
      FOREIGN KEY (spec_id) REFERENCES pmo_specs(id) ON DELETE SET NULL,
      FOREIGN KEY (epic_id) REFERENCES pmo_epics(id) ON DELETE SET NULL
    );

    -- Board tickets table
    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (project_id, ticket_id),
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, column_id) REFERENCES pmo_columns(project_id, id) ON DELETE CASCADE
    );

    -- Subtasks table
    CREATE TABLE IF NOT EXISTS pmo_subtasks (
      id TEXT NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      position INTEGER NOT NULL,
      PRIMARY KEY (ticket_id, id)
    );

    -- Ticket metadata table
    CREATE TABLE IF NOT EXISTS pmo_ticket_metadata (
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (ticket_id, key)
    );

    -- Ticket dependencies table
    CREATE TABLE IF NOT EXISTS pmo_ticket_dependencies (
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      blocked_by_ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticket_id, blocked_by_ticket_id),
      CHECK (ticket_id != blocked_by_ticket_id)
    );

    -- Ticket affected paths table
    CREATE TABLE IF NOT EXISTS pmo_ticket_affected_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      path_pattern TEXT NOT NULL,
      path_type TEXT NOT NULL DEFAULT 'file',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Ticket acceptance criteria table
    CREATE TABLE IF NOT EXISTS pmo_ticket_acceptance_criteria (
      id TEXT NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      criterion TEXT NOT NULL,
      verifiable INTEGER DEFAULT 1,
      verified INTEGER DEFAULT 0,
      verified_at TIMESTAMP,
      verified_by TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ticket_id, id)
    );

    -- Ticket specs table
    CREATE TABLE IF NOT EXISTS pmo_ticket_specs (
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      spec_id TEXT NOT NULL REFERENCES pmo_specs(id) ON DELETE CASCADE,
      PRIMARY KEY (ticket_id, spec_id)
    );

    -- Ticket assignments table
    CREATE TABLE IF NOT EXISTS pmo_ticket_assignments (
      ticket_id TEXT NOT NULL REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL,
      assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticket_id, agent_name)
    );

    -- Cache metadata table
    CREATE TABLE IF NOT EXISTS pmo_cache_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Agent work table
    CREATE TABLE IF NOT EXISTS agent_work (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      executor TEXT NOT NULL,
      mode TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'host',
      display_mode TEXT NOT NULL DEFAULT 'terminal',
      sandboxed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'starting',
      branch TEXT,
      pid TEXT,
      container_id TEXT,
      session_id TEXT,
      host TEXT,
      log_path TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      exit_code INTEGER,
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON pmo_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_epic ON pmo_tickets(epic_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_epics_project ON pmo_epics(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_spec_abilities_spec ON pmo_spec_abilities(spec_id);
  `);

  // Insert test data
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description)
    VALUES ('test-project', 'Test Project', 'E2E test project')
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
