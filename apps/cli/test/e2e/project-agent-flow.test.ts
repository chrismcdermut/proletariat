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
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  exec,
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
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('project-json-');
    db = new Database(env.dbPath);
    setupTestDatabase(db, env.pmoPath);
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
    it('should output valid JSON with --machine flag', () => {
      const output = exec('project list --machine');
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

    it('should output valid JSON with --json flag (legacy)', () => {
      const output = exec('project list --json');
      const json = extractJson<{
        success: boolean;
        result: { projects: Array<{ id: string }> };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.projects).to.be.an('array');
    });

    it('should work with -m shorthand', () => {
      const output = exec('project list -m');
      const json = extractJson<{
        success: boolean;
        result: { projects: Array<{ id: string }> };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.projects).to.be.an('array');
    });

    it('should produce same structure with --machine and --json', () => {
      const jsonOutput = exec('project list --json');
      const machineOutput = exec('project list --machine');

      const jsonResult = extractJson<{ result: { projects: Array<{ id: string }> } }>(jsonOutput);
      const machineResult = extractJson<{ result: { projects: Array<{ id: string }> } }>(machineOutput);

      expect(machineResult.result.projects.length).to.equal(jsonResult.result.projects.length);
    });

    it('should include project metadata fields', () => {
      const output = exec('project list --machine');
      const json = extractJson<{
        result: { projects: Array<{ id: string; name: string; ticketCount: number; isArchived: boolean }> };
      }>(output);

      const project = json.result.projects.find(p => p.id === 'test-project');
      expect(project).to.exist;
      expect(project!).to.have.property('ticketCount');
      expect(project!).to.have.property('isArchived');
    });

    it('should filter archived projects with --archived flag', () => {
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id, is_archived)
        VALUES ('archived-proj', 'Archived Project', 'Archived', 'default', 1)
      `).run();

      const output = exec('project list --archived --machine');
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
    it('should return board data when project ID is provided', () => {
      const output = exec('project view test-project --machine');
      const json = extractJson<{
        success: boolean;
        result: { id: string; name: string; columns: unknown[] };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.id).to.equal('test-project');
      expect(json.result.name).to.equal('Test Project');
      expect(json.result.columns).to.be.an('array');
    });

    it('should return project selection prompt when no ID provided', () => {
      // Create another project for selection
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('second-project', 'Second Project', 'Another project', 'default')
      `).run();

      const output = exec('project view --machine');
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

    it('should include metadata with command name', () => {
      const output = exec('project view test-project --machine');
      const json = extractJson<{
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.metadata.command).to.equal('project view');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should work with -m shorthand', () => {
      const output = exec('project view test-project -m');
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
    it('should output form prompt when no name provided', () => {
      const output = exec('project create --machine');
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

    it('should include template choices in form fields', () => {
      const output = exec('project create --machine');
      const json = extractJson<{
        prompt: { fields: Array<{ name: string; choices?: Array<{ name: string; value: string }> }> };
      }>(output);

      const templateField = json.prompt.fields.find(f => f.name === 'template');
      expect(templateField).to.exist;
      expect(templateField!.choices).to.be.an('array');
      expect(templateField!.choices!.length).to.be.greaterThan(0);
    });

    it('should create project when name is provided directly', () => {
      const output = exec('project create --name "Machine Created" --machine');
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

    it('should work with -m shorthand', () => {
      const output = exec('project create -m');
      const json = extractJson<{
        prompt: { type: string };
        metadata: { flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should work with positional arg name', () => {
      const output = exec('project create "Positional Name" --machine');
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

    it('should output project selection prompt when no ID provided', () => {
      const output = exec('project delete --machine');
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

    it('should output confirmation prompt when ID is provided', () => {
      const output = exec('project delete delete-me --machine');
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

    it('should delete project when --force provided', () => {
      const output = exec('project delete delete-me --force --machine');
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

    it('should work with -m shorthand', () => {
      const output = exec('project delete delete-me -m');
      const json = extractJson<{
        prompt: { type: string };
        metadata: { flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should not include default project in selection', () => {
      // Add a default project
      db.prepare(`
        INSERT OR IGNORE INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('default', 'Default Project', 'Cannot delete', 'default')
      `).run();

      const output = exec('project delete --machine');
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

    it('should output confirmation prompt', () => {
      const output = exec('project archive archive-me --machine');
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

    it('should archive with --force flag', () => {
      const output = exec('project archive archive-me --force --machine');
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

    it('should handle already archived project', () => {
      db.prepare('UPDATE pmo_projects SET is_archived = 1 WHERE id = ?').run('archive-me');

      const output = exec('project archive archive-me --machine');
      const json = extractJson<{
        success: boolean;
        result: { alreadyArchived: boolean };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.alreadyArchived).to.equal(true);
    });

    it('should work with -m shorthand', () => {
      const output = exec('project archive archive-me -m');
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

    it('should unarchive and return success', () => {
      const output = exec('project unarchive unarchive-me --machine');
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

    it('should return error for non-existent project', () => {
      const output = exec('project unarchive nonexistent --machine');
      const json = extractJson<{
        error: { code: string; message: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('PROJECT_NOT_FOUND');
    });

    it('should handle already unarchived project', () => {
      db.prepare('UPDATE pmo_projects SET is_archived = 0 WHERE id = ?').run('unarchive-me');

      const output = exec('project unarchive unarchive-me --machine');
      const json = extractJson<{
        success: boolean;
        result: { alreadyUnarchived: boolean };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.alreadyUnarchived).to.equal(true);
    });

    it('should work with -m shorthand', () => {
      const output = exec('project unarchive unarchive-me -m');
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
        INSERT INTO pmo_specs (id, path, title, status)
        VALUES ('SPEC-001', 'specs/test.md', 'Test Spec', 'active')
      `).run();
    });

    it('should return project selection prompt when no project ID provided', () => {
      // Need multiple projects for selection
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('spec-proj', 'Spec Project', 'For spec test', 'default')
      `).run();

      const output = exec('project spec --machine');
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

    it('should return spec info with commands when project ID provided', () => {
      const output = exec('project spec test-project --machine');
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

    it('should list available specs not yet linked', () => {
      const output = exec('project spec test-project --machine');
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

    it('should work with -m shorthand', () => {
      const output = exec('project spec test-project -m');
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
    it('should return menu choices with command fields', () => {
      const output = exec('project --machine');
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

    it('should work with --json flag (legacy)', () => {
      const output = exec('project --json');
      const json = extractJson<{
        prompt: { type: string; choices: unknown[] };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.choices).to.be.an('array');
    });

    it('should work with -m shorthand', () => {
      const output = exec('project -m');
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
  // flag, selecting choices, and completing multi-step workflows.

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

    function agentExec(cmd: string): AgentPrompt {
      const output = exec(cmd);
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

    function execFinal(cmd: string): string {
      return exec(cmd.replace(' --json', '').replace(' --machine', ''));
    }

    describe('menu → view project flow', () => {
      it('should navigate: menu → select "View" → select project → get board data', () => {
        // Create a second project so view gets a selection prompt
        db.prepare(`
          INSERT INTO pmo_projects (id, name, description, workflow_id)
          VALUES ('second-project', 'Second Project', 'Another', 'default')
        `).run();

        // Agent Step 1: Get menu
        const step1 = agentExec('project --machine');
        expect(step1.prompt.type).to.equal('list');

        const viewChoice = findChoice(step1.prompt.choices!, 'view');
        expect(viewChoice).to.exist;

        // Agent Step 2: Execute view command → get project selection
        const step2 = agentExec(execChoice(viewChoice!));
        expect(step2.prompt.type).to.equal('list');
        expect(step2.prompt.choices).to.be.an('array');

        const projectChoice = findChoice(step2.prompt.choices!, 'test-project');
        expect(projectChoice).to.exist;

        // Agent Step 3: Select project → get board data
        const output = exec(execChoice(projectChoice!));
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.id).to.equal('test-project');
        expect(result.result.columns).to.be.an('array');
      });
    });

    describe('menu → create project flow', () => {
      it('should navigate: menu → select "Create" → get form prompt', () => {
        // Agent Step 1: Get menu
        const step1 = agentExec('project --machine');
        const createChoice = findChoice(step1.prompt.choices!, 'create');
        expect(createChoice).to.exist;

        // Agent Step 2: Execute create command → get form
        const step2 = agentExec(execChoice(createChoice!));
        expect(step2.prompt).to.exist;
        // Form prompt has fields
        expect(step2.prompt.fields || step2.prompt.type).to.exist;
      });

      it('should complete flow: get form → provide flags → project created', () => {
        // Agent Step 1: Get form prompt
        const step1 = agentExec('project create --machine');
        expect(step1.prompt).to.exist;

        // Agent Step 2: Provide name (agent fills in the form)
        const output = exec('project create --name "Agent Flow Project" --machine');
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.name).to.equal('Agent Flow Project');

        // Verify in database
        const project = db.prepare(
          'SELECT name FROM pmo_projects WHERE name = ?'
        ).get('Agent Flow Project');
        expect(project).to.exist;
      });

      it('should complete flow with all flags provided directly', () => {
        const output = exec(
          'project create --name "Direct Project" --description "Made by agent" --template kanban --machine'
        );
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.name).to.equal('Direct Project');
        expect(result.result.template).to.equal('kanban');
      });
    });

    describe('delete - full agent flow', () => {
      beforeEach(() => {
        db.prepare(`
          INSERT INTO pmo_projects (id, name, description, workflow_id)
          VALUES ('flow-delete', 'Flow Delete Project', 'For flow test', 'default')
        `).run();
      });

      it('should complete flow: select project → confirm → deleted', () => {
        // Agent Step 1: No ID → get project selection
        const step1 = agentExec('project delete --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.name).to.equal('selectedProjectId');

        // Find the project to delete
        const projectChoice = findChoice(step1.prompt.choices!, 'Flow Delete');
        expect(projectChoice).to.exist;

        // Agent Step 2: Select project → get confirmation
        const step2 = agentExec(execChoice(projectChoice!));
        expect(step2.prompt.type).to.equal('list');
        expect(step2.prompt.name).to.equal('confirm');
        expect(step2.prompt.message).to.include('Flow Delete');

        // Find Yes choice with --force
        const yesChoice = step2.prompt.choices!.find(c => c.value === 'true');
        expect(yesChoice).to.exist;
        expect(yesChoice!.command).to.include('--force');

        // Agent Step 3: Confirm deletion
        const output = exec(execChoice(yesChoice!));
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.deleted).to.equal(true);

        // Verify in database
        const project = db.prepare('SELECT id FROM pmo_projects WHERE id = ?').get('flow-delete');
        expect(project).to.be.undefined;
      });

      it('should complete flow with --force flag (skip confirmation)', () => {
        const output = exec('project delete flow-delete --force --machine');
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.deleted).to.equal(true);

        const project = db.prepare('SELECT id FROM pmo_projects WHERE id = ?').get('flow-delete');
        expect(project).to.be.undefined;
      });
    });

    describe('archive → confirm → verify flow', () => {
      beforeEach(() => {
        db.prepare(`
          INSERT INTO pmo_projects (id, name, description, workflow_id)
          VALUES ('flow-archive', 'Flow Archive Project', 'For flow test', 'default')
        `).run();
      });

      it('should complete flow: confirm → archived', () => {
        // Agent Step 1: Get confirmation prompt
        const step1 = agentExec('project archive flow-archive --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.name).to.equal('confirm');
        expect(step1.prompt.message).to.include('Archive');

        const yesChoice = step1.prompt.choices!.find(c => c.value === 'true');
        expect(yesChoice).to.exist;

        // Agent Step 2: Confirm
        const output = exec(execChoice(yesChoice!));
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

    describe('view → board data flow', () => {
      beforeEach(() => {
        // Add tickets so the board isn't empty
        db.prepare(`
          INSERT INTO pmo_tickets (id, project_id, title, priority, status, status_id)
          VALUES ('TKT-001', 'test-project', 'Test Ticket', 'high', 'backlog', 'status-backlog')
        `).run();
        db.prepare(`
          INSERT INTO pmo_tickets (id, project_id, title, priority, status, status_id)
          VALUES ('TKT-002', 'test-project', 'In Progress Ticket', 'medium', 'in-progress', 'status-in-progress')
        `).run();
      });

      it('should return board with tickets in columns', () => {
        const output = exec('project view test-project --machine');
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

        // Find backlog column with the ticket
        const backlogCol = json.result.columns.find(c => c.name === 'Backlog');
        expect(backlogCol).to.exist;
        expect(backlogCol!.ticketCount).to.be.greaterThan(0);

        const ticket = backlogCol!.tickets.find(t => t.id === 'TKT-001');
        expect(ticket).to.exist;
        expect(ticket!.title).to.equal('Test Ticket');
      });
    });

    describe('spec management flow', () => {
      beforeEach(() => {
        db.prepare(`
          INSERT INTO pmo_specs (id, path, title, status)
          VALUES ('SPEC-FLOW', 'specs/flow.md', 'Flow Test Spec', 'active')
        `).run();
      });

      it('should complete flow: select project → view spec info', () => {
        db.prepare(`
          INSERT INTO pmo_projects (id, name, description, workflow_id)
          VALUES ('spec-flow-proj', 'Spec Flow Project', 'For spec flow', 'default')
        `).run();

        // Agent Step 1: No project ID → get project selection
        const step1 = agentExec('project spec --machine');
        expect(step1.prompt.type).to.equal('list');

        const projectChoice = findChoice(step1.prompt.choices!, 'test-project');
        expect(projectChoice).to.exist;

        // Agent Step 2: Select project → get spec info
        const output = exec(execChoice(projectChoice!));
        const result = extractJson<SuccessResult>(output);
        expect(result.success).to.equal(true);
        expect(result.result.projectId).to.equal('test-project');
        expect(result.result.commands).to.exist;
      });
    });
  });

  // ===========================================================================
  // Backward compatibility: --json flag flows
  // ===========================================================================
  describe('backward compatibility: --json flag flows', () => {
    it('should complete list with --json flag (legacy)', () => {
      const output = exec('project list --json');
      const json = extractJson<{
        success: boolean;
        result: { projects: unknown[] };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.projects).to.be.an('array');
    });

    it('should complete create with --json flag (legacy)', () => {
      const output = exec('project create --name "Legacy JSON Project" --json');
      const json = extractJson<{
        success: boolean;
        result: { name: string };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.name).to.equal('Legacy JSON Project');
    });

    it('should complete delete with --json flag (legacy)', () => {
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('json-delete', 'JSON Delete Project', 'For compat test', 'default')
      `).run();

      const output = exec('project delete json-delete --force --json');
      const json = extractJson<{
        success: boolean;
        result: { deleted: boolean };
      }>(output);

      expect(json.success).to.equal(true);
      expect(json.result.deleted).to.equal(true);
    });

    it('should complete archive with --json flag (legacy)', () => {
      db.prepare(`
        INSERT INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('json-archive', 'JSON Archive Project', 'For compat test', 'default')
      `).run();

      const output = exec('project archive json-archive --force --json');
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
    it('should return PROJECT_NOT_FOUND for view with invalid ID', () => {
      const output = exec('project view nonexistent --machine');
      const json = extractJson<{
        error: { code: string; message: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('PROJECT_NOT_FOUND');
    });

    it('should return PROJECT_NOT_FOUND for archive with invalid ID', () => {
      const output = exec('project archive nonexistent --machine');
      const json = extractJson<{
        error: { code: string; message: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('PROJECT_NOT_FOUND');
    });

    it('should return PROJECT_NOT_FOUND for unarchive with invalid ID', () => {
      const output = exec('project unarchive nonexistent --machine');
      const json = extractJson<{
        error: { code: string; message: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('PROJECT_NOT_FOUND');
    });

    it('should return PROJECT_NOT_FOUND for delete with invalid ID', () => {
      const output = exec('project delete nonexistent --force --machine');
      const json = extractJson<{
        error: { code: string; message: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('PROJECT_NOT_FOUND');
    });

    it('should return CANNOT_DELETE_DEFAULT when deleting default project', () => {
      db.prepare(`
        INSERT OR IGNORE INTO pmo_projects (id, name, description, workflow_id)
        VALUES ('default', 'Default Project', 'Cannot delete', 'default')
      `).run();

      const output = exec('project delete default --force --machine');
      const json = extractJson<{
        error: { code: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('CANNOT_DELETE_DEFAULT');
    });

    it('should return PROJECT_NOT_FOUND for spec with invalid project ID', () => {
      const output = exec('project spec nonexistent --machine');
      const json = extractJson<{
        error: { code: string };
      }>(output);

      expect(json.error).to.exist;
      expect(json.error.code).to.equal('PROJECT_NOT_FOUND');
    });
  });
});

/**
 * Helper function to set up test database with complete PMO schema.
 * Schema matches production schema with all tables needed by project commands.
 */
function setupTestDatabase(db: Database.Database, pmoPath: string) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pmo_phases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_workflow_statuses (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES pmo_workflows(id) ON DELETE CASCADE,
      UNIQUE(workflow_id, name)
    );

    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      phase_id TEXT,
      workflow_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      target_date TIMESTAMP,
      initiative_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (phase_id) REFERENCES pmo_phases(id) ON DELETE SET NULL,
      FOREIGN KEY (workflow_id) REFERENCES pmo_workflows(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, id)
    );

    CREATE TABLE IF NOT EXISTS pmo_specs (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      title TEXT,
      overview TEXT,
      status TEXT DEFAULT 'active',
      spec_type TEXT DEFAULT 'domain',
      domain TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      status_id TEXT,
      owner TEXT,
      assignee TEXT,
      branch TEXT,
      spec_id TEXT,
      epic_id TEXT,
      labels TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_synced_from_spec TIMESTAMP,
      last_synced_from_board TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_project_specs (
      project_id TEXT NOT NULL,
      spec_id TEXT NOT NULL,
      PRIMARY KEY (project_id, spec_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pmo_phases_category ON pmo_phases(category);
    CREATE INDEX IF NOT EXISTS idx_pmo_phases_position ON pmo_phases(category, position);
    CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON pmo_columns(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON pmo_tickets(project_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON pmo_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status_id ON pmo_tickets(status_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_projects_phase ON pmo_projects(phase_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_projects_workflow ON pmo_projects(workflow_id);
  `);

  // Insert workflow
  db.prepare(`
    INSERT INTO pmo_workflows (id, name, description, is_builtin)
    VALUES ('default', 'Default', 'Default kanban workflow', 1)
  `).run();

  // Insert workflow statuses (board columns)
  const statuses = [
    { id: 'status-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'status-in-progress', name: 'In Progress', category: 'started', position: 1 },
    { id: 'status-review', name: 'Review', category: 'started', position: 2 },
    { id: 'status-done', name: 'Done', category: 'completed', position: 3 },
  ];

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_workflow_statuses (id, workflow_id, name, category, position, is_default)
      VALUES (?, 'default', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }

  // Insert test project with workflow reference
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description, workflow_id)
    VALUES ('test-project', 'Test Project', 'E2E test project', 'default')
  `).run();

  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', ?), ('current_project', 'test-project')
  `).run(pmoPath);

  // Insert columns (legacy - still used by some commands)
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in-progress', name: 'In Progress', position: 1 },
    { id: 'review', name: 'Review', position: 2 },
    { id: 'done', name: 'Done', position: 3 },
  ];

  for (const col of columns) {
    db.prepare(`
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `).run(col.id, col.name, col.position);
  }

  // Insert default phases
  const phases = [
    { id: 'idea', name: 'Idea', category: 'backlog', position: 0 },
    { id: 'planned', name: 'Planned', category: 'unstarted', position: 0 },
    { id: 'active', name: 'Active', category: 'started', position: 0 },
    { id: 'complete', name: 'Complete', category: 'completed', position: 0 },
  ];

  for (const phase of phases) {
    db.prepare(`
      INSERT OR IGNORE INTO pmo_phases (id, name, category, position, is_default)
      VALUES (?, ?, ?, ?, 0)
    `).run(phase.id, phase.name, phase.category, phase.position);
  }
}
