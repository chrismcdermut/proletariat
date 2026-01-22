import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../src/lib/pmo/types.js';

describe('PMO Workflow Status', () => {
  let testDir: string;
  let storage: SQLiteStorage;
  const projectId = 'default';
  // When a project uses workflow 'kanban', it references that shared workflow
  const workflowId = 'kanban';

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-workflow-test-'));
    const dbPath = path.join(testDir, 'pmo.db');

    // Create empty database file first
    const db = new Database(dbPath);
    db.close();

    storage = new SQLiteStorage(dbPath);

    // Create a project with kanban workflow
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

  describe('Built-in Workflows', () => {
    it('seeds built-in workflows on database creation', async () => {
      const workflows = await storage.listWorkflows();

      expect(workflows.length).to.be.greaterThanOrEqual(5);

      const kanban = workflows.find(w => w.id === 'kanban');
      expect(kanban).to.not.be.undefined;
      expect(kanban!.isBuiltin).to.be.true;

      const linear = workflows.find(w => w.id === 'linear');
      expect(linear).to.not.be.undefined;
      expect(linear!.isBuiltin).to.be.true;
    });

    it('prevents deletion of built-in workflows', async () => {
      try {
        await storage.deleteWorkflow('kanban');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('Cannot delete built-in');
      }
    });

    it('lists workflows with filter', async () => {
      const builtinWorkflows = await storage.listWorkflows({ isBuiltin: true });
      expect(builtinWorkflows.length).to.be.greaterThanOrEqual(5);
      expect(builtinWorkflows.every(w => w.isBuiltin)).to.be.true;

      const customWorkflows = await storage.listWorkflows({ isBuiltin: false });
      expect(customWorkflows.every(w => !w.isBuiltin)).to.be.true;
    });
  });

  describe('Workflow Assignment', () => {
    it('assigns workflow when creating project', async () => {
      // Create a new project with linear workflow
      await storage.createProject({
        id: 'workflow-test',
        name: 'Workflow Test',
        template: 'linear',
      });

      // Verify statuses come from the linear workflow
      const projectStatuses = await storage.listStatuses('linear');
      expect(projectStatuses.length).to.be.greaterThan(0);

      // Check that statuses span multiple categories
      const categories = new Set(projectStatuses.map(s => s.category));
      expect(categories.size).to.be.greaterThan(1);
    });

    it('sets first backlog status as default', async () => {
      const defaultStatus = await storage.getDefaultStatus(workflowId);
      expect(defaultStatus).to.not.be.null;
      expect(defaultStatus!.category).to.equal('backlog');
      expect(defaultStatus!.isDefault).to.be.true;
    });
  });

  describe('Status CRUD Operations', () => {
    it('creates a new status', async () => {
      const status = await storage.createStatus(workflowId, {
        name: 'In Review',
        category: 'started',
      });

      expect(status.name).to.equal('In Review');
      expect(status.category).to.equal('started');
      expect(status.workflowId).to.equal(workflowId);
    });

    it('prevents duplicate status names in same workflow', async () => {
      await storage.createStatus(workflowId, {
        name: 'Review',
        category: 'started',
      });

      try {
        await storage.createStatus(workflowId, {
          name: 'Review',
          category: 'started',
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('already exists');
      }
    });

    it('updates a status', async () => {
      const status = await storage.createStatus(workflowId, {
        name: 'ReviewStatus',
        category: 'started',
      });

      const updated = await storage.updateStatus(status.id, {
        name: 'Code Review',
        color: '#FF0000',
      });

      expect(updated.name).to.equal('Code Review');
      expect(updated.color).to.equal('#FF0000');
    });

    it('deletes a status without tickets', async () => {
      const status = await storage.createStatus(workflowId, {
        name: 'Temporary',
        category: 'started',
      });

      await storage.deleteStatus(status.id);

      const deleted = await storage.getStatus(status.id);
      expect(deleted).to.be.null;
    });

    it('reorders statuses within category', async () => {
      const status1 = await storage.createStatus(workflowId, {
        name: 'Status A',
        category: 'started',
      });

      const status2 = await storage.createStatus(workflowId, {
        name: 'Status B',
        category: 'started',
      });

      // Move status2 before status1
      await storage.reorderStatus(status2.id, status1.position);

      const reordered = await storage.getStatus(status2.id);
      expect(reordered!.position).to.equal(status1.position);
    });
  });

  describe('Status Categories', () => {
    it('lists statuses ordered by category then position', async () => {
      const statuses = await storage.listStatuses(workflowId);

      // Verify ordering: triage < backlog < unstarted < started < completed < canceled
      let lastCategoryIndex = -1;
      let lastPosition = -1;

      for (const status of statuses) {
        const categoryIndex = STATE_CATEGORY_ORDER.indexOf(status.category);

        if (categoryIndex > lastCategoryIndex) {
          // New category - reset position tracking
          lastCategoryIndex = categoryIndex;
          lastPosition = status.position;
        } else if (categoryIndex === lastCategoryIndex) {
          // Same category - position should be ascending
          expect(status.position).to.be.greaterThanOrEqual(lastPosition);
          lastPosition = status.position;
        } else {
          expect.fail('Statuses not ordered by category');
        }
      }
    });

    it('validates category values', async () => {
      try {
        await storage.createStatus(workflowId, {
          name: 'Invalid',
          category: 'invalid' as StateCategory,
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('Invalid category');
      }
    });
  });

  describe('Project Creation with Workflows', () => {
    it('assigns workflow when creating project', async () => {
      await storage.createProject({
        id: 'new-project',
        name: 'New Project',
        template: 'linear',
      });

      // Check that project uses linear workflow statuses
      const statuses = await storage.listStatuses('linear');
      expect(statuses.length).to.be.greaterThan(0);

      // Linear workflow has specific statuses
      const statusNames = statuses.map(s => s.name);
      expect(statusNames).to.include('Backlog');
      expect(statusNames).to.include('Todo');
      expect(statusNames).to.include('In Progress');
    });

    it('falls back to default workflow when workflow not found', async () => {
      const project = await storage.createProject({
        id: 'fallback-project',
        name: 'Fallback Project',
        template: 'nonexistent-workflow',
      });

      // Should use default workflow columns
      expect(project.columns.length).to.be.greaterThan(0);
      expect(project.columns[0].name).to.equal('Backlog');
    });
  });

  describe('Ticket Status Integration', () => {
    it('updates status_id when moving ticket to matching column', async () => {
      // Create a ticket
      const ticket = await storage.createTicket(projectId, {
        title: 'Test Ticket',
        statusName: 'Backlog',
      });

      // Move ticket to "Done" column (which matches "Done" status)
      const moved = await storage.moveTicket(projectId, ticket.id, 'Done');

      // The ticket should now have a status_id set
      expect(moved.statusId).to.not.be.undefined;

      // Verify the status matches the column
      const status = await storage.getStatus(moved.statusId!);
      expect(status).to.not.be.null;
      expect(status!.name).to.equal('Done');
    });
  });

  describe('Workflow Switching', () => {
    it('updates project workflow_id when switching workflows', async () => {
      // Get initial project
      const projectBefore = await storage.getProject(projectId);
      expect(projectBefore!.workflowId).to.equal('kanban');

      // Switch to linear workflow
      await storage.updateProject(projectId, { workflowId: 'linear' });

      // Verify project now uses linear workflow
      const projectAfter = await storage.getProject(projectId);
      expect(projectAfter!.workflowId).to.equal('linear');
    });

    it('preserves ticket status category when switching workflows', async () => {
      // Create a ticket in 'started' category
      const ticket = await storage.createTicket(projectId, {
        title: 'In Progress Ticket',
        statusName: 'In Progress',
      });

      // Verify ticket is in started category
      const ticketBefore = await storage.getTicket(projectId, ticket.id);
      expect(ticketBefore!.statusCategory).to.equal('started');

      // Switch to bug-smash workflow
      await storage.updateProject(projectId, { workflowId: 'bug-smash' });

      // Get bug-smash statuses to find a 'started' category status
      const bugSmashStatuses = await storage.listStatuses('bug-smash');
      const startedStatus = bugSmashStatuses.find(s => s.category === 'started');
      expect(startedStatus).to.not.be.undefined;

      // Move ticket to matching category status in new workflow
      const moved = await storage.moveTicket(projectId, ticket.id, startedStatus!.name);

      // Verify ticket is still in started category
      expect(moved.statusCategory).to.equal('started');
    });

    it('allows switching to any available workflow', async () => {
      const workflows = await storage.listWorkflows();
      expect(workflows.length).to.be.greaterThan(1);

      // Switch through all available workflows
      for (const workflow of workflows) {
        await storage.updateProject(projectId, { workflowId: workflow.id });
        const project = await storage.getProject(projectId);
        expect(project!.workflowId).to.equal(workflow.id);
      }
    });

    it('migrates multiple tickets when switching workflows', async () => {
      // Create tickets in different categories
      const backlogTicket = await storage.createTicket(projectId, {
        title: 'Backlog Ticket',
        statusName: 'Backlog',
      });
      const inProgressTicket = await storage.createTicket(projectId, {
        title: 'In Progress Ticket',
        statusName: 'In Progress',
      });
      const doneTicket = await storage.createTicket(projectId, {
        title: 'Done Ticket',
        statusName: 'Done',
      });

      // Switch to linear workflow
      await storage.updateProject(projectId, { workflowId: 'linear' });

      // Get linear statuses for migration
      const linearStatuses = await storage.listStatuses('linear');

      // Build category -> status mapping
      const categoryToStatus: Record<string, { id: string; name: string }> = {};
      for (const status of linearStatuses) {
        if (!categoryToStatus[status.category]) {
          categoryToStatus[status.category] = { id: status.id, name: status.name };
        }
      }

      // Migrate tickets to new statuses based on their categories
      const tickets = [
        { ticket: backlogTicket, oldCategory: 'backlog' },
        { ticket: inProgressTicket, oldCategory: 'started' },
        { ticket: doneTicket, oldCategory: 'completed' },
      ];

      for (const { ticket, oldCategory } of tickets) {
        const newStatus = categoryToStatus[oldCategory];
        expect(newStatus).to.not.be.undefined;
        const moved = await storage.moveTicket(projectId, ticket.id, newStatus.name);
        expect(moved.statusCategory).to.equal(oldCategory);
      }
    });
  });
});
