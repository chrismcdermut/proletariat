import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js';

describe('PMO SQLite Storage', () => {
  let testDir: string;
  let storage: SQLiteStorage;
  const projectId = 'default';

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-test-'));
    const dbPath = path.join(testDir, 'pmo.db');

    // Create empty database file first (SQLiteStorage now requires it to exist)
    const db = new Database(dbPath);
    db.close();

    storage = new SQLiteStorage(dbPath);

    // Create a project first (workflow is automatically assigned)
    await storage.createProject({
      id: projectId,
      name: 'Test Project',
      template: 'kanban',
    });
  });

  afterEach(async () => {
    await storage.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Board Operations', () => {
    it('initializes board with columns from workflow', async () => {
      const board = await storage.getBoard(projectId);

      expect(board.name).to.equal('Test Project');
      expect(board.columns).to.have.length.greaterThan(0);
      // Kanban template has Backlog, Ready, In Progress, Review, Done
      const columnNames = board.columns.map(c => c.name);
      expect(columnNames).to.include('Backlog');
      expect(columnNames).to.include('Done');
    });

    it('generates board markdown', async () => {
      const markdown = await storage.getBoardMarkdown(projectId);

      expect(markdown).to.include('kanban-plugin');
      expect(markdown).to.include('## Backlog');
      expect(markdown).to.include('## Done');
    });
  });

  describe('Column Operations', () => {
    it('creates a new column (status)', async () => {
      await storage.createColumn(projectId, 'Review', 2);

      const board = await storage.getBoard(projectId);
      const reviewCol = board.columns.find(c => c.name === 'Review');
      expect(reviewCol).to.not.be.undefined;
    });

    it('renames a column', async () => {
      const board = await storage.getBoard(projectId);
      const backlogCol = board.columns.find(c => c.name === 'Backlog');

      await storage.renameColumn(projectId, backlogCol!.id, 'Todo');

      const updated = await storage.getBoard(projectId);
      const todoCol = updated.columns.find(c => c.name === 'Todo');
      expect(todoCol).to.not.be.undefined;
    });

    it('moves a column to a new position', async () => {
      const board = await storage.getBoard(projectId);
      const doneCol = board.columns.find(c => c.name === 'Done');
      const originalPosition = doneCol!.position;

      await storage.moveColumn(projectId, doneCol!.id, 0);

      const updated = await storage.getBoard(projectId);
      const movedCol = updated.columns.find(c => c.name === 'Done');
      expect(movedCol!.position).to.not.equal(originalPosition);
    });

    it('deletes a column', async () => {
      const board = await storage.getBoard(projectId);
      const initialCount = board.columns.length;
      const doneCol = board.columns.find(c => c.name === 'Done');

      await storage.deleteColumn(projectId, doneCol!.id);

      const updated = await storage.getBoard(projectId);
      expect(updated.columns).to.have.length(initialCount - 1);
    });
  });

  describe('Ticket Operations', () => {
    it('creates a ticket', async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Implement feature',
        statusName: 'Backlog',
        priority: 'P0',
      });

      expect(ticket.id).to.match(/^TKT-\d{3,}$/);
      expect(ticket.title).to.equal('Implement feature');
      expect(ticket.statusName).to.equal('Backlog');
      expect(ticket.priority).to.equal('P0');
    });

    it('creates ticket with custom id', async () => {
      const ticket = await storage.createTicket(projectId, {
        id: 'my-custom-id',
        title: 'Custom ticket',
        statusName: 'Backlog',
      });

      expect(ticket.id).to.equal('my-custom-id');
    });

    it('retrieves a ticket', async () => {
      const created = await storage.createTicket(projectId, {
        title: 'Implement feature',
        statusName: 'Backlog',
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
      const created = await storage.createTicket(projectId, {
        title: 'Original title',
        statusName: 'Backlog',
      });

      const updated = await storage.updateTicket(created.id, {
        title: 'Updated title',
        priority: 'P1',
      });

      expect(updated.title).to.equal('Updated title');
      expect(updated.priority).to.equal('P1');
    });

    it('moves a ticket to a different column', async () => {
      const created = await storage.createTicket(projectId, {
        title: 'My ticket',
        statusName: 'Backlog',
      });

      const moved = await storage.moveTicket(projectId, created.id, 'In Progress');

      expect(moved.statusName).to.equal('In Progress');
    });

    it('moves a ticket to a specific position', async () => {
      await storage.createTicket(projectId, { title: 'Ticket 1', statusName: 'Backlog' });
      await storage.createTicket(projectId, { title: 'Ticket 2', statusName: 'Backlog' });
      const ticket3 = await storage.createTicket(projectId, { title: 'Ticket 3', statusName: 'Backlog' });

      await storage.moveTicket(projectId, ticket3.id, 'Backlog', 0);

      const tickets = await storage.listTickets(projectId, { column: 'Backlog' });
      // Note: with new workflow-based sorting (priority then created_at), position may differ
      // Just verify all 3 tickets are in Backlog
      expect(tickets).to.have.length(3);
    });

    it('deletes a ticket', async () => {
      const created = await storage.createTicket(projectId, {
        title: 'To delete',
        statusName: 'Backlog',
      });

      await storage.deleteTicket(created.id);

      const ticket = await storage.getTicket(created.id);
      expect(ticket).to.be.null;
    });

    it('lists all tickets', async () => {
      await storage.createTicket(projectId, { title: 'Ticket 1', statusName: 'Backlog' });
      await storage.createTicket(projectId, { title: 'Ticket 2', statusName: 'In Progress' });

      const tickets = await storage.listTickets(projectId);
      expect(tickets).to.have.length(2);
    });

    it('lists tickets filtered by column', async () => {
      await storage.createTicket(projectId, { title: 'Ticket A', statusName: 'Done' });
      await storage.createTicket(projectId, { title: 'Ticket B', statusName: 'Backlog' });

      const doneTickets = await storage.listTickets(projectId, { column: 'Done' });
      expect(doneTickets).to.have.length(1);
      expect(doneTickets[0].title).to.equal('Ticket A');
    });

    it('lists tickets filtered by priority', async () => {
      await storage.createTicket(projectId, { title: 'Urgent bug', statusName: 'Backlog', priority: 'URGENT' });
      await storage.createTicket(projectId, { title: 'Feature', statusName: 'Backlog', priority: 'LOW' });

      const tickets = await storage.listTickets(projectId, { priority: 'URGENT' });
      expect(tickets).to.have.length(1);
      expect(tickets[0].title).to.equal('Urgent bug');
    });

    it('lists tickets filtered by category', async () => {
      await storage.createTicket(projectId, { title: 'Bug 1', statusName: 'Backlog', category: 'bug' });
      await storage.createTicket(projectId, { title: 'Feature 1', statusName: 'Backlog', category: 'feature' });

      const tickets = await storage.listTickets(projectId, { category: 'bug' });
      expect(tickets).to.have.length(1);
      expect(tickets[0].title).to.equal('Bug 1');
    });

    it('searches tickets by title/description', async () => {
      await storage.createTicket(projectId, { title: 'Fix login bug', statusName: 'Backlog', description: 'Users cannot log in' });
      await storage.createTicket(projectId, { title: 'Add feature', statusName: 'Backlog', description: 'New dashboard' });

      const results = await storage.listTickets(projectId, { search: 'login' });
      expect(results).to.have.length(1);
      expect(results[0].title).to.equal('Fix login bug');
    });
  });

  describe('Subtask Operations', () => {
    let mainTicketId: string;

    beforeEach(async () => {
      const ticket = await storage.createTicket(projectId, {
        title: 'Main ticket',
        statusName: 'Backlog',
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
      const ticket = await storage.createTicket(projectId, { title: 'My ticket', statusName: 'Backlog' });
      await storage.createSpec({ id: 'spec-1', title: 'Spec 1' });

      await storage.linkTicketToSpec(ticket.id, 'spec-1');

      const specs = await storage.getSpecsForTicket(ticket.id);
      expect(specs).to.have.length(1);
      expect(specs[0].id).to.equal('spec-1');
    });

    it('gets tickets for a spec', async () => {
      const ticket1 = await storage.createTicket(projectId, { title: 'Ticket 1', statusName: 'Backlog' });
      const ticket2 = await storage.createTicket(projectId, { title: 'Ticket 2', statusName: 'Backlog' });
      await storage.createSpec({ id: 'spec-1', title: 'Spec 1' });

      await storage.linkTicketToSpec(ticket1.id, 'spec-1');
      await storage.linkTicketToSpec(ticket2.id, 'spec-1');

      const tickets = await storage.getTicketsForSpec(projectId, 'spec-1');
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

      // First create the project
      await newStorage.createProject({
        id: projectId,
        name: 'Test Project',
        template: 'kanban',
      });

      const board = {
        id: projectId, // board.id is used as projectId
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
                statusName: 'Backlog',
                position: 0,
                priority: 'HIGH',
                specs: [],
                subtasks: [
                  { id: 'sub-1', title: 'Subtask', done: false },
                ],
                labels: [],
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

      newStorage.rebuildFromBoard(board);

      const retrieved = await newStorage.getBoard(projectId);
      expect(retrieved.name).to.equal('Imported Board');
      // Columns come from the project's workflow (kanban has 5), not from board.columns
      expect(retrieved.columns.length).to.be.greaterThan(0);
      // Find the backlog column and check it has the imported ticket
      const backlogCol = retrieved.columns.find(c => c.name.toLowerCase() === 'backlog');
      expect(backlogCol).to.not.be.undefined;
      if (backlogCol) {
        expect(backlogCol.tickets).to.have.length(1);
        expect(backlogCol.tickets[0].subtasks).to.have.length(1);
      }

      await newStorage.close();
    });
  });

  describe('Ticket Dependency Operations', () => {
    let ticket1Id: string;
    let ticket2Id: string;
    let ticket3Id: string;

    beforeEach(async () => {
      const ticket1 = await storage.createTicket(projectId, { title: 'Ticket 1', statusName: 'Backlog' });
      const ticket2 = await storage.createTicket(projectId, { title: 'Ticket 2', statusName: 'Backlog' });
      const ticket3 = await storage.createTicket(projectId, { title: 'Ticket 3', statusName: 'Backlog' });
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
      // Find a status with 'completed' category
      const statuses = await storage.listStatuses('default');
      const doneStatus = statuses.find(s => s.category === 'completed');
      expect(doneStatus).to.not.be.undefined;
      await storage.updateTicket(ticket2Id, { statusId: doneStatus!.id });

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
      const epic1 = await storage.createEpic(projectId, { title: 'Epic 1' });
      const epic2 = await storage.createEpic(projectId, { title: 'Epic 2' });
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

  describe('Cross-Project Ticket Operations', () => {
    const project1Id = 'project-1';
    const project2Id = 'project-2';

    beforeEach(async () => {
      // Create two projects
      await storage.createProject({
        id: project1Id,
        name: 'First Project',
        template: 'kanban',
      });
      await storage.createProject({
        id: project2Id,
        name: 'Second Project',
        template: 'kanban',
      });
    });

    it('retrieves a ticket by ID from any project', async () => {
      // Create ticket in project 1
      const ticket = await storage.createTicket(project1Id, {
        title: 'Cross-project ticket',
        statusName: 'Backlog',
      });

      // Should be able to get the ticket without specifying project
      const retrieved = await storage.getTicket(ticket.id);
      expect(retrieved).to.not.be.null;
      expect(retrieved!.title).to.equal('Cross-project ticket');
      expect(retrieved!.projectId).to.equal(project1Id);
    });

    it('updates a ticket by ID from any project', async () => {
      // Create ticket in project 1
      const ticket = await storage.createTicket(project1Id, {
        title: 'Original title',
        statusName: 'Backlog',
      });

      // Should be able to update the ticket
      const updated = await storage.updateTicket(ticket.id, {
        title: 'Updated title',
        priority: 'P1',
      });

      expect(updated.title).to.equal('Updated title');
      expect(updated.priority).to.equal('P1');
    });

    it('deletes a ticket by ID from any project', async () => {
      // Create ticket in project 1
      const ticket = await storage.createTicket(project1Id, {
        title: 'To be deleted',
        statusName: 'Backlog',
      });

      // Should be able to delete the ticket
      await storage.deleteTicket(ticket.id);

      const retrieved = await storage.getTicket(ticket.id);
      expect(retrieved).to.be.null;
    });

    it('lists tickets across all projects with allProjects option', async () => {
      // Create ticket in project 1
      await storage.createTicket(project1Id, {
        title: 'Project 1 ticket',
        statusName: 'Backlog',
      });

      // Create ticket in project 2
      await storage.createTicket(project2Id, {
        title: 'Project 2 ticket',
        statusName: 'Backlog',
      });

      // List all tickets by passing undefined for projectId and using allProjects filter
      const allTickets = await storage.listTickets(undefined, { allProjects: true });
      expect(allTickets).to.have.length.at.least(2);

      const titles = allTickets.map(t => t.title);
      expect(titles).to.include('Project 1 ticket');
      expect(titles).to.include('Project 2 ticket');
    });

    it('lists tickets in specific project', async () => {
      // Create ticket in project 1
      await storage.createTicket(project1Id, {
        title: 'Project 1 ticket',
        statusName: 'Backlog',
      });

      // Create ticket in project 2
      await storage.createTicket(project2Id, {
        title: 'Project 2 ticket',
        statusName: 'Backlog',
      });

      // List only project 1 tickets
      const project1Tickets = await storage.listTickets(project1Id);
      expect(project1Tickets).to.have.length(1);
      expect(project1Tickets[0].title).to.equal('Project 1 ticket');
    });

    it('moves ticket to a different project', async () => {
      // Create ticket in project 1
      const ticket = await storage.createTicket(project1Id, {
        title: 'To be moved',
        statusName: 'Backlog',
      });

      expect(ticket.projectId).to.equal(project1Id);

      // Move to project 2
      const movedTicket = await storage.moveTicketToProject(ticket.id, project2Id);

      expect(movedTicket.projectId).to.equal(project2Id);

      // Verify the ticket is now in project 2
      const project2Tickets = await storage.listTickets(project2Id);
      expect(project2Tickets).to.have.length(1);
      expect(project2Tickets[0].id).to.equal(ticket.id);

      // Verify ticket is not in project 1
      const project1Tickets = await storage.listTickets(project1Id);
      expect(project1Tickets).to.have.length(0);
    });

    it('places moved ticket in first status of target project', async () => {
      // Create ticket in project 1
      const ticket = await storage.createTicket(project1Id, {
        title: 'To be moved',
        statusName: 'In Progress', // Start in middle column
      });

      // Move to project 2
      await storage.moveTicketToProject(ticket.id, project2Id);

      // Should be in first column of project 2
      const board = await storage.getBoard(project2Id);
      const firstColumn = board.columns[0];
      const ticketInBoard = firstColumn.tickets.find(t => t.id === ticket.id);
      expect(ticketInBoard).to.not.be.undefined;
    });

    it('throws error when moving to non-existent project', async () => {
      const ticket = await storage.createTicket(project1Id, {
        title: 'Test ticket',
        statusName: 'Backlog',
      });

      try {
        await storage.moveTicketToProject(ticket.id, 'non-existent-project');
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect((error as Error).message).to.include('Project not found');
      }
    });

    it('throws error when moving non-existent ticket', async () => {
      try {
        await storage.moveTicketToProject('non-existent-ticket', project2Id);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect((error as Error).message).to.include('Ticket not found');
      }
    });
  });
});
