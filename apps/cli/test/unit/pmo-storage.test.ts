import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js';

describe('PMO SQLite Storage', () => {
  let testDir: string;
  let storage: SQLiteStorage;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-test-'));
    const dbPath = path.join(testDir, 'pmo.db');

    // Create empty database file first (SQLiteStorage now requires it to exist)
    const db = new Database(dbPath);
    db.close();

    storage = new SQLiteStorage(dbPath);

    // Initialize board with columns
    await storage.init({
      name: 'Test Board',
      columns: ['Backlog', 'In Progress', 'Done'],
    });

    // Apply default workflow template (required for ticket creation)
    await storage.applyTemplate('default', 'kanban');
  });

  afterEach(async () => {
    await storage.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Board Operations', () => {
    it('initializes board with columns', async () => {
      const board = await storage.getBoard();

      expect(board.name).to.equal('Test Board');
      expect(board.columns).to.have.length(3);
      expect(board.columns[0].name).to.equal('Backlog');
      expect(board.columns[1].name).to.equal('In Progress');
      expect(board.columns[2].name).to.equal('Done');
    });

    it('generates board markdown', async () => {
      const markdown = await storage.getBoardMarkdown();

      expect(markdown).to.include('kanban-plugin');
      expect(markdown).to.include('## Backlog');
      expect(markdown).to.include('## In Progress');
      expect(markdown).to.include('## Done');
    });
  });

  describe('Column Operations', () => {
    it('creates a new column', async () => {
      await storage.createColumn('Review', 2);

      const board = await storage.getBoard();
      expect(board.columns).to.have.length(4);
      const reviewCol = board.columns.find(c => c.name === 'Review');
      expect(reviewCol).to.not.be.undefined;
    });

    it('renames a column', async () => {
      const board = await storage.getBoard();
      const backlogCol = board.columns.find(c => c.name === 'Backlog');

      await storage.renameColumn(backlogCol!.id, 'Todo');

      const updated = await storage.getBoard();
      expect(updated.columns[0].name).to.equal('Todo');
    });

    it('moves a column to a new position', async () => {
      const board = await storage.getBoard();
      const doneCol = board.columns.find(c => c.name === 'Done');

      await storage.moveColumn(doneCol!.id, 0);

      const updated = await storage.getBoard();
      expect(updated.columns[0].name).to.equal('Done');
    });

    it('deletes a column', async () => {
      const board = await storage.getBoard();
      const doneCol = board.columns.find(c => c.name === 'Done');

      await storage.deleteColumn(doneCol!.id);

      const updated = await storage.getBoard();
      expect(updated.columns).to.have.length(2);
    });
  });

  describe('Ticket Operations', () => {
    it('creates a ticket', async () => {
      const ticket = await storage.createTicket({
        title: 'Implement feature',
        column: 'Backlog',
        priority: 'URGENT',
      });

      expect(ticket.id).to.match(/^TKT-\d{3,}$/);
      expect(ticket.title).to.equal('Implement feature');
      expect(ticket.column).to.equal('Backlog');
      expect(ticket.priority).to.equal('URGENT');
    });

    it('creates ticket with custom id', async () => {
      const ticket = await storage.createTicket({
        id: 'my-custom-id',
        title: 'Custom ticket',
        column: 'Backlog',
      });

      expect(ticket.id).to.equal('my-custom-id');
    });

    it('retrieves a ticket', async () => {
      const created = await storage.createTicket({
        title: 'Implement feature',
        column: 'Backlog',
      });

      const ticket = await storage.getTicket(created.id);

      expect(ticket).to.not.be.null;
      expect(ticket!.title).to.equal('Implement feature');
    });

    it('returns null for non-existent ticket', async () => {
      const ticket = await storage.getTicket('non-existent');
      expect(ticket).to.be.null;
    });

    it('updates a ticket', async () => {
      const created = await storage.createTicket({
        title: 'Original title',
        column: 'Backlog',
      });

      const updated = await storage.updateTicket(created.id, {
        title: 'Updated title',
        priority: 'HIGH',
      });

      expect(updated.title).to.equal('Updated title');
      expect(updated.priority).to.equal('HIGH');
    });

    it('moves a ticket to a different column', async () => {
      const created = await storage.createTicket({
        title: 'My ticket',
        column: 'Backlog',
      });

      const moved = await storage.moveTicket(created.id, 'In Progress');

      expect(moved.column).to.equal('In Progress');
    });

    it('moves a ticket to a specific position', async () => {
      await storage.createTicket({ title: 'Ticket 1', column: 'Backlog' });
      await storage.createTicket({ title: 'Ticket 2', column: 'Backlog' });
      const ticket3 = await storage.createTicket({ title: 'Ticket 3', column: 'Backlog' });

      await storage.moveTicket(ticket3.id, 'Backlog', 0);

      const tickets = await storage.listTickets({ column: 'Backlog' });
      expect(tickets[0].id).to.equal(ticket3.id);
    });

    it('deletes a ticket', async () => {
      const created = await storage.createTicket({
        title: 'To delete',
        column: 'Backlog',
      });

      await storage.deleteTicket(created.id);

      const ticket = await storage.getTicket(created.id);
      expect(ticket).to.be.null;
    });

    it('lists all tickets', async () => {
      await storage.createTicket({ title: 'Ticket 1', column: 'Backlog' });
      await storage.createTicket({ title: 'Ticket 2', column: 'In Progress' });

      const tickets = await storage.listTickets();
      expect(tickets).to.have.length(2);
    });

    it('lists tickets filtered by column', async () => {
      await storage.createTicket({ title: 'Ticket 1', column: 'Backlog' });
      await storage.createTicket({ title: 'Ticket 2', column: 'In Progress' });

      const tickets = await storage.listTickets({ column: 'Backlog' });
      expect(tickets).to.have.length(1);
      expect(tickets[0].title).to.equal('Ticket 1');
    });

    it('lists tickets filtered by priority', async () => {
      await storage.createTicket({ title: 'Urgent bug', column: 'Backlog', priority: 'URGENT' });
      await storage.createTicket({ title: 'Feature', column: 'Backlog', priority: 'LOW' });

      const tickets = await storage.listTickets({ priority: 'URGENT' });
      expect(tickets).to.have.length(1);
      expect(tickets[0].title).to.equal('Urgent bug');
    });

    it('lists tickets filtered by category', async () => {
      await storage.createTicket({ title: 'Bug 1', column: 'Backlog', category: 'bug' });
      await storage.createTicket({ title: 'Feature 1', column: 'Backlog', category: 'feature' });

      const tickets = await storage.listTickets({ category: 'bug' });
      expect(tickets).to.have.length(1);
      expect(tickets[0].title).to.equal('Bug 1');
    });

    it('searches tickets by title/description', async () => {
      await storage.createTicket({ title: 'Fix login bug', column: 'Backlog', description: 'Users cannot log in' });
      await storage.createTicket({ title: 'Add feature', column: 'Backlog', description: 'New dashboard' });

      const results = await storage.listTickets({ search: 'login' });
      expect(results).to.have.length(1);
      expect(results[0].title).to.equal('Fix login bug');
    });
  });

  describe('Subtask Operations', () => {
    let mainTicketId: string;

    beforeEach(async () => {
      const ticket = await storage.createTicket({
        title: 'Main ticket',
        column: 'Backlog',
      });
      mainTicketId = ticket.id;
    });

    it('adds subtask to a ticket', async () => {
      const subtask = await storage.addSubtask(mainTicketId, 'Design API');

      expect(subtask.title).to.equal('Design API');
      expect(subtask.done).to.be.false;
    });

    it('toggles subtask completion', async () => {
      await storage.addSubtask(mainTicketId, 'Task 1');

      const ticket = await storage.getTicket(mainTicketId);
      const subtaskId = ticket!.subtasks[0].id;

      await storage.toggleSubtask(mainTicketId, subtaskId);

      const updated = await storage.getTicket(mainTicketId);
      expect(updated!.subtasks[0].done).to.be.true;
    });

    it('removes a subtask', async () => {
      await storage.addSubtask(mainTicketId, 'Task 1');

      const ticket = await storage.getTicket(mainTicketId);
      const subtaskId = ticket!.subtasks[0].id;

      await storage.removeSubtask(mainTicketId, subtaskId);

      const updated = await storage.getTicket(mainTicketId);
      expect(updated!.subtasks).to.have.length(0);
    });
  });

  describe('Spec Operations', () => {
    it('creates a spec', async () => {
      const spec = await storage.createSpec({
        id: 'auth-spec',
        title: 'Authentication Spec',
      });

      expect(spec.id).to.equal('auth-spec');
      expect(spec.title).to.equal('Authentication Spec');
    });

    it('retrieves a spec', async () => {
      await storage.createSpec({
        id: 'auth-spec',
        title: 'Authentication Spec',
      });

      const spec = await storage.getSpec('auth-spec');
      expect(spec).to.not.be.null;
      expect(spec!.title).to.equal('Authentication Spec');
    });

    it('lists specs', async () => {
      await storage.createSpec({ id: 'spec-1', title: 'Spec 1' });
      await storage.createSpec({ id: 'spec-2', title: 'Spec 2' });

      const specs = await storage.listSpecs();
      expect(specs).to.have.length(2);
    });

    it('links spec to ticket', async () => {
      const ticket = await storage.createTicket({ title: 'My ticket', column: 'Backlog' });
      await storage.createSpec({ id: 'spec-1', title: 'Spec 1' });

      await storage.linkTicketToSpec(ticket.id, 'spec-1');

      const specs = await storage.getSpecsForTicket(ticket.id);
      expect(specs).to.have.length(1);
      expect(specs[0].id).to.equal('spec-1');
    });

    it('gets tickets for a spec', async () => {
      const ticket1 = await storage.createTicket({ title: 'Ticket 1', column: 'Backlog' });
      const ticket2 = await storage.createTicket({ title: 'Ticket 2', column: 'Backlog' });
      await storage.createSpec({ id: 'spec-1', title: 'Spec 1' });

      await storage.linkTicketToSpec(ticket1.id, 'spec-1');
      await storage.linkTicketToSpec(ticket2.id, 'spec-1');

      const tickets = await storage.getTicketsForSpec('spec-1');
      expect(tickets).to.have.length(2);
    });
  });

  describe('Cache Metadata', () => {
    it('stores and retrieves cache metadata', async () => {
      await storage.setCacheMetadata({
        boardMtime: 1234567890,
        cacheBuiltAt: Date.now(),
      });

      const meta = await storage.getCacheMetadata();
      expect(meta).to.not.be.null;
      expect(meta!.boardMtime).to.equal(1234567890);
    });
  });

  describe('Rebuild from Board', () => {
    it('rebuilds database from board object', async () => {
      // Create a new storage instance
      const newDbPath = path.join(testDir, 'rebuild.db');
      // Create empty database file first
      const tempDb = new Database(newDbPath);
      tempDb.close();
      const newStorage = new SQLiteStorage(newDbPath);

      const board = {
        id: 'imported-board',
        name: 'Imported Board',
        columns: [
          {
            id: 'backlog',
            name: 'Backlog',
            position: 0,
            tickets: [
              {
                id: 'ticket-1',
                title: 'Imported ticket',
                status: 'backlog' as const,
                statusId: 'status-backlog',
                column: 'Backlog',
                position: 0,
                priority: 'HIGH',
                specs: [],
                subtasks: [
                  { id: 'sub-1', title: 'Subtask', done: false },
                ],
                metadata: {},
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          },
          {
            id: 'done',
            name: 'Done',
            position: 1,
            tickets: [],
          },
        ],
        updatedAt: new Date(),
      };

      await newStorage.rebuildFromBoard(board);

      const retrieved = await newStorage.getBoard();
      expect(retrieved.name).to.equal('Imported Board');
      expect(retrieved.columns).to.have.length(2);
      expect(retrieved.columns[0].tickets).to.have.length(1);
      expect(retrieved.columns[0].tickets[0].subtasks).to.have.length(1);

      await newStorage.close();
    });
  });

  describe('Ticket Dependency Operations', () => {
    let ticket1Id: string;
    let ticket2Id: string;
    let ticket3Id: string;

    beforeEach(async () => {
      const ticket1 = await storage.createTicket({ title: 'Ticket 1', column: 'Backlog' });
      const ticket2 = await storage.createTicket({ title: 'Ticket 2', column: 'Backlog' });
      const ticket3 = await storage.createTicket({ title: 'Ticket 3', column: 'Backlog' });
      ticket1Id = ticket1.id;
      ticket2Id = ticket2.id;
      ticket3Id = ticket3.id;
    });

    it('creates a blocking dependency', async () => {
      const dep = await storage.createTicketDependency(ticket1Id, ticket2Id, 'blocks');

      expect(dep.ticketId).to.equal(ticket1Id);
      expect(dep.dependsOnTicketId).to.equal(ticket2Id);
      expect(dep.dependencyType).to.equal('blocks');
    });

    it('creates a relates_to dependency', async () => {
      const dep = await storage.createTicketDependency(ticket1Id, ticket2Id, 'relates_to');
      expect(dep.dependencyType).to.equal('relates_to');
    });

    it('creates a duplicates dependency', async () => {
      const dep = await storage.createTicketDependency(ticket1Id, ticket2Id, 'duplicates');
      expect(dep.dependencyType).to.equal('duplicates');
    });

    it('defaults to blocks type', async () => {
      const dep = await storage.createTicketDependency(ticket1Id, ticket2Id);
      expect(dep.dependencyType).to.equal('blocks');
    });

    it('prevents self-dependency', async () => {
      try {
        await storage.createTicketDependency(ticket1Id, ticket1Id);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect((error as Error).message).to.include('self-dependency');
      }
    });

    it('prevents duplicate dependencies', async () => {
      await storage.createTicketDependency(ticket1Id, ticket2Id, 'blocks');
      try {
        await storage.createTicketDependency(ticket1Id, ticket2Id, 'blocks');
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect((error as Error).message).to.include('already exists');
      }
    });

    it('validates source ticket exists', async () => {
      try {
        await storage.createTicketDependency('non-existent', ticket2Id);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect((error as Error).message).to.include('not found');
      }
    });

    it('validates target ticket exists', async () => {
      try {
        await storage.createTicketDependency(ticket1Id, 'non-existent');
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect((error as Error).message).to.include('not found');
      }
    });

    it('deletes a dependency', async () => {
      await storage.createTicketDependency(ticket1Id, ticket2Id, 'blocks');
      await storage.deleteTicketDependency(ticket1Id, ticket2Id, 'blocks');

      const deps = await storage.listTicketDependencies(ticket1Id);
      expect(deps).to.have.length(0);
    });

    it('lists dependencies for a ticket', async () => {
      await storage.createTicketDependency(ticket1Id, ticket2Id, 'blocks');
      await storage.createTicketDependency(ticket1Id, ticket3Id, 'relates_to');

      const deps = await storage.listTicketDependencies(ticket1Id);
      expect(deps).to.have.length(2);
    });

    it('gets blockers for a ticket', async () => {
      await storage.createTicketDependency(ticket1Id, ticket2Id, 'blocks');
      await storage.createTicketDependency(ticket1Id, ticket3Id, 'relates_to');

      const blockers = await storage.getTicketBlockers(ticket1Id);
      expect(blockers).to.have.length(1);
      expect(blockers[0].id).to.equal(ticket2Id);
    });

    it('gets tickets blocked by a ticket', async () => {
      await storage.createTicketDependency(ticket1Id, ticket2Id, 'blocks');
      await storage.createTicketDependency(ticket3Id, ticket2Id, 'blocks');

      const blocked = await storage.getTicketsBlockedBy(ticket2Id);
      expect(blocked).to.have.length(2);
    });

    it('checks if ticket is blocked (incomplete blocker)', async () => {
      await storage.createTicketDependency(ticket1Id, ticket2Id, 'blocks');

      const isBlocked = await storage.isTicketBlocked(ticket1Id);
      expect(isBlocked).to.be.true;
    });

    it('checks if ticket is not blocked (blocker complete)', async () => {
      await storage.createTicketDependency(ticket1Id, ticket2Id, 'blocks');
      await storage.updateTicket(ticket2Id, { status: 'done' });

      const isBlocked = await storage.isTicketBlocked(ticket1Id);
      expect(isBlocked).to.be.false;
    });

    it('checks if ticket is not blocked (no blockers)', async () => {
      const isBlocked = await storage.isTicketBlocked(ticket1Id);
      expect(isBlocked).to.be.false;
    });
  });

  describe('Spec Dependency Operations', () => {
    let spec1Id: string;
    let spec2Id: string;

    beforeEach(async () => {
      const spec1 = await storage.createSpec({ id: 'spec-1', title: 'Spec 1' });
      const spec2 = await storage.createSpec({ id: 'spec-2', title: 'Spec 2' });
      spec1Id = spec1.id;
      spec2Id = spec2.id;
    });

    it('creates a depends_on dependency', async () => {
      const dep = await storage.createSpecDependency(spec1Id, spec2Id, 'depends_on');

      expect(dep.specId).to.equal(spec1Id);
      expect(dep.dependsOnSpecId).to.equal(spec2Id);
      expect(dep.dependencyType).to.equal('depends_on');
    });

    it('creates a relates_to dependency', async () => {
      const dep = await storage.createSpecDependency(spec1Id, spec2Id, 'relates_to');
      expect(dep.dependencyType).to.equal('relates_to');
    });

    it('defaults to depends_on type', async () => {
      const dep = await storage.createSpecDependency(spec1Id, spec2Id);
      expect(dep.dependencyType).to.equal('depends_on');
    });

    it('deletes a dependency', async () => {
      await storage.createSpecDependency(spec1Id, spec2Id);
      await storage.deleteSpecDependency(spec1Id, spec2Id);

      const deps = await storage.listSpecDependencies(spec1Id);
      expect(deps).to.have.length(0);
    });

    it('lists dependencies for a spec', async () => {
      await storage.createSpecDependency(spec1Id, spec2Id);

      const deps = await storage.listSpecDependencies(spec1Id);
      expect(deps).to.have.length(1);
    });
  });

  describe('Epic Dependency Operations', () => {
    let epic1Id: string;
    let epic2Id: string;

    beforeEach(async () => {
      const epic1 = await storage.createEpic({ title: 'Epic 1' });
      const epic2 = await storage.createEpic({ title: 'Epic 2' });
      epic1Id = epic1.id;
      epic2Id = epic2.id;
    });

    it('creates a blocking dependency', async () => {
      const dep = await storage.createEpicDependency(epic1Id, epic2Id, 'blocks');

      expect(dep.epicId).to.equal(epic1Id);
      expect(dep.dependsOnEpicId).to.equal(epic2Id);
      expect(dep.dependencyType).to.equal('blocks');
    });

    it('creates a relates_to dependency', async () => {
      const dep = await storage.createEpicDependency(epic1Id, epic2Id, 'relates_to');
      expect(dep.dependencyType).to.equal('relates_to');
    });

    it('defaults to blocks type', async () => {
      const dep = await storage.createEpicDependency(epic1Id, epic2Id);
      expect(dep.dependencyType).to.equal('blocks');
    });

    it('deletes a dependency', async () => {
      await storage.createEpicDependency(epic1Id, epic2Id);
      await storage.deleteEpicDependency(epic1Id, epic2Id);

      const deps = await storage.listEpicDependencies(epic1Id);
      expect(deps).to.have.length(0);
    });

    it('lists dependencies for an epic', async () => {
      await storage.createEpicDependency(epic1Id, epic2Id);

      const deps = await storage.listEpicDependencies(epic1Id);
      expect(deps).to.have.length(1);
    });

    it('checks if epic is blocked (incomplete blocker)', async () => {
      await storage.createEpicDependency(epic1Id, epic2Id, 'blocks');

      const isBlocked = await storage.isEpicBlocked(epic1Id);
      expect(isBlocked).to.be.true;
    });

    it('checks if epic is not blocked (blocker complete)', async () => {
      await storage.createEpicDependency(epic1Id, epic2Id, 'blocks');
      await storage.updateEpic(epic2Id, { status: 'complete' });

      const isBlocked = await storage.isEpicBlocked(epic1Id);
      expect(isBlocked).to.be.false;
    });
  });
});
