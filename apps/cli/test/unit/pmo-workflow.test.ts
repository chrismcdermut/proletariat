import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../src/lib/pmo/types.js';

describe('PMO Workflow Status and Templates', () => {
  let testDir: string;
  let storage: SQLiteStorage;
  const projectId = 'default';
  // When a project uses template 'kanban', it uses workflow 'kanban'
  const workflowId = 'kanban';

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-workflow-test-'));
    const dbPath = path.join(testDir, 'pmo.db');

    // Create empty database file first
    const db = new Database(dbPath);
    db.close();

    storage = new SQLiteStorage(dbPath);

    // Create a project with kanban template
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

  describe('Built-in Templates', () => {
    it('seeds built-in templates on database creation', async () => {
      const templates = await storage.listTemplates();

      expect(templates.length).to.be.greaterThanOrEqual(5);

      const kanban = templates.find(t => t.id === 'kanban');
      expect(kanban).to.not.be.undefined;
      expect(kanban!.isBuiltin).to.be.true;
      expect(kanban!.statuses.length).to.be.greaterThan(0);

      const linear = templates.find(t => t.id === 'linear');
      expect(linear).to.not.be.undefined;
      expect(linear!.isBuiltin).to.be.true;
    });

    it('prevents deletion of built-in templates', async () => {
      try {
        await storage.deleteTemplate('kanban');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('Cannot delete built-in');
      }
    });

    it('lists templates with filter', async () => {
      const builtinTemplates = await storage.listTemplates({ isBuiltin: true });
      expect(builtinTemplates.length).to.be.greaterThanOrEqual(5);
      expect(builtinTemplates.every(t => t.isBuiltin)).to.be.true;

      const customTemplates = await storage.listTemplates({ isBuiltin: false });
      expect(customTemplates.every(t => !t.isBuiltin)).to.be.true;
    });
  });

  describe('Template Application', () => {
    it('applies template to create statuses for a project', async () => {
      // Create a new project and apply linear template
      await storage.createProject({
        id: 'template-test',
        name: 'Template Test',
        template: 'linear',
      });

      // Verify statuses were created (linear workflow)
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

      // Verify ordering: backlog < unstarted < started < completed < canceled
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

  describe('Saving Custom Templates', () => {
    it('saves project statuses as a new template', async () => {
      // Add a custom status
      await storage.createStatus(workflowId, {
        name: 'Custom Status',
        category: 'started',
      });

      // Save as template
      const template = await storage.saveTemplate('My Template', projectId, 'A custom workflow');

      expect(template.name).to.equal('My Template');
      expect(template.isBuiltin).to.be.false;
      expect(template.statuses.length).to.be.greaterThan(0);
    });

    it('prevents duplicate template names', async () => {
      await storage.saveTemplate('Custom', projectId);

      try {
        await storage.saveTemplate('Custom', projectId);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('already exists');
      }
    });

    it('allows deletion of custom templates', async () => {
      const template = await storage.saveTemplate('Deletable', projectId);

      await storage.deleteTemplate(template.id);

      const deleted = await storage.getTemplate(template.id);
      expect(deleted).to.be.null;
    });
  });

  describe('Project Creation with Templates', () => {
    it('applies workflow template when creating project', async () => {
      await storage.createProject({
        id: 'new-project',
        name: 'New Project',
        template: 'linear',
      });

      // Check that statuses were created (uses linear workflow)
      const statuses = await storage.listStatuses('linear');
      expect(statuses.length).to.be.greaterThan(0);

      // Linear template has specific statuses
      const statusNames = statuses.map(s => s.name);
      expect(statusNames).to.include('Backlog');
      expect(statusNames).to.include('Todo');
      expect(statusNames).to.include('In Progress');
    });

    it('falls back to default columns when template not found', async () => {
      const project = await storage.createProject({
        id: 'fallback-project',
        name: 'Fallback Project',
        template: 'nonexistent-template',
      });

      // Should have default columns (uses default workflow)
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
});
