/* eslint-disable max-nested-callbacks */
import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  execInProcess,
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  createTestProject,
  createHQConfig,
  createPMODirectories,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * End-to-end tests for PMO Phase Commands
 * Tests: prlt phase list, create, update, delete, move
 */
describe('PMO Phase Commands E2E Tests', () => {
  let env: TestEnvironment;
  let db: Database.Database;
  const pmoPath = 'pmo'; // relative path for settings

  beforeEach(() => {
    env = createTestEnvironment('pmo-phase-e2e-');

    // Use production schema (includes default phases)
    db = setupProductionSchema(env.dbPath, pmoPath);

    // Create default project
    createTestProject(db, { id: 'default', name: 'Default Project' });

    // Create HQ config and PMO directories
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'default');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  describe('prlt phase list', () => {
    it('should list all phases', async () => {
      const output = await execInProcess('phase list');

      expect(output).to.contain('Idea');
      expect(output).to.contain('Planned');
      expect(output).to.contain('Active');
      expect(output).to.contain('Completed');
      expect(output).to.contain('Canceled');
    });

    it('should show phase categories', async () => {
      const output = await execInProcess('phase list');

      // In non-TTY (test) env, output is JSON with lowercase categories
      // In TTY (terminal), output is table with uppercase categories
      expect(output.toLowerCase()).to.contain('backlog');
      expect(output.toLowerCase()).to.contain('unstarted');
      expect(output.toLowerCase()).to.contain('started');
      expect(output.toLowerCase()).to.contain('completed');
      expect(output.toLowerCase()).to.contain('canceled');
    });

    it('should indicate default phase', async () => {
      const output = await execInProcess('phase list');

      // In JSON: "isDefault": true, in table: "(default)"
      expect(output.toLowerCase()).to.match(/isdefault.*true|default/);
    });

    it('should filter by category', async () => {
      const output = await execInProcess('phase list --category started');

      expect(output).to.contain('Active');
      expect(output).not.to.contain('Idea');
      expect(output).not.to.contain('Planned');
    });
  });

  describe('prlt phase create', () => {
    it('should create phase with name and category', async () => {
      // Name is a positional argument, not a flag
      const output = await execInProcess('phase create "On Hold" --category unstarted');

      expect(output).to.contain('Created phase');
      expect(output).to.contain('On Hold');

      const phase = db.prepare('SELECT * FROM pmo_phases WHERE name = ?').get('On Hold') as { id: string; category: string };
      expect(phase).to.not.be.undefined;
      expect(phase.category).to.equal('unstarted');
    });

    it('should create phase with description', async () => {
      await execInProcess('phase create "Review Phase" --category started --description "Projects under review"');

      const phase = db.prepare('SELECT description FROM pmo_phases WHERE name = ?').get('Review Phase') as { description: string };
      expect(phase).to.not.be.undefined;
      expect(phase.description).to.equal('Projects under review');
    });

    it('should create phase with color', async () => {
      await execInProcess('phase create "Colored Phase" --category started --color "#FF5733"');

      const phase = db.prepare('SELECT color FROM pmo_phases WHERE name = ?').get('Colored Phase') as { color: string };
      expect(phase).to.not.be.undefined;
      expect(phase.color).to.equal('#FF5733');
    });

    it('should set as default when --default flag used', async () => {
      await execInProcess('phase create "New Default" --category backlog --default');

      const phase = db.prepare('SELECT is_default FROM pmo_phases WHERE name = ?').get('New Default') as { is_default: number };
      expect(phase).to.not.be.undefined;
      expect(phase.is_default).to.equal(1);

      // Previous default should be unset
      const oldDefault = db.prepare('SELECT is_default FROM pmo_phases WHERE name = ?').get('Idea') as { is_default: number };
      expect(oldDefault.is_default).to.equal(0);
    });

    it('should error when phase name already exists', async () => {
      // "Active" already exists in seed data
      const output = await execInProcess('phase create "Active" --category started');

      expect(output.toLowerCase()).to.contain('already exists');
    });

    it('should slugify phase ID from name', async () => {
      await execInProcess('phase create "Phase With Spaces" --category started');

      const phase = db.prepare('SELECT id FROM pmo_phases WHERE name = ?').get('Phase With Spaces') as { id: string };
      expect(phase).to.not.be.undefined;
      expect(phase.id).to.equal('phase-with-spaces');
    });
  });

  describe('prlt phase update', () => {
    it('should update phase name', async () => {
      await execInProcess('phase update idea --name "New Idea"');

      const phase = db.prepare('SELECT name FROM pmo_phases WHERE id = ?').get('idea') as { name: string };
      expect(phase.name).to.equal('New Idea');
    });

    it('should update phase category', async () => {
      await execInProcess('phase update idea --category unstarted');

      const phase = db.prepare('SELECT category FROM pmo_phases WHERE id = ?').get('idea') as { category: string };
      expect(phase.category).to.equal('unstarted');
    });

    it('should update phase color', async () => {
      await execInProcess('phase update active --color "#00FF00"');

      const phase = db.prepare('SELECT color FROM pmo_phases WHERE id = ?').get('active') as { color: string };
      expect(phase.color).to.equal('#00FF00');
    });

    it('should update phase description', async () => {
      await execInProcess('phase update active --description "Updated description"');

      const phase = db.prepare('SELECT description FROM pmo_phases WHERE id = ?').get('active') as { description: string };
      expect(phase.description).to.equal('Updated description');
    });

    it('should set phase as default', async () => {
      await execInProcess('phase update planned --default');

      const planned = db.prepare('SELECT is_default FROM pmo_phases WHERE id = ?').get('planned') as { is_default: number };
      expect(planned.is_default).to.equal(1);

      // Old default should be unset
      const idea = db.prepare('SELECT is_default FROM pmo_phases WHERE id = ?').get('idea') as { is_default: number };
      expect(idea.is_default).to.equal(0);
    });

    it('should error when phase not found', async () => {
      const output = await execInProcess('phase update non-existent --name "New Name"');

      expect(output.toLowerCase()).to.contain('not found');
    });

    // Note: TKT-057 changed behavior - running `phase update <id>` without change flags
    // now auto-enters interactive mode instead of erroring. This cannot be tested in
    // non-interactive E2E tests. See test/unit/interactive-mode.test.ts for validation.
  });

  describe('prlt phase delete', () => {
    it('should delete phase', async () => {
      // Create a phase we can delete
      await execInProcess('phase create "Deletable" --category started');

      await execInProcess('phase delete deletable --force');

      const phase = db.prepare('SELECT * FROM pmo_phases WHERE id = ?').get('deletable');
      expect(phase).to.be.undefined;
    });

    it('should error when phase not found', async () => {
      const output = await execInProcess('phase delete non-existent --force');

      expect(output.toLowerCase()).to.contain('not found');
    });

    it('should error when projects are using the phase', async () => {
      // Create a project using the active phase
      db.prepare(`
        INSERT INTO pmo_projects (id, name, phase_id, is_archived)
        VALUES ('test-proj', 'Test Project', 'active', 0)
      `).run();

      const output = await execInProcess('phase delete active --force');

      expect(output.toLowerCase()).to.contain('using it');
    });

    it('should show success message', async () => {
      await execInProcess('phase create "To Delete" --category canceled');
      const output = await execInProcess('phase delete to-delete --force');

      expect(output).to.contain('Deleted phase');
      expect(output).to.contain('To Delete');
    });
  });

  describe('prlt phase move', () => {
    beforeEach(async () => {
      // Create multiple phases in the same category
      await execInProcess('phase create "Started A" --category started');
      await execInProcess('phase create "Started B" --category started');
      await execInProcess('phase create "Started C" --category started');
    });

    it('should change phase position', async () => {
      // Move Started C to position 0
      const output = await execInProcess('phase move started-c --position 0');

      expect(output).to.contain('Moved phase');
      expect(output).to.contain('Started C');
      // Output format varies: may say "to position 0" or "from position X to position Y"
      expect(output.toLowerCase()).to.contain('position');

      const phase = db.prepare('SELECT position FROM pmo_phases WHERE id = ?').get('started-c') as { position: number };
      expect(phase.position).to.equal(0);
    });

    it('should error when phase not found', async () => {
      const output = await execInProcess('phase move non-existent --position 0');

      expect(output.toLowerCase()).to.contain('not found');
    });
  });

  describe('JSON Mode Tests', () => {
    describe('prlt phase list --json', () => {
      it('should output phases as JSON array', async () => {
        const output = await execInProcess('phase list --json');
        const phases = JSON.parse(output);

        expect(phases).to.be.an('array');
        expect(phases.length).to.be.greaterThan(0);
        expect(phases[0]).to.have.property('id');
        expect(phases[0]).to.have.property('name');
        expect(phases[0]).to.have.property('category');
      });
    });

    describe('prlt phase create --json', () => {
      it('should output name input prompt as JSON when name is missing', async () => {
        const output = await execInProcess('phase create --json');
        const json = JSON.parse(output);

        expect(json).to.have.property('prompt');
        expect(json.prompt).to.have.property('type', 'input');
        expect(json.prompt).to.have.property('name', 'name');
        expect(json.prompt).to.have.property('message');
        expect(json).to.have.property('metadata');
        expect(json.metadata).to.have.property('command', 'phase create');
      });

      it('should output category list prompt as JSON when name is provided but category is missing', async () => {
        const output = await execInProcess('phase create "New Phase" --json');
        const json = JSON.parse(output);

        expect(json).to.have.property('prompt');
        expect(json.prompt).to.have.property('type', 'list');
        expect(json.prompt).to.have.property('name', 'category');
        expect(json.prompt).to.have.property('choices');
        expect(json.prompt.choices).to.be.an('array');
        expect(json.prompt.choices.length).to.be.greaterThan(0);
        // Each choice should have command field
        expect(json.prompt.choices[0]).to.have.property('command');
      });

      it('should create phase when all required flags are provided', async () => {
        const output = await execInProcess('phase create "JSON Created" --category started --json');

        // Command should complete successfully (no prompt output)
        expect(output).to.contain('Created phase');
        expect(output).to.contain('JSON Created');

        const phase = db.prepare('SELECT * FROM pmo_phases WHERE name = ?').get('JSON Created') as { id: string };
        expect(phase).to.not.be.undefined;
      });
    });

    describe('prlt phase delete --json', () => {
      beforeEach(async () => {
        await execInProcess('phase create "To Delete JSON" --category canceled');
      });

      it('should output confirmation prompt as JSON when --force is not used', async () => {
        const output = await execInProcess('phase delete to-delete-json --json');
        const json = JSON.parse(output);

        expect(json).to.have.property('prompt');
        expect(json.prompt).to.have.property('type', 'list');
        expect(json.prompt).to.have.property('name', 'confirmed');
        expect(json.prompt).to.have.property('choices');
        expect(json.prompt.choices).to.be.an('array');
        // Should have Yes/No options
        expect(json.prompt.choices.some((c: { name: string }) => c.name === 'Yes')).to.be.true;
        expect(json.prompt.choices.some((c: { name: string }) => c.name === 'No')).to.be.true;
      });

      it('should delete phase when --force is used with --json', async () => {
        const output = await execInProcess('phase delete to-delete-json --force --json');

        expect(output).to.contain('Deleted phase');

        const phase = db.prepare('SELECT * FROM pmo_phases WHERE id = ?').get('to-delete-json');
        expect(phase).to.be.undefined;
      });
    });

    describe('prlt phase update --json', () => {
      it('should output phase selection prompt as JSON when no id is provided', async () => {
        const output = await execInProcess('phase update --json');
        const json = JSON.parse(output);

        expect(json).to.have.property('prompt');
        expect(json.prompt).to.have.property('type', 'list');
        expect(json.prompt).to.have.property('name', 'phaseId');
        expect(json.prompt).to.have.property('choices');
        expect(json.prompt.choices).to.be.an('array');
      });

      it('should update phase when id and change flags are provided', async () => {
        const output = await execInProcess('phase update idea --name "Updated Idea" --json');

        expect(output).to.contain('Updated phase');
        expect(output).to.contain('Updated Idea');

        const phase = db.prepare('SELECT name FROM pmo_phases WHERE id = ?').get('idea') as { name: string };
        expect(phase.name).to.equal('Updated Idea');
      });
    });

    describe('prlt phase move --json', () => {
      beforeEach(async () => {
        await execInProcess('phase create "Move JSON A" --category started');
        await execInProcess('phase create "Move JSON B" --category started');
      });

      it('should output phase selection prompt as JSON when no id is provided', async () => {
        const output = await execInProcess('phase move --json');
        const json = JSON.parse(output);

        expect(json).to.have.property('prompt');
        expect(json.prompt).to.have.property('type', 'list');
        expect(json.prompt).to.have.property('name', 'phaseId');
        expect(json.prompt).to.have.property('choices');
      });

      it('should output position selection prompt as JSON when id is provided but position is not', async () => {
        const output = await execInProcess('phase move move-json-a --json');
        const json = JSON.parse(output);

        expect(json).to.have.property('prompt');
        expect(json.prompt).to.have.property('type', 'list');
        expect(json.prompt).to.have.property('name', 'position');
        expect(json.prompt).to.have.property('choices');
      });

      it('should move phase when id and position are provided', async () => {
        const output = await execInProcess('phase move move-json-b --position 0 --json');

        expect(output).to.contain('Moved phase');

        const phase = db.prepare('SELECT position FROM pmo_phases WHERE id = ?').get('move-json-b') as { position: number };
        expect(phase.position).to.equal(0);
      });
    });

    describe('Error handling in JSON mode', () => {
      it('should output error as JSON when phase not found in delete', async () => {
        const output = await execInProcess('phase delete non-existent --json');
        const json = JSON.parse(output);

        expect(json).to.have.property('error');
        expect(json.error).to.have.property('code', 'PHASE_NOT_FOUND');
        expect(json.error).to.have.property('message');
      });

      it('should output error as JSON when phase not found in move', async () => {
        const output = await execInProcess('phase move non-existent --position 0 --json');
        const json = JSON.parse(output);

        expect(json).to.have.property('error');
        expect(json.error).to.have.property('code', 'PHASE_NOT_FOUND');
        expect(json.error).to.have.property('message');
      });

      it('should output error as JSON when phase not found in update', async () => {
        const output = await execInProcess('phase update non-existent --name "New Name" --json');
        const json = JSON.parse(output);

        expect(json).to.have.property('error');
        expect(json.error).to.have.property('code', 'PHASE_NOT_FOUND');
        expect(json.error).to.have.property('message');
      });
    });
  });
});

// Helper functions

