/* eslint-disable max-nested-callbacks */
/**
 * E2E tests for project commands - JSON mode and agent flow
 *
 * Tests that AI agents can navigate through project commands using JSON output.
 * Follows the same pattern as phase-json-mode.test.ts.
 *
 * Coverage:
 * - project list (--machine, --json, -m, --archived)
 * - project view (with ID, without ID prompt, board data)
 * - project create (form prompt, direct create)
 * - project delete (selection, confirmation, --force)
 * - project archive (confirmation, --force, already archived)
 * - project unarchive (success, error, already unarchived)
 * - project spec (selection, spec info, commands)
 * - project index menu (choices with commands)
 * - End-to-end multi-step agent flows
 * - Backward compatibility (--json vs --machine)
 * - Error handling
 */

import { expect } from 'chai';
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  createTestProject,
  execInProcess,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * Extract JSON from CLI output that may contain warnings.
 * Looks for the first line starting with { or [ and parses from there.
 * Throws on failure (unlike the null-returning version in test-helpers).
 */
function extractJson<T>(output: string): T {
  const lines = output.split('\n');
  let jsonStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      jsonStart = i;
      break;
    }
  }

  if (jsonStart === -1) {
    throw new Error(`No JSON found in output: ${output.substring(0, 500)}...`);
  }

  const jsonLines = lines.slice(jsonStart).join('\n');
  return JSON.parse(jsonLines) as T;
}

/**
 * Integration tests for project command JSON mode.
 *
 * These tests verify that:
 * 1. Project commands support --machine flag (and legacy --json)
 * 2. JSON output includes proper prompt schema with command fields
 * 3. Success responses use { success: true, result: {...} } wrapper
 * 4. Error responses use { error: { code, message } } structure
 * 5. Multi-step agent flows work end-to-end
 */
