import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js';

/**
 * Unit tests for PMO Board Views Storage
 * Tests the BoardView CRUD operations and filtered board retrieval
 */
describe('PMO Board Views Storage Tests', () => {
  let testDir: string;
  let dbPath: string;
  let storage: SQLiteStorage;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-views-storage-'));
    const proletariatDir = path.join(testDir, '.proletariat');
    fs.mkdirSync(proletariatDir, { recursive: true });
    dbPath = path.join(proletariatDir, 'workspace.db');

    storage = new SQLiteStorage(dbPath);

    // Create a project (workflow is automatically assigned)
    await storage.createProject({
      id: 'test-project',
      name: 'Test Project',
      template: 'kanban',
    });

    // Create test tickets with different properties
    await storage.createTicket('test-project', {
      id: 'TEST-001',
      title: 'High priority task',
      priority: 'HIGH',
      assignee: 'alice',
    });
    await storage.createTicket('test-project', {
      id: 'TEST-002',
      title: 'Medium priority task',
      priority: 'MEDIUM',
      assignee: 'bob',
    });
    await storage.createTicket('test-project', {
      id: 'TEST-003',
      title: 'Low priority task',
      priority: 'LOW',
      assignee: 'alice',
    });
    await storage.createTicket('test-project', {
      id: 'TEST-004',
      title: 'Unassigned task',
      priority: 'HIGH',
    });
  });

  afterEach(async () => {
    if (storage) await storage.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('BoardView CRUD Operations', () => {
    it('should create a board view', async () => {
      const view = await storage.createBoardView({
        projectId: 'test-project',
        name: 'My Tasks',
        description: 'Tasks assigned to me',
        filters: { assignee: 'alice' },
      });

      expect(view.id).to.exist;
      expect(view.name).to.equal('My Tasks');
      expect(view.description).to.equal('Tasks assigned to me');
      expect(view.filters.assignee).to.equal('alice');
      expect(view.projectId).to.equal('test-project');
    });

    it('should get a board view by ID', async () => {
      const created = await storage.createBoardView({
        projectId: 'test-project',
        name: 'High Priority',
        filters: { priority: 'HIGH' },
      });

      const fetched = await storage.getBoardView(created.id);
      expect(fetched).to.not.be.null;
      expect(fetched!.name).to.equal('High Priority');
      expect(fetched!.filters.priority).to.equal('HIGH');
    });

    it('should list board views for a project', async () => {
      await storage.createBoardView({
        projectId: 'test-project',
        name: 'View 1',
        filters: {},
      });
      await storage.createBoardView({
        projectId: 'test-project',
        name: 'View 2',
        filters: { priority: 'HIGH' },
      });

      const views = await storage.listBoardViews({ projectId: 'test-project' });
      expect(views).to.have.length(2);
    });

    it('should update a board view', async () => {
      const view = await storage.createBoardView({
        projectId: 'test-project',
        name: 'Original Name',
        filters: {},
      });

      const updated = await storage.updateBoardView(view.id, {
        name: 'Updated Name',
        filters: { assignee: 'bob' },
      });

      expect(updated.name).to.equal('Updated Name');
      expect(updated.filters.assignee).to.equal('bob');
    });

    it('should delete a board view', async () => {
      const view = await storage.createBoardView({
        projectId: 'test-project',
        name: 'To Delete',
        filters: {},
      });

      await storage.deleteBoardView(view.id);

      const fetched = await storage.getBoardView(view.id);
      expect(fetched).to.be.null;
    });

    it('should handle default view flag', async () => {
      const view1 = await storage.createBoardView({
        projectId: 'test-project',
        name: 'View 1',
        isDefault: true,
        filters: {},
      });

      expect(view1.isDefault).to.be.true;

      // Creating another default should unset the first
      await storage.createBoardView({
        projectId: 'test-project',
        name: 'View 2',
        isDefault: true,
        filters: {},
      });

      const view1Updated = await storage.getBoardView(view1.id);
      expect(view1Updated!.isDefault).to.be.false;
    });

    it('should get default board view', async () => {
      await storage.createBoardView({
        projectId: 'test-project',
        name: 'Not Default',
        filters: {},
      });
      const defaultView = await storage.createBoardView({
        projectId: 'test-project',
        name: 'Default View',
        isDefault: true,
        filters: {},
      });

      const fetched = await storage.getDefaultBoardView('test-project');
      expect(fetched).to.not.be.null;
      expect(fetched!.id).to.equal(defaultView.id);
      expect(fetched!.name).to.equal('Default View');
    });
  });

  describe('Filtered Board Retrieval', () => {
    it('should get board without filters', async () => {
      const board = await storage.getBoardWithView('test-project');

      let totalTickets = 0;
      for (const column of board.columns) {
        totalTickets += column.tickets.length;
      }
      expect(totalTickets).to.equal(4);
    });

    it('should filter board by assignee', async () => {
      const board = await storage.getBoardWithView('test-project', undefined, { assignee: 'alice' });

      let matchingTickets = 0;
      for (const column of board.columns) {
        for (const ticket of column.tickets) {
          expect(ticket.assignee).to.equal('alice');
          matchingTickets++;
        }
      }
      expect(matchingTickets).to.equal(2); // TEST-001, TEST-003
    });

    it('should filter board by unassigned', async () => {
      const board = await storage.getBoardWithView('test-project', undefined, { assignee: 'unassigned' });

      let matchingTickets = 0;
      for (const column of board.columns) {
        for (const ticket of column.tickets) {
          expect(ticket.assignee).to.be.undefined;
          matchingTickets++;
        }
      }
      expect(matchingTickets).to.equal(1); // TEST-004
    });

    it('should filter board by priority', async () => {
      const board = await storage.getBoardWithView('test-project', undefined, { priority: 'HIGH' });

      let matchingTickets = 0;
      for (const column of board.columns) {
        for (const ticket of column.tickets) {
          expect(ticket.priority?.toUpperCase()).to.equal('HIGH');
          matchingTickets++;
        }
      }
      expect(matchingTickets).to.equal(2); // TEST-001, TEST-004
    });

    it('should apply view filters when using viewId', async () => {
      const view = await storage.createBoardView({
        projectId: 'test-project',
        name: 'Alice Tasks',
        filters: { assignee: 'alice' },
      });

      const board = await storage.getBoardWithView('test-project', view.id);

      let matchingTickets = 0;
      for (const column of board.columns) {
        for (const ticket of column.tickets) {
          expect(ticket.assignee).to.equal('alice');
          matchingTickets++;
        }
      }
      expect(matchingTickets).to.equal(2);
    });

    it('should allow explicit filters to override view filters', async () => {
      const view = await storage.createBoardView({
        projectId: 'test-project',
        name: 'Alice Tasks',
        filters: { assignee: 'alice' },
      });

      // Override with bob
      const board = await storage.getBoardWithView('test-project', view.id, { assignee: 'bob' });

      let matchingTickets = 0;
      for (const column of board.columns) {
        for (const ticket of column.tickets) {
          expect(ticket.assignee).to.equal('bob');
          matchingTickets++;
        }
      }
      expect(matchingTickets).to.equal(1); // Only TEST-002
    });

    it('should filter by search text', async () => {
      const board = await storage.getBoardWithView('test-project', undefined, { search: 'High priority' });

      let matchingTickets = 0;
      for (const column of board.columns) {
        for (const ticket of column.tickets) {
          expect(ticket.title.toLowerCase()).to.contain('high priority');
          matchingTickets++;
        }
      }
      expect(matchingTickets).to.equal(1); // TEST-001
    });

    it('should combine multiple filters', async () => {
      const board = await storage.getBoardWithView('test-project', undefined, {
        assignee: 'alice',
        priority: 'HIGH',
      });

      let matchingTickets = 0;
      for (const column of board.columns) {
        for (const ticket of column.tickets) {
          expect(ticket.assignee).to.equal('alice');
          expect(ticket.priority?.toUpperCase()).to.equal('HIGH');
          matchingTickets++;
        }
      }
      expect(matchingTickets).to.equal(1); // Only TEST-001
    });
  });

  describe('Sorting', () => {
    it('should sort tickets by priority', async () => {
      const view = await storage.createBoardView({
        projectId: 'test-project',
        name: 'Priority Sorted',
        filters: {},
        sortBy: 'priority',
      });

      const board = await storage.getBoardWithView(view.id);

      // Check first column has tickets sorted by priority
      const backlog = board.columns.find(c => c.name === 'Backlog');
      if (backlog && backlog.tickets.length > 1) {
        const priorities = backlog.tickets.map(t => t.priority || 'MEDIUM');
        const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        for (let i = 1; i < priorities.length; i++) {
          const prev = priorityOrder[priorities[i - 1] as keyof typeof priorityOrder] ?? 3;
          const curr = priorityOrder[priorities[i] as keyof typeof priorityOrder] ?? 3;
          expect(prev).to.be.at.most(curr);
        }
      }
    });

    it('should sort tickets by title', async () => {
      const view = await storage.createBoardView({
        projectId: 'test-project',
        name: 'Title Sorted',
        filters: {},
        sortBy: 'title',
      });

      const board = await storage.getBoardWithView(view.id);

      // Check first column has tickets sorted by title
      const backlog = board.columns.find(c => c.name === 'Backlog');
      if (backlog && backlog.tickets.length > 1) {
        const titles = backlog.tickets.map(t => t.title);
        for (let i = 1; i < titles.length; i++) {
          expect(titles[i - 1].localeCompare(titles[i])).to.be.at.most(0);
        }
      }
    });
  });

  describe('View Persistence', () => {
    it('should persist view with all options', async () => {
      const created = await storage.createBoardView({
        projectId: 'test-project',
        name: 'Full View',
        description: 'A view with all options',
        filters: {
          assignee: 'alice',
          priority: 'HIGH',
          search: 'task',
        },
        sortBy: 'priority',
        groupBy: 'assignee',
        isDefault: true,
      });

      // Close and reopen storage to test persistence
      await storage.close();
      storage = new SQLiteStorage(dbPath);

      const loaded = await storage.getBoardView(created.id);
      expect(loaded).to.not.be.null;
      expect(loaded!.name).to.equal('Full View');
      expect(loaded!.description).to.equal('A view with all options');
      expect(loaded!.filters.assignee).to.equal('alice');
      expect(loaded!.filters.priority).to.equal('HIGH');
      expect(loaded!.filters.search).to.equal('task');
      expect(loaded!.sortBy).to.equal('priority');
      expect(loaded!.groupBy).to.equal('assignee');
      expect(loaded!.isDefault).to.be.true;
    });
  });
});
