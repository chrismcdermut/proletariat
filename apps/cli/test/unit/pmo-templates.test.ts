import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { getBoardTemplates, getColumnsForTemplate, createBoardContent } from '../../src/lib/pmo/index.js';
import { BUILTIN_TEMPLATES, getBuiltinTemplate, getColumnSettingsForTemplate } from '../../src/lib/pmo/templates-builtin.js';
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js';

describe('PMO Board Templates', () => {
  describe('BUILTIN_TEMPLATES - Single Source of Truth', () => {
    it('contains all expected templates', () => {
      const templateIds = BUILTIN_TEMPLATES.map(t => t.id);

      expect(templateIds).to.include('default');
      expect(templateIds).to.include('kanban');
      expect(templateIds).to.include('linear');
      expect(templateIds).to.include('5-tool-founder');
      expect(templateIds).to.include('bug-smash');
      expect(templateIds).to.include('gtm');
    });

    it('each template has required properties', () => {
      for (const template of BUILTIN_TEMPLATES) {
        expect(template.id).to.be.a('string').and.not.empty;
        expect(template.name).to.be.a('string').and.not.empty;
        expect(template.description).to.be.a('string').and.not.empty;
        expect(template.columns).to.be.an('array').with.length.greaterThan(0);
        expect(template.statuses).to.be.an('array').with.length.greaterThan(0);
        expect(template.columnSettings).to.have.property('column_planned');
        expect(template.columnSettings).to.have.property('column_in_progress');
        expect(template.columnSettings).to.have.property('column_done');
        expect(template.showInPicker).to.be.a('boolean');
      }
    });

    it('statuses have valid categories', () => {
      const validCategories = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];

      for (const template of BUILTIN_TEMPLATES) {
        for (const status of template.statuses) {
          expect(validCategories).to.include(status.category,
            `Template ${template.id} status ${status.name} has invalid category ${status.category}`);
        }
      }
    });

    it('column settings reference valid columns', () => {
      for (const template of BUILTIN_TEMPLATES) {
        const columnNames = template.columns;
        const settings = template.columnSettings;

        // column_done should be in columns
        expect(columnNames).to.include(settings.column_done,
          `Template ${template.id} column_done "${settings.column_done}" not in columns`);
        // column_in_progress should be in columns
        expect(columnNames).to.include(settings.column_in_progress,
          `Template ${template.id} column_in_progress "${settings.column_in_progress}" not in columns`);
      }
    });
  });

  describe('DRY - Database seeding uses BUILTIN_TEMPLATES', () => {
    let testDir: string;
    let storage: SQLiteStorage;

    beforeEach(async () => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-template-dry-test-'));
      const dbPath = path.join(testDir, 'pmo.db');

      const db = new Database(dbPath);
      db.close();

      storage = new SQLiteStorage(dbPath);
    });

    afterEach(async () => {
      await storage.close();
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('seeds all BUILTIN_TEMPLATES as workflows', async () => {
      const workflows = await storage.listWorkflows({ isBuiltin: true });
      const workflowIds = workflows.map(w => w.id);

      for (const template of BUILTIN_TEMPLATES) {
        expect(workflowIds).to.include(template.id,
          `Template ${template.id} not seeded as workflow`);
      }
    });

    it('seeded workflow statuses match BUILTIN_TEMPLATES', async () => {
      await Promise.all(BUILTIN_TEMPLATES.map(async (template) => {
        const dbStatuses = await storage.listStatuses(template.id);
        // eslint-disable-next-line max-nested-callbacks
        const templateStatusNames = template.statuses.map(s => s.name);
        // eslint-disable-next-line max-nested-callbacks
        const dbStatusNames = dbStatuses.map(s => s.name);

        expect(dbStatusNames).to.have.members(templateStatusNames,
          `Workflow ${template.id} statuses don't match BUILTIN_TEMPLATES`);
      }));
    });

    it('seeded workflow status categories match BUILTIN_TEMPLATES', async () => {
      await Promise.all(BUILTIN_TEMPLATES.map(async (template) => {
        const dbStatuses = await storage.listStatuses(template.id);

        for (const templateStatus of template.statuses) {
          // eslint-disable-next-line max-nested-callbacks
          const dbStatus = dbStatuses.find(s => s.name === templateStatus.name);
          expect(dbStatus).to.not.be.undefined;
          expect(dbStatus!.category).to.equal(templateStatus.category,
            `Status ${templateStatus.name} in ${template.id} has wrong category`);
        }
      }));
    });
  });

  describe('getBoardTemplates', () => {
    it('returns all available templates from BUILTIN_TEMPLATES', () => {
      const templates = getBoardTemplates();

      expect(templates).to.have.property('kanban');
      expect(templates).to.have.property('linear');
      expect(templates).to.have.property('5-tool-founder');
      expect(templates).to.have.property('custom');
    });

    it('kanban template columns match BUILTIN_TEMPLATES', () => {
      const templates = getBoardTemplates();
      const builtin = getBuiltinTemplate('kanban');

      expect(templates.kanban).to.deep.equal(builtin!.columns);
    });

    it('custom template is empty', () => {
      const templates = getBoardTemplates();

      expect(templates.custom).to.deep.equal([]);
    });
  });

  describe('getColumnsForTemplate', () => {
    it('returns columns from BUILTIN_TEMPLATES for known template', () => {
      const columns = getColumnsForTemplate('linear');
      const builtin = getBuiltinTemplate('linear');

      expect(columns).to.deep.equal(builtin!.columns);
    });

    it('returns default columns for unknown template', () => {
      const columns = getColumnsForTemplate('unknown-template');

      expect(columns).to.deep.equal(['Backlog', 'Planned', 'In Progress', 'Done']);
    });

    it('returns 5-tool-founder columns', () => {
      const columns = getColumnsForTemplate('5-tool-founder');
      const builtin = getBuiltinTemplate('5-tool-founder');

      expect(columns).to.deep.equal(builtin!.columns);
      expect(columns).to.include('Ship');
      expect(columns).to.include('In Progress');
      expect(columns).to.include('Done');
    });
  });

  describe('getColumnSettingsForTemplate', () => {
    it('returns settings from BUILTIN_TEMPLATES for known template', () => {
      const settings = getColumnSettingsForTemplate('kanban', []);
      const builtin = getBuiltinTemplate('kanban');

      expect(settings).to.deep.equal(builtin!.columnSettings);
    });

    it('infers settings for unknown template', () => {
      const columns = ['Backlog', 'Ready', 'In Progress', 'Complete'];
      const settings = getColumnSettingsForTemplate('custom', columns);

      expect(settings.column_in_progress).to.equal('In Progress');
      expect(settings.column_done).to.equal('Complete');
    });
  });

  describe('createBoardContent', () => {
    it('creates Obsidian Kanban frontmatter', () => {
      const content = createBoardContent('kanban');

      expect(content).to.include('---');
      expect(content).to.include('kanban-plugin: obsidian-kanban');
    });

    it('creates column headers for all template columns', () => {
      for (const template of BUILTIN_TEMPLATES) {
        const content = createBoardContent(template.id);

        for (const column of template.columns) {
          expect(content).to.include(column,
            `Template ${template.id} board missing column ${column}`);
        }
      }
    });

    it('creates board with optional name', () => {
      const content = createBoardContent('kanban', 'My Board');

      expect(content).to.include('# My Board');
    });
  });

  describe('Template consistency', () => {
    it('picker templates have showInPicker=true', () => {
      const pickerTemplates = BUILTIN_TEMPLATES.filter(t => t.showInPicker);

      expect(pickerTemplates.length).to.be.greaterThan(0);
      expect(pickerTemplates.map(t => t.id)).to.include('kanban');
      expect(pickerTemplates.map(t => t.id)).to.include('linear');
      expect(pickerTemplates.map(t => t.id)).to.include('5-tool-founder');
    });

    it('default template is not shown in picker', () => {
      const defaultTemplate = getBuiltinTemplate('default');

      expect(defaultTemplate).to.not.be.undefined;
      expect(defaultTemplate!.showInPicker).to.be.false;
    });

    it('each template has at least one status per required category', () => {
      const requiredCategories = ['backlog', 'started', 'completed'] as const;

      for (const template of BUILTIN_TEMPLATES) {
        const categories = template.statuses.map(s => s.category);

        for (const required of requiredCategories) {
          expect(categories).to.include(required,
            `Template ${template.id} missing ${required} category`);
        }
      }
    });
  });
});
