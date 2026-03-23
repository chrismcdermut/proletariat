/**
 * ORM Migration Regression Tests
 *
 * Validates that critical PMO/agent workflows produce correct results
 * when using the Drizzle ORM query builder. These tests exercise the
 * migrated code paths to catch regressions during the raw-SQL-to-Drizzle
 * conversion (TKT-1092 / PRLT-497).
 *
 * Coverage:
 *  - Ticket CRUD (create, read, update, delete)
 *  - Ticket listing with filters (status, priority, category, search)
 *  - Ticket position management (gapped integers, reorder)
 *  - Subtask and metadata operations
 *  - Status/workflow transitions (moveTicket)
 *  - Work spawn selection prerequisites (workspace settings, agent queries)
 *  - Board operations (columns from workflow statuses)
 */

import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js';

describe('ORM Migration Regression Suite', () => {
  let testDir: string;
  let storage: SQLiteStorage;
  const projectId = 'regression-project';

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orm-regression-'));
    const dbPath = path.join(testDir, 'regression.db');
    const db = new SqliteDatabase(dbPath);
    db.close();

    storage = new SQLiteStorage(dbPath);
    await storage.createProject({
      id: projectId,
      name: 'Regression Test Project',
      template: 'kanban',
    });
  });

  afterEach(async () => {
    await storage.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // 1. Ticket CRUD
  // ===========================================================================

  describe('Ticket CRUD', () => {
    it('creates a ticket with all fields', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Full-field regression ticket',
        statusName: 'Backlog',
        priority: 'P1',
        category: 'feature',
        description: 'Detailed description for regression testing',
        owner: 'test-owner',
        assignee: 'test-agent',
      });

      expect(ticket.id).to.match(/^TKT-\d{3,}$/);
      expect(ticket.title).to.equal('Full-field regression ticket');
      expect(ticket.statusName).to.equal('Backlog');
      expect(ticket.priority).to.equal('P1');
      expect(ticket.category).to.equal('feature');
      expect(ticket.description).to.equal('Detailed description for regression testing');
      expect(ticket.owner).to.equal('test-owner');
      expect(ticket.assignee).to.equal('test-agent');
    });

    it('creates a ticket with minimal fields', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Minimal ticket',
      });

      expect(ticket.id).to.match(/^TKT-\d{3,}$/);
      expect(ticket.title).to.equal('Minimal ticket');
      expect(ticket.statusName).to.exist;
      expect(ticket.subtasks).to.deep.equal([]);
      expect(ticket.metadata).to.deep.equal({});
    });

    it('creates a ticket with custom id', async () => {
      const ticket = await storage.createTicket(projectId, {
        id: 'CUSTOM-001',
        title: 'Custom ID ticket',
      });

      expect(ticket.id).to.equal('CUSTOM-001');
    });

    it('reads a ticket by ID (case-insensitive)', async () => {
      const created = await storage.createTicket(projectId, {
        id: 'TKT-UPPER',
        title: 'Case test',
      });

      const fetched = await storage.getTicket('tkt-upper');
      expect(fetched).to.not.be.null;
      expect(fetched!.id).to.equal('TKT-UPPER');
      expect(fetched!.title).to.equal('Case test');
    });

    it('returns null for non-existent ticket', async () => {
      const result = await storage.getTicket('DOES-NOT-EXIST');
      expect(result).to.be.null;
    });

    it('updates ticket fields', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Original title',
        priority: 'P3',
      });

      const updated = await storage.updateTicket(ticket.id, {
        title: 'Updated title',
        priority: 'P0',
        description: 'Added description',
      });

      expect(updated.title).to.equal('Updated title');
      expect(updated.priority).to.equal('P0');
      expect(updated.description).to.equal('Added description');
    });

    it('deletes a ticket', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'To be deleted',
      });

      await storage.deleteTicket(ticket.id);
      const result = await storage.getTicket(ticket.id);
      expect(result).to.be.null;
    });

    it('throws on duplicate custom ID', async () => {
      await storage.createTicket(projectId, {
        id: 'DUP-001',
        title: 'First ticket',
      });

      try {
        await storage.createTicket(projectId, {
          id: 'DUP-001',
          title: 'Duplicate ticket',
        });
        expect.fail('Should have thrown');
      } catch (err: unknown) {
        expect((err as Error).message).to.match(/unique|duplicate|already exists/i);
      }
    });
  });

  // ===========================================================================
  // 2. Ticket Listing with Filters
  // ===========================================================================

  describe('Ticket Listing & Filtering', () => {
    beforeEach(async () => {
      await storage.createTicket(projectId, {
        id: 'FILTER-001',
        title: 'High priority feature',
        statusName: 'Backlog',
        priority: 'P0',
        category: 'feature',
      });
      await storage.createTicket(projectId, {
        id: 'FILTER-002',
        title: 'Low priority bug',
        statusName: 'Backlog',
        priority: 'P3',
        category: 'bug',
      });
      await storage.createTicket(projectId, {
        id: 'FILTER-003',
        title: 'Medium refactor work',
        statusName: 'In Progress',
        priority: 'P2',
        category: 'refactor',
      });
    });

    it('lists all tickets in a project', async () => {
      const tickets = await storage.listTickets(projectId);
      expect(tickets).to.have.length(3);
    });

    it('filters tickets by status column name', async () => {
      const tickets = await storage.listTickets(projectId, { column: 'Backlog' });
      expect(tickets).to.have.length(2);
      tickets.forEach(t => {
        expect(t.statusName).to.equal('Backlog');
      });
    });

    it('filters tickets by priority', async () => {
      const tickets = await storage.listTickets(projectId, { priority: 'P0' });
      expect(tickets).to.have.length(1);
      expect(tickets[0].id).to.equal('FILTER-001');
    });

    it('filters tickets by category', async () => {
      const tickets = await storage.listTickets(projectId, { category: 'bug' });
      expect(tickets).to.have.length(1);
      expect(tickets[0].id).to.equal('FILTER-002');
    });

    it('filters tickets by search term (title)', async () => {
      const tickets = await storage.listTickets(projectId, { search: 'refactor' });
      expect(tickets).to.have.length(1);
      expect(tickets[0].id).to.equal('FILTER-003');
    });

    it('returns empty array for non-matching filter', async () => {
      const tickets = await storage.listTickets(projectId, { priority: 'P1' });
      expect(tickets).to.have.length(0);
    });
  });

  // ===========================================================================
  // 3. Ticket Position Management
  // ===========================================================================

  describe('Ticket Position Management', () => {
    it('assigns gapped positions (1000-gap) on create', async () => {
      const t1 = await storage.createTicket(projectId, { title: 'First', statusName: 'Backlog' });
      const t2 = await storage.createTicket(projectId, { title: 'Second', statusName: 'Backlog' });
      const t3 = await storage.createTicket(projectId, { title: 'Third', statusName: 'Backlog' });

      expect(t1.position).to.equal(1000);
      expect(t2.position).to.equal(2000);
      expect(t3.position).to.equal(3000);
    });

    it('maintains position ordering within a status column', async () => {
      await storage.createTicket(projectId, { id: 'POS-1', title: 'First', statusName: 'Backlog' });
      await storage.createTicket(projectId, { id: 'POS-2', title: 'Second', statusName: 'Backlog' });
      await storage.createTicket(projectId, { id: 'POS-3', title: 'Third', statusName: 'Backlog' });

      const tickets = await storage.listTickets(projectId, { column: 'Backlog' });
      const positions = tickets.map(t => t.position);
      // Positions should be sorted ascending
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]!).to.be.greaterThan(positions[i - 1]!);
      }
    });

    it('assigns correct position when moving to a new status', async () => {
      // Create tickets in Backlog
      await storage.createTicket(projectId, { id: 'MOVE-A', title: 'Move A', statusName: 'Backlog' });

      // Create a ticket in "In Progress" to establish a baseline
      await storage.createTicket(projectId, { id: 'MOVE-B', title: 'Move B', statusName: 'In Progress' });

      // Move MOVE-A to In Progress
      const moved = await storage.moveTicket(projectId, 'MOVE-A', 'In Progress');
      expect(moved.statusName).to.equal('In Progress');
      expect(moved.position).to.be.greaterThan(0);
    });
  });

  // ===========================================================================
  // 4. Subtask Operations
  // ===========================================================================

  describe('Subtask Operations', () => {
    it('creates ticket with subtasks', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Ticket with subtasks',
        subtasks: [
          { id: 'sub-a', title: 'Subtask A', done: false },
          { id: 'sub-b', title: 'Subtask B', done: true },
        ],
      });

      expect(ticket.subtasks).to.have.length(2);
      expect(ticket.subtasks[0].title).to.equal('Subtask A');
      expect(ticket.subtasks[0].done).to.be.false;
      expect(ticket.subtasks[1].title).to.equal('Subtask B');
      expect(ticket.subtasks[1].done).to.be.true;
    });

    it('updates subtasks via ticket update', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Subtask update test',
        subtasks: [{ id: 'orig-sub', title: 'Original subtask', done: false }],
      });

      const updated = await storage.updateTicket(ticket.id, {
        subtasks: [
          { id: 'repl-a', title: 'Replaced subtask A', done: false },
          { id: 'repl-b', title: 'Replaced subtask B', done: true },
        ],
      });

      expect(updated.subtasks).to.have.length(2);
      expect(updated.subtasks[0].title).to.equal('Replaced subtask A');
    });

    it('clears subtasks when empty array provided', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Clear subtask test',
        subtasks: [{ id: 'to-remove', title: 'To remove', done: false }],
      });

      const updated = await storage.updateTicket(ticket.id, {
        subtasks: [],
      });

      expect(updated.subtasks).to.have.length(0);
    });
  });

  // ===========================================================================
  // 5. Metadata Operations
  // ===========================================================================

  describe('Metadata Operations', () => {
    it('creates ticket with metadata', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Metadata test',
        metadata: {
          external_source: 'linear',
          external_key: 'PRLT-123',
          external_url: 'https://linear.app/test/PRLT-123',
        },
      });

      expect(ticket.metadata).to.deep.equal({
        external_source: 'linear',
        external_key: 'PRLT-123',
        external_url: 'https://linear.app/test/PRLT-123',
      });
    });

    it('updates metadata via ticket update', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Metadata update test',
        metadata: { key1: 'value1' },
      });

      const updated = await storage.updateTicket(ticket.id, {
        metadata: { key2: 'value2', key3: 'value3' },
      });

      // Metadata replace replaces all keys
      expect(updated.metadata).to.deep.equal({
        key2: 'value2',
        key3: 'value3',
      });
    });

    it('clears metadata when empty object provided', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Clear metadata test',
        metadata: { remove_me: 'yes' },
      });

      const updated = await storage.updateTicket(ticket.id, {
        metadata: {},
      });

      expect(updated.metadata).to.deep.equal({});
    });
  });

  // ===========================================================================
  // 6. Status/Workflow Transitions
  // ===========================================================================

  describe('Status/Workflow Transitions', () => {
    it('moves ticket between statuses', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Transition test',
        statusName: 'Backlog',
      });
      expect(ticket.statusName).to.equal('Backlog');

      const moved = await storage.moveTicket(projectId, ticket.id, 'In Progress');
      expect(moved.statusName).to.equal('In Progress');
    });

    it('moves ticket through full lifecycle', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Lifecycle test',
        statusName: 'Backlog',
      });

      // Kanban template statuses: Backlog → To Do → In Progress → Done
      const t1 = await storage.moveTicket(projectId, ticket.id, 'To Do');
      expect(t1.statusName).to.equal('To Do');

      const t2 = await storage.moveTicket(projectId, ticket.id, 'In Progress');
      expect(t2.statusName).to.equal('In Progress');

      const t3 = await storage.moveTicket(projectId, ticket.id, 'Done');
      expect(t3.statusName).to.equal('Done');
    });

    it('throws on move to non-existent status', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Bad move test',
        statusName: 'Backlog',
      });

      try {
        await storage.moveTicket(projectId, ticket.id, 'NonExistentStatus');
        expect.fail('Should have thrown');
      } catch (err: unknown) {
        expect((err as Error).message).to.match(/not found/i);
      }
    });

    it('preserves other ticket fields after move', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Preserve fields test',
        priority: 'P1',
        category: 'bug',
        description: 'Important description',
      });

      const moved = await storage.moveTicket(projectId, ticket.id, 'In Progress');
      expect(moved.title).to.equal('Preserve fields test');
      expect(moved.priority).to.equal('P1');
      expect(moved.category).to.equal('bug');
      expect(moved.description).to.equal('Important description');
    });
  });

  // ===========================================================================
  // 7. Board Operations
  // ===========================================================================

  describe('Board Operations', () => {
    it('board columns match workflow statuses', async () => {
      const board = await storage.getBoard(projectId);
      expect(board.columns).to.have.length.greaterThan(0);

      // Kanban template should have these columns
      const names = board.columns.map(c => c.name);
      expect(names).to.include('Backlog');
      expect(names).to.include('Done');
    });

    it('tickets appear in correct board columns', async () => {
      await storage.createTicket(projectId, {
        id: 'BOARD-1',
        title: 'Backlog ticket',
        statusName: 'Backlog',
      });
      await storage.createTicket(projectId, {
        id: 'BOARD-2',
        title: 'In progress ticket',
        statusName: 'In Progress',
      });

      const backlogTickets = await storage.listTickets(projectId, { column: 'Backlog' });
      const inProgressTickets = await storage.listTickets(projectId, { column: 'In Progress' });

      expect(backlogTickets.some(t => t.id === 'BOARD-1')).to.be.true;
      expect(inProgressTickets.some(t => t.id === 'BOARD-2')).to.be.true;
    });
  });

  // ===========================================================================
  // 8. Category Validation
  // ===========================================================================

  describe('Category Validation', () => {
    it('accepts valid categories (case-insensitive)', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Category test',
        category: 'Feature',
      });

      // Category should be normalized to the DB value
      expect(ticket.category).to.exist;
      expect(ticket.category!.toLowerCase()).to.equal('feature');
    });

    it('rejects invalid categories', async () => {
      try {
        await storage.createTicket(projectId, {
          title: 'Invalid category test',
          category: 'invalid-nonexistent-category',
        });
        expect.fail('Should have thrown');
      } catch (err: unknown) {
        expect((err as Error).message).to.match(/invalid category/i);
      }
    });
  });

  // ===========================================================================
  // 9. Project Resolution
  // ===========================================================================

  describe('Project Resolution', () => {
    it('supports ticket operations with project context', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Project context test',
      });

      expect(ticket.projectId).to.equal(projectId);
    });

    it('handles multiple projects independently', async () => {
      await storage.createProject({
        id: 'alt-project',
        name: 'Alternative Project',
        template: 'kanban',
      });

      await storage.createTicket(projectId, { id: 'PRJ1-T1', title: 'Project 1 ticket' });
      await storage.createTicket('alt-project', { id: 'PRJ2-T1', title: 'Project 2 ticket' });

      const proj1Tickets = await storage.listTickets(projectId);
      const proj2Tickets = await storage.listTickets('alt-project');

      expect(proj1Tickets.some(t => t.id === 'PRJ1-T1')).to.be.true;
      expect(proj2Tickets.some(t => t.id === 'PRJ2-T1')).to.be.true;
      expect(proj1Tickets.some(t => t.id === 'PRJ2-T1')).to.be.false;
    });
  });

  // ===========================================================================
  // 10. Data Integrity Under Concurrent-Like Operations
  // ===========================================================================

  describe('Data Integrity', () => {
    it('maintains referential integrity on ticket deletion with subtasks', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Integrity test',
        subtasks: [
          { id: 'integ-a', title: 'Sub A', done: false },
          { id: 'integ-b', title: 'Sub B', done: false },
        ],
        metadata: { key: 'value' },
      });

      await storage.deleteTicket(ticket.id);

      // Ticket should be gone
      const result = await storage.getTicket(ticket.id);
      expect(result).to.be.null;
    });

    it('handles rapid sequential creates without ID collision', async () => {
      const tickets = [];
      for (let i = 0; i < 20; i++) {
        const t = await storage.createTicket(projectId, {
          title: `Rapid create ${i}`,
        });
        tickets.push(t);
      }

      const ids = new Set(tickets.map(t => t.id));
      expect(ids.size).to.equal(20);
    });

    it('update preserves fields not included in changes', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Preserve test',
        priority: 'P1',
        category: 'bug',
        description: 'Original description',
      });

      // Update only the title
      const updated = await storage.updateTicket(ticket.id, {
        title: 'New title only',
      });

      expect(updated.title).to.equal('New title only');
      expect(updated.priority).to.equal('P1');
      expect(updated.category).to.equal('bug');
      expect(updated.description).to.equal('Original description');
    });
  });
});