describe('Project Commands JSON Mode', () => {
  let env: TestEnvironment;
  let db: SqliteDatabase;

  beforeEach(() => {
    env = createTestEnvironment('project-json-');
    db = setupProductionSchema(env.dbPath, env.pmoPath);
    createTestProject(db, { id: 'test-project', name: 'Test Project' });
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  // ===========================================================================
  // project list --machine
  // ===========================================================================
  describe('project list --machine', () => {
    it('should output valid JSON with --machine flag', async () => {
      const output = await execInProcess('project list --machine');
      const json = extractJson<{
        success: boolean;
        result: { projects: Array<{ id: string; name: string }> };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.projects).to.be.an('array');
      expect(json.result.projects.length).to.be.greaterThan(0);

      const testProject = json.result.projects.find(p => p.id === 'test-project');
      expect(testProject).to.exist;
      expect(testProject!.name).to.equal('Test Project');
    });

    it('should output valid JSON with --json flag (legacy)', async () => {
      const output = await execInProcess('project list --json');
      const json = extractJson<{
        success: boolean;
        result: { projects: Array<{ id: string }> };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.projects).to.be.an('array');
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('project list -m --machine');
      const json = extractJson<{
        success: boolean;
        result: { projects: Array<{ id: string }> };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.projects).to.be.an('array');
    });

    it('should produce same structure with --machine and --json', async () => {
      const jsonOutput = await execInProcess('project list --json');
      const machineOutput = await execInProcess('project list --machine');

      const jsonResult = extractJson<{ result: { projects: Array<{ id: string }> } }>(jsonOutput);
      const machineResult = extractJson<{ result: { projects: Array<{ id: string }> } }>(machineOutput);

      expect(machineResult.result.projects.length).to.equal(jsonResult.result.projects.length);
    });

    it('should include project metadata fields', async () => {
      const output = await execInProcess('project list --machine');
      const json = extractJson<{
        result: { projects: Array<{ id: string; name: string; ticketCount: number; isArchived: boolean }> };
      }>(output);

      const project = json.result.projects.find(p => p.id === 'test-project');
      expect(project).to.exist;
      expect(project!).to.have.property('ticketCount');
      expect(project!).to.have.property('isArchived');
    });

    it('should filter archived projects with --archived flag', async () => {
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id, is_archived)
        VALUES ('archived-proj', 'Archived Project', 'Archived', 'default', 1)
      `).run();

      const output = await execInProcess('project list --archived --machine');
      const json = extractJson<{
        result: { projects: Array<{ id: string; isArchived: boolean }> };
      }>(output);

      expect(json.result.projects.length).to.be.greaterThan(0);
      for (const project of json.result.projects) {
        expect(project.isArchived).to.equal(true);
      }
    });
  });

  // ===========================================================================
  // project view --machine
  // ===========================================================================
  describe('project view --machine', () => {
    it('should return board data when project ID is provided', async () => {
      const output = await execInProcess('project view test-project --machine');
      const json = extractJson<{
        success: boolean;
        result: { id: string; name: string; columns: unknown[] };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.id).to.equal('test-project');
      expect(json.result.name).to.equal('Test Project');
      expect(json.result.columns).to.be.an('array');
    });

    it('should return project selection prompt when no ID provided', async () => {
      // Create another project for selection
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('second-project', 'Second Project', 'Another project', 'default')
      `).run();

      const output = await execInProcess('project view --machine');
      const json = extractJson<{
        prompt: { type: string; choices: Array<{ name: string; command: string }> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('project view');
        expect(choice.command).to.include('--json');
      }
    });

    it('should include metadata with command name', async () => {
      const output = await execInProcess('project view test-project --machine');
      const json = extractJson<{
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.metadata.command).to.equal('project view');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('project view test-project -m --machine');
      const json = extractJson<{
        success: boolean;
        result: { id: string };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.id).to.equal('test-project');
    });
  });

  // ===========================================================================
  // project create --machine
  // ===========================================================================
  describe('project create --machine', () => {
    it('should output form prompt when no name provided', async () => {
      const output = await execInProcess('project create --machine');
      const json = extractJson<{
        prompt: { type: string; fields: Array<{ name: string; type: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('form');
      expect(json.prompt.fields).to.be.an('array');
      expect(json.metadata.command).to.equal('project create');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include template choices in form fields', async () => {
      const output = await execInProcess('project create --machine');
      const json = extractJson<{
        prompt: { fields: Array<{ name: string; choices?: Array<{ name: string; value: string }> }> };
      }>(output);

      const templateField = json.prompt.fields.find(f => f.name === 'template');
      expect(templateField).to.exist;
      expect(templateField!.choices).to.be.an('array');
      expect(templateField!.choices!.length).to.be.greaterThan(0);
    });

    it('should create project when name is provided directly', async () => {
      const output = await execInProcess('project create --name "Machine Created" --machine');
      const json = extractJson<{
        success: boolean;
        result: { id: string; name: string; template: string };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.name).to.equal('Machine Created');
      expect(json.result.template).to.equal('kanban');

      // Verify in database
      const project = db.prepare(
        'SELECT id, name FROM pmo_projects WHERE name = ?'
      ).get('Machine Created') as { id: string; name: string } | undefined;
      expect(project).to.exist;
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('project create -m --machine');
      const json = extractJson<{
        prompt: { type: string };
        metadata: { flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should work with positional arg name', async () => {
      const output = await execInProcess('project create "Positional Name" --machine');
      const json = extractJson<{
        success: boolean;
        result: { name: string };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.name).to.equal('Positional Name');
    });
  });

  // ===========================================================================
  // project delete --machine
  // ===========================================================================
  describe('project delete --machine', () => {
    beforeEach(() => {
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('delete-me', 'Delete Me Project', 'Project to delete', 'default')
      `).run();
    });

    it('should output project selection prompt when no ID provided', async () => {
      const output = await execInProcess('project delete --machine');
      const json = extractJson<{
        prompt: {
          type: string;
          name: string;
          choices: Array<{ name: string; value: string; command: string }>;
        };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('selectedProjectId');
      expect(json.metadata.flags.machine).to.equal(true);

      const deleteChoice = json.prompt.choices.find(c => c.name.includes('Delete Me'));
      expect(deleteChoice).to.exist;
      expect(deleteChoice!.command).to.include('project delete');
      expect(deleteChoice!.command).to.include('delete-me');
      expect(deleteChoice!.command).to.include('--json');
    });

    it('should output confirmation prompt when ID is provided', async () => {
      const output = await execInProcess('project delete delete-me --machine');
      const json = extractJson<{
        prompt: {
          type: string;
          name: string;
          message: string;
          choices: Array<{ name: string; value: string; command: string }>;
        };
      }>(output);

      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('confirm');
      expect(json.prompt.message).to.include('Delete Me');

      // Yes choice should have --force in command
      const yesChoice = json.prompt.choices.find(c => c.value === 'true');
      expect(yesChoice).to.exist;
      expect(yesChoice!.command).to.include('--force');
      expect(yesChoice!.command).to.include('--json');
    });

    it('should delete project when --force provided', async () => {
      const output = await execInProcess('project delete delete-me --force --machine');
      const json = extractJson<{
        success: boolean;
        result: { deleted: boolean; projectId: string; ticketsRemoved: number };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.deleted).to.equal(true);
      expect(json.result.projectId).to.equal('delete-me');

      // Verify in database
      const project = db.prepare('SELECT id FROM pmo_projects WHERE id = ?').get('delete-me');
      expect(project).to.be.undefined;
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('project delete delete-me -m --machine');
      const json = extractJson<{
        prompt: { type: string };
        metadata: { flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should not include default project in selection', async () => {
      // Add a default project
      db.prepare(`
        INSERT OR IGNORE INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('default', 'Default Project', 'Cannot delete', 'default')
      `).run();

      const output = await execInProcess('project delete --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ value: string }> };
      }>(output);

      const defaultChoice = json.prompt.choices.find(c => c.value === 'default');
      expect(defaultChoice).to.be.undefined;
    });
  });

  // ===========================================================================
  // project archive --machine
  // ===========================================================================
  describe('project archive --machine', () => {
    beforeEach(() => {
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('archive-me', 'Archive Me Project', 'Project to archive', 'default')
      `).run();
    });

    it('should output confirmation prompt', async () => {
      const output = await execInProcess('project archive archive-me --machine');
      const json = extractJson<{
        prompt: {
          type: string;
          name: string;
          message: string;
          choices: Array<{ name: string; value: string; command: string }>;
        };
        metadata: { command: string };
      }>(output);

      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('confirm');
      expect(json.prompt.message).to.include('Archive');
      expect(json.metadata.command).to.equal('project archive');

      const yesChoice = json.prompt.choices.find(c => c.value === 'true');
      expect(yesChoice).to.exist;
      expect(yesChoice!.command).to.include('--force');
      expect(yesChoice!.command).to.include('--json');
    });

    it('should archive with --force flag', async () => {
      const output = await execInProcess('project archive archive-me --force --machine');
      const json = extractJson<{
        success: boolean;
        result: { archived: boolean; projectId: string };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.archived).to.equal(true);

      const project = db.prepare(
        'SELECT is_archived FROM pmo_projects WHERE id = ?'
      ).get('archive-me') as { is_archived: number };
      expect(project.is_archived).to.equal(1);
    });

    it('should handle already archived project', async () => {
      db.prepare('UPDATE pmo_projects SET is_archived = 1 WHERE id = ?').run('archive-me');

      const output = await execInProcess('project archive archive-me --machine');
      const json = extractJson<{
        success: boolean;
        result: { alreadyArchived: boolean };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.alreadyArchived).to.equal(true);
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('project archive archive-me -m --machine');
      const json = extractJson<{
        prompt: { type: string };
        metadata: { flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });
  });

  // ===========================================================================
  // project unarchive --machine
  // ===========================================================================
  describe('project unarchive --machine', () => {
    beforeEach(() => {
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id, is_archived)
        VALUES ('unarchive-me', 'Unarchive Me Project', 'Archived project', 'default', 1)
      `).run();
    });

    it('should unarchive and return success', async () => {
      const output = await execInProcess('project unarchive unarchive-me --machine');
      const json = extractJson<{
        success: boolean;
        result: { unarchived: boolean; projectId: string };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.unarchived).to.equal(true);

      const project = db.prepare(
        'SELECT is_archived FROM pmo_projects WHERE id = ?'
      ).get('unarchive-me') as { is_archived: number };
      expect(project.is_archived).to.equal(0);
    });

    it('should return error for non-existent project', async () => {
      const output = await execInProcess('project unarchive nonexistent --machine');
      const json = extractJson<{
        error: { code: string; message: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('PROJECT_NOT_FOUND');
    });

    it('should handle already unarchived project', async () => {
      db.prepare('UPDATE pmo_projects SET is_archived = 0 WHERE id = ?').run('unarchive-me');

      const output = await execInProcess('project unarchive unarchive-me --machine');
      const json = extractJson<{
        success: boolean;
        result: { alreadyUnarchived: boolean };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.alreadyUnarchived).to.equal(true);
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('project unarchive unarchive-me -m --machine');
      const json = extractJson<{
        success: boolean;
        result: { unarchived: boolean };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.unarchived).to.equal(true);
    });
  });

  // ===========================================================================
  // project spec --machine
  // ===========================================================================
  describe('project spec --machine', () => {
    beforeEach(() => {
      db.prepare(`
        INSERT INTO pmo_specs (id, title, status)
        VALUES ('SPEC-001', 'Test Spec', 'active')
      `).run();
    });

    it('should return project selection prompt when no project ID provided', async () => {
      // Need multiple projects for selection
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('spec-proj', 'Spec Project', 'For spec test', 'default')
      `).run();

      const output = await execInProcess('project spec --machine');
      const json = extractJson<{
        prompt: {
          type: string;
          name: string;
          choices: Array<{ name: string; command: string }>;
        };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('selected');

      for (const choice of json.prompt.choices) {
        expect(choice.command).to.include('project spec');
        expect(choice.command).to.include('--json');
      }
    });

    it('should return spec info with commands when project ID provided', async () => {
      const output = await execInProcess('project spec test-project --machine');
      const json = extractJson<{
        success: boolean;
        result: {
          projectId: string;
          projectName: string;
          currentSpecs: unknown[];
          availableSpecs: unknown[];
          commands: { addSpec: string; removeSpec: string };
        };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.projectId).to.equal('test-project');
      expect(json.result.projectName).to.equal('Test Project');
      expect(json.result.commands.addSpec).to.include('--add');
      expect(json.result.commands.removeSpec).to.include('--remove');
    });

    it('should list available specs not yet linked', async () => {
      const output = await execInProcess('project spec test-project --machine');
      const json = extractJson<{
        result: {
          currentSpecs: Array<{ id: string }>;
          availableSpecs: Array<{ id: string; title: string }>;
        };
      }>(output);

      // SPEC-001 should be in available (not linked yet)
      const available = json.result.availableSpecs.find(s => s.id === 'SPEC-001');
      expect(available).to.exist;
      expect(available!.title).to.equal('Test Spec');
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('project spec test-project -m --machine');
      const json = extractJson<{
        success: boolean;
        result: { projectId: string };
      }>(output);

      expect(json.success).to.equal(true);
    });
  });

  // ===========================================================================
  // project (index menu) --machine
  // ===========================================================================
  describe('project index (menu) --machine', () => {
    it('should return menu choices with command fields', async () => {
      const output = await execInProcess('project --machine');
      const json = extractJson<{
        prompt: {
          type: string;
          message: string;
          choices: Array<{ name: string; value: string; command: string }>;
        };
        metadata: { command: string };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.metadata.command).to.equal('project');

      // Verify key choices exist
      const createChoice = json.prompt.choices.find(c => c.name.toLowerCase().includes('create'));
      expect(createChoice).to.exist;
      expect(createChoice!.command).to.include('project create');

      const listChoice = json.prompt.choices.find(c => c.name.toLowerCase().includes('list'));
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('project list');

      const viewChoice = json.prompt.choices.find(c => c.name.toLowerCase().includes('view'));
      expect(viewChoice).to.exist;
      expect(viewChoice!.command).to.include('project view');

      const deleteChoice = json.prompt.choices.find(c => c.name.toLowerCase().includes('delete'));
      expect(deleteChoice).to.exist;
      expect(deleteChoice!.command).to.include('project delete');

      const specChoice = json.prompt.choices.find(c => c.name.toLowerCase().includes('spec'));
      expect(specChoice).to.exist;
      expect(specChoice!.command).to.include('project spec');
    });

    it('should work with --json flag (legacy)', async () => {
      const output = await execInProcess('project --json');
      const json = extractJson<{
        prompt: { type: string; choices: unknown[] };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.choices).to.be.an('array');
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('project -m --machine');
      const json = extractJson<{
        prompt: { type: string };
        metadata: { flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });
  });

  // ===========================================================================
  // End-to-end Agent Flow Tests
  // ===========================================================================
  // These tests simulate an AI agent navigating through the CLI using --machine
  // flag, selecting choices from the top-level menu, and completing multi-step
  // workflows for every menu-accessible subcommand.
  //
  // Menu items: Create, List, View, Spec, Delete
  // Standalone (not in menu): Archive, Unarchive

  describe('End-to-end agent flows (--machine flag)', () => {
    /**
     * Helper types and functions for simulating agent flow
     */
    interface AgentPrompt {
      prompt: {
        type: string;
        name: string;
        message: string;
        choices?: Array<{ name: string; value: string; command?: string }>;
        fields?: Array<{ name: string; type: string }>;
      };
      metadata: {
        command: string;
        flags: Record<string, unknown>;
      };
    }

    interface SuccessResult {
      prompt: null;
      success: true;
      result: Record<string, unknown>;
      metadata: Record<string, unknown>;
    }

    async function agentExec(cmd: string): Promise<AgentPrompt> {
      const output = await execInProcess(cmd);
      return extractJson<AgentPrompt>(output);
    }

    function findChoice(
      choices: Array<{ name: string; value: string; command?: string }>,
      pattern: string
    ): { name: string; value: string; command?: string } | undefined {
      return choices.find(c => c.name.toLowerCase().includes(pattern.toLowerCase()));
    }

    function execChoice(choice: { command?: string }): string {
      if (!choice.command) {
        throw new Error('Choice has no command field');
      }
      return choice.command.replace('prlt ', '');
    }

    // =========================================================================
    // Menu → List (full flow from menu)
    // =========================================================================
    describe('menu → list flow', () => {
      it('should navigate: menu → select "List" → get project data', async () => {
        // Agent Step 1: Get menu
        const step1 = await agentExec('project --machine');
        expect(step1.prompt.type).to.equal('list');

        const listChoice = findChoice(step1.prompt.choices!, 'list');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('project list');

        // Agent Step 2: Execute the list command with --json
        // (menu command uses --format json but --json is the working flag)
        const output = await execInProcess('project list --json');
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.projects).to.be.an('array');

        const projects = result.result.projects as Array<{ id: string; name: string }>;
        const testProject = projects.find(p => p.id === 'test-project');
        expect(testProject).to.exist;
        expect(testProject!.name).to.equal('Test Project');
      });
    });

    // =========================================================================
    // Menu → View (full flow from menu)
    // =========================================================================
    describe('menu → view flow', () => {
      it('should navigate: menu → select "View" → select project → get board data', async () => {
        // Create a second project so view gets a selection prompt
        db.prepare(`
          INSERT INTO pmo_projects (id, name, description, workflow_id)
          VALUES ('second-project', 'Second Project', 'Another', 'default')
        `).run();

        // Agent Step 1: Get menu
        const step1 = await agentExec('project --machine');
        expect(step1.prompt.type).to.equal('list');

        const viewChoice = findChoice(step1.prompt.choices!, 'view');
        expect(viewChoice).to.exist;

        // Agent Step 2: Execute view command → get project selection
        const step2 = await agentExec(execChoice(viewChoice!));
        expect(step2.prompt.type).to.equal('list');
        expect(step2.prompt.choices).to.be.an('array');

        const projectChoice = findChoice(step2.prompt.choices!, 'test-project');
        expect(projectChoice).to.exist;

        // Agent Step 3: Select project → get board data
        const output = await execInProcess(execChoice(projectChoice!));
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.id).to.equal('test-project');
        expect(result.result.columns).to.be.an('array');
      });

      it('should return board with tickets when viewing project directly', async () => {
        db.prepare(`
          INSERT INTO pmo_tickets (id, project_id, title, priority, status, status_id)
          VALUES ('TKT-001', 'test-project', 'Test Ticket', 'high', 'Backlog', 'default-backlog')
        `).run();
        db.prepare(`
          INSERT INTO pmo_tickets (id, project_id, title, priority, status, status_id)
          VALUES ('TKT-002', 'test-project', 'In Progress Ticket', 'medium', 'In Progress', 'default-in-progress')
        `).run();

        const output = await execInProcess('project view test-project --machine');
        const json = extractJson<{
          success: boolean;
          result: {
            id: string;
            columns: Array<{
              name: string;
              ticketCount: number;
              tickets: Array<{ id: string; title: string }>;
            }>;
          };
        }>(output);

        expect(json.success).to.equal(true);
        expect(json.result.columns).to.be.an('array');
        expect(json.result.columns.length).to.be.greaterThan(0);

        const backlogCol = json.result.columns.find(c => c.name === 'Backlog');
        expect(backlogCol).to.exist;
        expect(backlogCol!.ticketCount).to.be.greaterThan(0);

        const ticket = backlogCol!.tickets.find(t => t.id === 'TKT-001');
        expect(ticket).to.exist;
        expect(ticket!.title).to.equal('Test Ticket');
      });
    });

    // =========================================================================
    // Menu → Create (full flow from menu)
    // =========================================================================
    describe('menu → create flow', () => {
      it('should navigate: menu → select "Create" → get form → provide flags → project created', async () => {
        // Agent Step 1: Get menu
        const step1 = await agentExec('project --machine');
        const createChoice = findChoice(step1.prompt.choices!, 'create');
        expect(createChoice).to.exist;

        // Agent Step 2: Execute create command → get form prompt
        const step2 = await agentExec(execChoice(createChoice!));
        expect(step2.prompt).to.exist;
        expect(step2.prompt.fields).to.be.an('array');

        // Verify form includes expected fields
        const nameField = step2.prompt.fields!.find(f => f.name === 'name');
        expect(nameField).to.exist;
        const templateField = step2.prompt.fields!.find(f => f.name === 'template');
        expect(templateField).to.exist;

        // Agent Step 3: Agent fills in form by providing flags directly
        const output = await execInProcess('project create --name "Menu Created Project" --machine');
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.name).to.equal('Menu Created Project');

        // Verify in database
        const project = db.prepare(
          'SELECT name FROM pmo_projects WHERE name = ?'
        ).get('Menu Created Project');
        expect(project).to.exist;
      });

      it('should complete flow with all flags provided directly', async () => {
        const output = await execInProcess(
          'project create --name "Direct Project" --description "Made by agent" --template kanban --machine'
        );
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.name).to.equal('Direct Project');
        expect(result.result.template).to.equal('kanban');
      });
    });

    // =========================================================================
    // Menu → Delete (full flow from menu)
    // =========================================================================
    describe('menu → delete flow', () => {
      beforeEach(() => {
        db.prepare(`
          INSERT INTO pmo_projects (id, name, description, workflow_id)
          VALUES ('flow-delete', 'Flow Delete Project', 'For flow test', 'default')
        `).run();
      });

      it('should navigate: menu → select "Delete" → select project → confirm → deleted', async () => {
        // Agent Step 1: Get menu
        const step1 = await agentExec('project --machine');
        expect(step1.prompt.type).to.equal('list');

        const deleteMenuChoice = findChoice(step1.prompt.choices!, 'delete');
        expect(deleteMenuChoice).to.exist;

        // Agent Step 2: Execute delete command → get project selection
        const step2 = await agentExec(execChoice(deleteMenuChoice!));
        expect(step2.prompt.type).to.equal('list');
        expect(step2.prompt.name).to.equal('selectedProjectId');

        // Find the project to delete
        const projectChoice = findChoice(step2.prompt.choices!, 'Flow Delete');
        expect(projectChoice).to.exist;

        // Agent Step 3: Select project → get confirmation
        const step3 = await agentExec(execChoice(projectChoice!));
        expect(step3.prompt.type).to.equal('list');
        expect(step3.prompt.name).to.equal('confirm');
        expect(step3.prompt.message).to.include('Flow Delete');

        // Find Yes choice with --force
        const yesChoice = step3.prompt.choices!.find(c => c.value === 'true');
        expect(yesChoice).to.exist;
        expect(yesChoice!.command).to.include('--force');

        // Agent Step 4: Confirm deletion
        const output = await execInProcess(execChoice(yesChoice!));
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.deleted).to.equal(true);

        // Verify in database
        const project = db.prepare('SELECT id FROM pmo_projects WHERE id = ?').get('flow-delete');
        expect(project).to.be.undefined;
      });

      it('should complete flow with --force flag (skip confirmation)', async () => {
        const output = await execInProcess('project delete flow-delete --force --machine');
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.deleted).to.equal(true);

        const project = db.prepare('SELECT id FROM pmo_projects WHERE id = ?').get('flow-delete');
        expect(project).to.be.undefined;
      });
    });

    // =========================================================================
    // Menu → Spec (full flow from menu)
    // =========================================================================
    describe('menu → spec flow', () => {
      beforeEach(() => {
        db.prepare(`
          INSERT INTO pmo_specs (id, title, status)
          VALUES ('SPEC-FLOW', 'Flow Test Spec', 'active')
        `).run();
        // Need multiple projects for the spec project selection prompt
        db.prepare(`
          INSERT INTO pmo_projects (id, name, description, workflow_id)
          VALUES ('spec-flow-proj', 'Spec Flow Project', 'For spec flow', 'default')
        `).run();
      });

      it('should navigate: menu → select "Spec" → select project → get spec info with commands', async () => {
        // Agent Step 1: Get menu
        const step1 = await agentExec('project --machine');
        expect(step1.prompt.type).to.equal('list');

        const specMenuChoice = findChoice(step1.prompt.choices!, 'spec');
        expect(specMenuChoice).to.exist;

        // Agent Step 2: Execute spec command → get project selection
        const step2 = await agentExec(execChoice(specMenuChoice!));
        expect(step2.prompt.type).to.equal('list');
        expect(step2.prompt.name).to.equal('selected');

        const projectChoice = findChoice(step2.prompt.choices!, 'test-project');
        expect(projectChoice).to.exist;

        // Agent Step 3: Select project → get spec info with add/remove commands
        const output = await execInProcess(execChoice(projectChoice!));
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.projectId).to.equal('test-project');
        expect(result.result.commands).to.exist;

        const commands = result.result.commands as { addSpec: string; removeSpec: string };
        expect(commands.addSpec).to.include('--add');
        expect(commands.removeSpec).to.include('--remove');

        // Verify available specs are listed
        const availableSpecs = result.result.availableSpecs as Array<{ id: string }>;
        expect(availableSpecs).to.be.an('array');
        const flowSpec = availableSpecs.find(s => s.id === 'SPEC-FLOW');
        expect(flowSpec).to.exist;
      });
    });

    // =========================================================================
    // Archive flow (standalone command, not in menu)
    // =========================================================================
    describe('archive → confirm → verify flow', () => {
      beforeEach(() => {
        db.prepare(`
          INSERT INTO pmo_projects (id, name, description, workflow_id)
          VALUES ('flow-archive', 'Flow Archive Project', 'For flow test', 'default')
        `).run();
      });

      it('should complete flow: get confirmation → confirm → archived in DB', async () => {
        // Agent Step 1: Get confirmation prompt
        const step1 = await agentExec('project archive flow-archive --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.name).to.equal('confirm');
        expect(step1.prompt.message).to.include('Archive');

        const yesChoice = step1.prompt.choices!.find(c => c.value === 'true');
        expect(yesChoice).to.exist;

        // Agent Step 2: Confirm
        const output = await execInProcess(execChoice(yesChoice!));
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.archived).to.equal(true);

        // Verify in database
        const project = db.prepare(
          'SELECT is_archived FROM pmo_projects WHERE id = ?'
        ).get('flow-archive') as { is_archived: number };
        expect(project.is_archived).to.equal(1);
      });
    });

    // =========================================================================
    // Unarchive flow (standalone command, not in menu)
    // =========================================================================
    describe('unarchive flow', () => {
      beforeEach(() => {
        db.prepare(`
          INSERT INTO pmo_projects (id, name, description, workflow_id, is_archived)
          VALUES ('flow-unarchive', 'Flow Unarchive Project', 'Archived project', 'default', 1)
        `).run();
      });

      it('should complete flow: unarchive → verify restored in DB', async () => {
        const output = await execInProcess('project unarchive flow-unarchive --machine');
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.unarchived).to.equal(true);

        // Verify in database
        const project = db.prepare(
          'SELECT is_archived FROM pmo_projects WHERE id = ?'
        ).get('flow-unarchive') as { is_archived: number };
        expect(project.is_archived).to.equal(0);
      });
    });
  });

  // ===========================================================================
  // Backward compatibility: --json flag flows
  // ===========================================================================
  describe('backward compatibility: --json flag flows', () => {
    it('should complete list with --json flag (legacy)', async () => {
      const output = await execInProcess('project list --json');
      const json = extractJson<{
        success: boolean;
        result: { projects: unknown[] };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.projects).to.be.an('array');
    });

    it('should complete create with --json flag (legacy)', async () => {
      const output = await execInProcess('project create --name "Legacy JSON Project" --json');
      const json = extractJson<{
        success: boolean;
        result: { name: string };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.name).to.equal('Legacy JSON Project');
    });

    it('should complete delete with --json flag (legacy)', async () => {
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('json-delete', 'JSON Delete Project', 'For compat test', 'default')
      `).run();

      const output = await execInProcess('project delete json-delete --force --json');
      const json = extractJson<{
        success: boolean;
        result: { deleted: boolean };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.deleted).to.equal(true);
    });

    it('should complete archive with --json flag (legacy)', async () => {
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('json-archive', 'JSON Archive Project', 'For compat test', 'default')
      `).run();

      const output = await execInProcess('project archive json-archive --force --json');
      const json = extractJson<{
        success: boolean;
        result: { archived: boolean };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.archived).to.equal(true);
    });
  });

  // ===========================================================================
  // Error handling
  // ===========================================================================
  describe('error handling', () => {
    it('should return PROJECT_NOT_FOUND for view with invalid ID', async () => {
      const output = await execInProcess('project view nonexistent --machine');
      const json = extractJson<{
        error: { code: string; message: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('PROJECT_NOT_FOUND');
    });

    it('should return PROJECT_NOT_FOUND for archive with invalid ID', async () => {
      const output = await execInProcess('project archive nonexistent --machine');
      const json = extractJson<{
        error: { code: string; message: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('PROJECT_NOT_FOUND');
    });

    it('should return PROJECT_NOT_FOUND for unarchive with invalid ID', async () => {
      const output = await execInProcess('project unarchive nonexistent --machine');
      const json = extractJson<{
        error: { code: string; message: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('PROJECT_NOT_FOUND');
    });

    it('should return PROJECT_NOT_FOUND for delete with invalid ID', async () => {
      const output = await execInProcess('project delete nonexistent --force --machine');
      const json = extractJson<{
        error: { code: string; message: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('PROJECT_NOT_FOUND');
    });

    it('should return CANNOT_DELETE_DEFAULT when deleting default project', async () => {
      db.prepare(`
        INSERT OR IGNORE INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('default', 'Default Project', 'Cannot delete', 'default')
      `).run();

      const output = await execInProcess('project delete default --force --machine');
      const json = extractJson<{
        error: { code: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('CANNOT_DELETE_DEFAULT');
    });

    it('should return PROJECT_NOT_FOUND for spec with invalid project ID', async () => {
      const output = await execInProcess('project spec nonexistent --machine');
      const json = extractJson<{
        error: { code: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('PROJECT_NOT_FOUND');
    });
  });
});

