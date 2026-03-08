import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  execInProcess,
  filterOutput,
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  createTestProject,
  createTestTicket,
  createHQConfig,
  createPMODirectories,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * End-to-end tests for PMO Roadmap Commands
 * Tests: prlt roadmap create, list, view, update, delete, add-project, remove-project, reorder, generate
 */
describe('PMO Roadmap Commands E2E Tests', () => {
  let env: TestEnvironment;
  let db: Database.Database;
  const pmoPath = 'pmo'; // relative path for settings

  beforeEach(() => {
    env = createTestEnvironment('pmo-roadmap-e2e-');

    // Use production schema
    db = setupProductionSchema(env.dbPath, pmoPath);

    // Create test project
    createTestProject(db, { id: 'test-project', name: 'Test Project' });

    // Create HQ config and PMO directories
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');

    // Create roadmaps directory for generate tests
    fs.mkdirSync(path.join(env.pmoPath, 'roadmaps'), { recursive: true });
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  describe('prlt roadmap create', () => {
    it('should create roadmap with name argument', async () => {
      const output = await execInProcess('roadmap create "Public Roadmap" --machine');

      // In machine mode, output is JSON
      const parsed = JSON.parse(filterOutput(output));
      expect(parsed).to.have.property('name', 'Public Roadmap');

      const roadmaps = db.prepare('SELECT * FROM pmo_roadmaps WHERE name = ?').all('Public Roadmap') as Array<{ id: string }>;
      expect(roadmaps).to.have.lengthOf(1);
    });

    it('should create roadmap with flags', async () => {
      await execInProcess('roadmap create --name "Internal Roadmap" --description "Internal planning" --machine');

      const roadmaps = db.prepare('SELECT * FROM pmo_roadmaps WHERE name = ?').all('Internal Roadmap') as Array<{ description: string }>;
      expect(roadmaps).to.have.lengthOf(1);
      expect(roadmaps[0].description).to.equal('Internal planning');
    });

    it('should auto-generate roadmap ID from name', async () => {
      await execInProcess('roadmap create "My Test Roadmap" --machine');

      const roadmaps = db.prepare('SELECT id FROM pmo_roadmaps WHERE name = ?').all('My Test Roadmap') as Array<{ id: string }>;
      expect(roadmaps).to.have.lengthOf(1);
      expect(roadmaps[0].id).to.equal('roadmap-my-test-roadmap');
    });

    it('should create roadmap with custom ID', async () => {
      await execInProcess('roadmap create --name "Custom" --id my-custom-id --machine');

      const roadmaps = db.prepare('SELECT id FROM pmo_roadmaps WHERE id = ?').all('my-custom-id') as Array<{ id: string }>;
      expect(roadmaps).to.have.lengthOf(1);
    });

    describe('JSON mode (TKT-792)', () => {
      it('should return JSON without interactive prompts when using --json flag', async () => {
        const output = await execInProcess('roadmap create --json --name "Q1 Roadmap"');

        // Output should be valid JSON
        const parsed = JSON.parse(filterOutput(output));

        // Should contain roadmap data
        expect(parsed).to.have.property('id');
        expect(parsed).to.have.property('name', 'Q1 Roadmap');

        // Roadmap should be created in database
        const roadmaps = db.prepare('SELECT * FROM pmo_roadmaps WHERE name = ?').all('Q1 Roadmap') as Array<{ id: string }>;
        expect(roadmaps).to.have.lengthOf(1);
      });

      it('should return roadmap data with all fields in JSON mode', async () => {
        const output = await execInProcess('roadmap create --json --name "Full Roadmap" --description "Test desc" --id full-roadmap --default');

        const parsed = JSON.parse(filterOutput(output));

        expect(parsed.id).to.equal('full-roadmap');
        expect(parsed.name).to.equal('Full Roadmap');
        expect(parsed.description).to.equal('Test desc');
        expect(parsed.isDefault).to.equal(true);
      });

      it('should skip follow-up prompt even when projects exist', async () => {
        // The test project already exists in beforeEach
        // In JSON mode, it should NOT prompt to add projects
        const output = await execInProcess('roadmap create --json --name "Skip Prompt Test"');

        // Should be valid JSON (not error about interactive prompt)
        const parsed = JSON.parse(filterOutput(output));
        expect(parsed).to.have.property('name', 'Skip Prompt Test');

        // Should NOT contain any interactive prompt text
        expect(output).to.not.contain('Add projects');
        expect(output).to.not.contain('Select projects');
      });
    });
  });

  describe('prlt roadmap list', () => {
    it('should list all roadmaps', async () => {
      // Create roadmaps via CLI
      await execInProcess('roadmap create "Roadmap 1" --machine');
      await execInProcess('roadmap create "Roadmap 2" --machine');

      const output = await execInProcess('roadmap list');

      expect(filterOutput(output)).to.contain('Roadmap 1');
      expect(filterOutput(output)).to.contain('Roadmap 2');
    });
  });

  describe('prlt roadmap view', () => {
    it('should show roadmap details', async () => {
      await execInProcess('roadmap create --name "Test Roadmap" --description "A test roadmap" --id test-roadmap --machine');

      const output = await execInProcess('roadmap view test-roadmap');

      expect(filterOutput(output)).to.contain('Test Roadmap');
    });
  });

  describe('prlt roadmap update', () => {
    it('should update roadmap name', async () => {
      await execInProcess('roadmap create --name "Original Name" --id update-test --machine');

      await execInProcess('roadmap update update-test --name "Updated Name"');

      const roadmap = db.prepare('SELECT name FROM pmo_roadmaps WHERE id = ?').get('update-test') as { name: string };
      expect(roadmap.name).to.equal('Updated Name');
    });

    it('should update roadmap description', async () => {
      await execInProcess('roadmap create --name "Test" --id update-test --machine');

      await execInProcess('roadmap update update-test --description "Updated description"');

      const roadmap = db.prepare('SELECT description FROM pmo_roadmaps WHERE id = ?').get('update-test') as { description: string };
      expect(roadmap.description).to.equal('Updated description');
    });
  });

  describe('prlt roadmap delete', () => {
    it('should delete roadmap with force flag', async () => {
      await execInProcess('roadmap create --name "To Delete" --id to-delete --machine');

      await execInProcess('roadmap delete to-delete --force');

      const roadmap = db.prepare('SELECT * FROM pmo_roadmaps WHERE id = ?').get('to-delete');
      expect(roadmap).to.be.undefined;
    });
  });

  describe('prlt roadmap add-project', () => {
    it('should add project to roadmap', async () => {
      await execInProcess('roadmap create --name "Roadmap" --id roadmap --machine');

      await execInProcess('roadmap add-project roadmap test-project');

      const associations = db.prepare('SELECT * FROM pmo_roadmap_projects WHERE roadmap_id = ? AND project_id = ?').all('roadmap', 'test-project');
      expect(associations).to.have.lengthOf(1);
    });
  });

  describe('prlt roadmap remove-project', () => {
    it('should remove project from roadmap', async () => {
      await execInProcess('roadmap create --name "Roadmap" --id roadmap --machine');
      await execInProcess('roadmap add-project roadmap test-project');

      await execInProcess('roadmap remove-project roadmap test-project --force');

      const associations = db.prepare('SELECT * FROM pmo_roadmap_projects WHERE roadmap_id = ? AND project_id = ?').all('roadmap', 'test-project');
      expect(associations).to.have.lengthOf(0);
    });

    it('should not delete the project itself', async () => {
      await execInProcess('roadmap create --name "Roadmap" --id roadmap --machine');
      await execInProcess('roadmap add-project roadmap test-project');

      await execInProcess('roadmap remove-project roadmap test-project --force');

      const project = db.prepare('SELECT * FROM pmo_projects WHERE id = ?').get('test-project');
      expect(project).to.not.be.undefined;
    });
  });

  describe('prlt roadmap reorder', () => {
    beforeEach(() => {
      // Create additional projects
      createTestProject(db, { id: 'project-2', name: 'Project 2' });
      createTestProject(db, { id: 'project-3', name: 'Project 3' });
    });

    it('should reorder project to new position', async () => {
      await execInProcess('roadmap create --name "Roadmap" --id roadmap --machine');
      await execInProcess('roadmap add-project roadmap test-project');
      await execInProcess('roadmap add-project roadmap project-2');
      await execInProcess('roadmap add-project roadmap project-3');

      await execInProcess('roadmap reorder roadmap --project project-3 --position 0');

      const projects = db.prepare('SELECT project_id FROM pmo_roadmap_projects WHERE roadmap_id = ? ORDER BY position').all('roadmap') as Array<{ project_id: string }>;
      expect(projects[0].project_id).to.equal('project-3');
    });
  });

  describe('prlt roadmap generate', () => {
    it('should generate markdown file', async () => {
      await execInProcess('roadmap create --name "Generated Roadmap" --description "Test generation" --id gen-test --machine');
      await execInProcess('roadmap add-project gen-test test-project');
      // Add a ticket for the project (uses production status_id format)
      createTestTicket(db, 'test-project', { id: 'TKT-001', title: 'Test Ticket', priority: 'P0' });

      const output = await execInProcess('roadmap generate gen-test');

      expect(filterOutput(output)).to.contain('Generated');

      const mdPath = path.join(env.testDir, 'pmo', 'roadmaps', 'generated-roadmap.md');
      expect(fs.existsSync(mdPath)).to.be.true;
    });

    it('should generate all roadmaps with --all flag', async () => {
      await execInProcess('roadmap create --name "Roadmap One" --id r1 --machine');
      await execInProcess('roadmap create --name "Roadmap Two" --id r2 --machine');

      const output = await execInProcess('roadmap generate --all');

      expect(filterOutput(output)).to.contain('Generated 2 roadmap');
    });
  });
});
