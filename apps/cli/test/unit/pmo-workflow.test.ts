import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../src/lib/pmo/types.js';

describe('PMO Workflow Status and Templates', () => {
  let testDir: string;
  let storage: SQLiteStorage;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-workflow-test-'));
    const dbPath = path.join(testDir, 'pmo.db');

    // Create empty database file first
    const db = new Database(dbPath);
    db.close();

    storage = new SQLiteStorage(dbPath);

    // Initialize board with default project
    await storage.init({
      name: 'Test Board',
      columns: ['Backlog', 'In Progress', 'Done'],
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
      const projectId = 'default';

      // Apply kanban template
      const statuses = await storage.applyTemplate(projectId, 'kanban');

      expect(statuses.length).to.be.greaterThan(0);

      // Verify statuses were created
      const projectStatuses = await storage.listStatuses(projectId);
      expect(projectStatuses.length).to.equal(statuses.length);

      // Check that statuses span multiple categories
      const categories = new Set(projectStatuses.map(s => s.category));
      expect(categories.size).to.be.greaterThan(1);
    });

    it('replaces existing statuses when applying template', async () => {
      const projectId = 'default';

      // Apply kanban template first
      await storage.applyTemplate(projectId, 'kanban');
      const kanbanStatuses = await storage.listStatuses(projectId);

      // Apply linear template (should replace)
      await storage.applyTemplate(projectId, 'linear');
      const linearStatuses = await storage.listStatuses(projectId);

      // Should have different number of statuses
      expect(linearStatuses.length).to.not.equal(kanbanStatuses.length);
    });

    it('sets first backlog status as default', async () => {
      const projectId = 'default';

      await storage.applyTemplate(projectId, 'kanban');

      const defaultStatus = await storage.getDefaultStatus(projectId);
      expect(defaultStatus).to.not.be.null;
      expect(defaultStatus!.category).to.equal('backlog');
      expect(defaultStatus!.isDefault).to.be.true;
    });
  });

  describe('Status CRUD Operations', () => {
    beforeEach(async () => {
      // Apply template to have statuses to work with
      await storage.applyTemplate('default', 'kanban');
    });

    it('creates a new status', async () => {
      const status = await storage.createStatus({
        projectId: 'default',
        name: 'In Review',
        category: 'started',
      });

      expect(status.name).to.equal('In Review');
      expect(status.category).to.equal('started');
      expect(status.projectId).to.equal('default');
    });

    it('prevents duplicate status names in same project', async () => {
      await storage.createStatus({
        projectId: 'default',
        name: 'Review',
        category: 'started',
      });

      try {
        await storage.createStatus({
          projectId: 'default',
          name: 'Review',
          category: 'started',
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('already exists');
      }
    });

    it('updates a status', async () => {
      const status = await storage.createStatus({
        projectId: 'default',
        name: 'Review',
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
      const status = await storage.createStatus({
        projectId: 'default',
        name: 'Temporary',
        category: 'started',
      });

      await storage.deleteStatus(status.id);

      const deleted = await storage.getStatus(status.id);
      expect(deleted).to.be.null;
    });

    it('reorders statuses within category', async () => {
      const status1 = await storage.createStatus({
        projectId: 'default',
        name: 'Status A',
        category: 'started',
      });

      const status2 = await storage.createStatus({
        projectId: 'default',
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
      await storage.applyTemplate('default', 'linear');

      const statuses = await storage.listStatuses('default');

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
          expect(status.position).to.be.greaterThan(lastPosition);
          lastPosition = status.position;
        } else {
          expect.fail('Statuses not ordered by category');
        }
      }
    });

    it('validates category values', async () => {
      try {
        await storage.createStatus({
          projectId: 'default',
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
    beforeEach(async () => {
      await storage.applyTemplate('default', 'kanban');
    });

    it('saves project statuses as a new template', async () => {
      // Add a custom status
      await storage.createStatus({
        projectId: 'default',
        name: 'Custom Status',
        category: 'started',
      });

      // Save as template
      const template = await storage.saveTemplate('My Template', 'default', 'A custom workflow');

      expect(template.name).to.equal('My Template');
      expect(template.isBuiltin).to.be.false;
      expect(template.statuses.length).to.be.greaterThan(0);
    });

    it('prevents duplicate template names', async () => {
      await storage.saveTemplate('Custom', 'default');

      try {
        await storage.saveTemplate('Custom', 'default');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('already exists');
      }
    });

    it('allows deletion of custom templates', async () => {
      const template = await storage.saveTemplate('Deletable', 'default');

      await storage.deleteTemplate(template.id);

      const deleted = await storage.getTemplate(template.id);
      expect(deleted).to.be.null;
    });
  });

  describe('Project Creation with Templates', () => {
    it('applies workflow template when creating project', async () => {
      const project = await storage.createProject({
        id: 'new-project',
        name: 'New Project',
        template: 'linear',
      });

      // Check that statuses were created
      const statuses = await storage.listStatuses('new-project');
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

      // Should have default columns
      expect(project.columns.length).to.be.greaterThan(0);
      expect(project.columns[0].name).to.equal('Backlog');
    });
  });

  describe('Ticket Status Integration', () => {
    beforeEach(async () => {
      await storage.applyTemplate('default', 'kanban');
    });

    it('updates status_id when moving ticket to matching column', async () => {
      // Create a ticket
      const ticket = await storage.createTicket({
        title: 'Test Ticket',
        column: 'Backlog',
      });

      // Move ticket to "Done" column (which matches "Done" status)
      const moved = await storage.moveTicket(ticket.id, 'Done');

      // The ticket should now have a status_id set
      expect(moved.statusId).to.not.be.undefined;

      // Verify the status matches the column
      const status = await storage.getStatus(moved.statusId!);
      expect(status).to.not.be.null;
      expect(status!.name).to.equal('Done');
    });
  });
});
