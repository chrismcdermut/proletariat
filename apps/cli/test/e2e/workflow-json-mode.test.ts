/* eslint-disable max-nested-callbacks */
import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  execInProcess,
  setupProductionSchema,
  createTestProject,
  createTestWorkflow,
  addTestWorkflowStatus,
  createTestTicket,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * Extract JSON from CLI output that may contain warnings.
 * Looks for the first line starting with { or [ and parses from there.
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
 * Integration tests for workflow command JSON mode.
 *
 * These tests verify that:
 * 1. Workflow commands support --machine flag (and legacy --json)
 * 2. JSON output includes proper prompt schema
 * 3. Flag accumulation works correctly in choices
 * 4. Full agent flows work end-to-end
 */
describe('Workflow Commands JSON Mode', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('workflow-json-');

    // Use production schema - includes all builtin workflows, phases, actions, etc.
    db = setupProductionSchema(env.dbPath, env.pmoPath);

    // Create test project using production 'default' workflow
    createTestProject(db, { id: 'test-project', name: 'Test Project' });

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  // Helper functions now use shared test-helpers.ts utilities:
  // - createTestWorkflow(db, { id, name, description })
  // - addTestWorkflowStatus(db, workflowId, { id, name, category, position, isDefault })
  // - createTestTicket(db, projectId, { id, title, status, statusId })

  describe('workflow list --machine', () => {
    it('should output valid JSON with --machine flag', async () => {
      const output = await execInProcess('workflow list --machine');
      const json = extractJson<Array<{ id: string; name: string; isBuiltin: boolean }>>(output);

      expect(json).to.be.an('array');
      expect(json.length).to.be.greaterThan(0);
      expect(json[0]).to.have.property('id');
      expect(json[0]).to.have.property('name');
      expect(json[0]).to.have.property('isBuiltin');
    });

    it('should output valid JSON with --json flag (legacy)', async () => {
      const output = await execInProcess('workflow list --json');
      const json = extractJson<Array<{ id: string; name: string }>>(output);

      expect(json).to.be.an('array');
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('workflow list -m');
      const json = extractJson<Array<{ id: string; name: string }>>(output);

      expect(json).to.be.an('array');
    });

    it('should filter to builtin workflows with --builtin flag', async () => {
      createTestWorkflow(db, { id: 'custom-wf', name: 'Custom Workflow' });

      const output = await execInProcess('workflow list --builtin --machine');
      const json = extractJson<Array<{ id: string; isBuiltin: boolean }>>(output);

      expect(json).to.be.an('array');
      for (const wf of json) {
        expect(wf.isBuiltin).to.equal(true);
      }
    });

    it('should filter to custom workflows with --custom flag', async () => {
      createTestWorkflow(db, { id: 'custom-wf', name: 'Custom Workflow' });

      const output = await execInProcess('workflow list --custom --machine');
      const json = extractJson<Array<{ id: string; isBuiltin: boolean }>>(output);

      expect(json).to.be.an('array');
      for (const wf of json) {
        expect(wf.isBuiltin).to.equal(false);
      }
    });

    it('should produce same structure with --machine and --json', async () => {
      const jsonOutput = await execInProcess('workflow list --json');
      const machineOutput = await execInProcess('workflow list --machine');

      const jsonResult = extractJson<Array<{ id: string }>>(jsonOutput);
      const machineResult = extractJson<Array<{ id: string }>>(machineOutput);

      expect(machineResult.length).to.equal(jsonResult.length);
    });
  });

  describe('workflow view --machine', () => {
    it('should output workflow details when ID provided', async () => {
      const output = await execInProcess('workflow view default --machine');
      const json = extractJson<{
        workflow: { id: string; name: string; isBuiltin: boolean };
        statuses: Array<{ id: string; name: string; category: string }>;
      }>(output);

      expect(json.workflow).to.exist;
      expect(json.workflow.id).to.equal('default');
      expect(json.workflow.name).to.equal('Default');
      expect(json.statuses).to.be.an('array');
    });

    it('should output selection prompt when ID not provided', async () => {
      const output = await execInProcess('workflow view --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include command field in choices for flag accumulation', async () => {
      const output = await execInProcess('workflow view --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('workflow view -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });
  });

  describe('workflow create --machine', () => {
    it('should output form prompt when name not provided', async () => {
      const output = await execInProcess('workflow create --machine');
      const json = extractJson<{
        prompt: { type: string; fields?: Array<{ name: string; type: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('form');
      expect(json.metadata.command).to.equal('workflow create');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('workflow create -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should create workflow when all flags provided', async () => {
      const output = await execInProcess('workflow create "New Workflow" --description "Test workflow"');

      expect(output).to.include('Created workflow');
      expect(output).to.include('New Workflow');

      // Verify in database
      const wf = db.prepare('SELECT * FROM pmo_workflows WHERE name = ?').get('New Workflow');
      expect(wf).to.exist;
    });

    it('should create workflow with statuses when --statuses provided', async () => {
      const output = await execInProcess('workflow create "Statused Workflow" --statuses "Todo,Doing,Done"');

      expect(output).to.include('Created workflow');

      // Verify statuses in database
      const wf = db.prepare('SELECT id FROM pmo_workflows WHERE name = ?').get('Statused Workflow') as { id: string };
      const statuses = db.prepare('SELECT name FROM pmo_workflow_statuses WHERE workflow_id = ?').all(wf.id) as Array<{ name: string }>;
      expect(statuses.length).to.equal(3);
    });
  });

  describe('workflow delete --machine', () => {
    beforeEach(() => {
      createTestWorkflow(db, { id: 'deletable-wf', name: 'Deletable Workflow' });
      addTestWorkflowStatus(db, 'deletable-wf', { id: 'del-todo', name: 'To Do', category: 'backlog', position: 0, isDefault: true });
      addTestWorkflowStatus(db, 'deletable-wf', { id: 'del-done', name: 'Done', category: 'completed', position: 1 });
    });

    it('should output selection prompt when ID not provided', async () => {
      const output = await execInProcess('workflow delete --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);

      // Should only show custom workflows (not built-in)
      const deletableChoice = json.prompt.choices.find(c => c.name.includes('Deletable'));
      expect(deletableChoice).to.exist;
    });

    it('should output confirmation prompt when ID provided', async () => {
      const output = await execInProcess('workflow delete deletable-wf --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include force flag in Yes choice command', async () => {
      const output = await execInProcess('workflow delete deletable-wf --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; command?: string; value: unknown }> };
      }>(output);

      const yesChoice = json.prompt.choices.find(c => c.value === 'true');
      expect(yesChoice).to.exist;
      expect(yesChoice!.command).to.include('--force');
      expect(yesChoice!.command).to.include('--json');
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('workflow delete -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should delete workflow when --force provided', async () => {
      const output = await execInProcess('workflow delete deletable-wf --force');

      expect(output).to.include('Deleted workflow');
      expect(output).to.include('Deletable Workflow');

      // Verify in database
      const wf = db.prepare('SELECT id FROM pmo_workflows WHERE id = ?').get('deletable-wf');
      expect(wf).to.be.undefined;
    });

    it('should reject deletion of built-in workflows', async () => {
      const output = await execInProcess('workflow delete default --force');
      expect(output.toLowerCase()).to.include('cannot delete');
    });

    it('should reject deletion of workflow in use by project', async () => {
      db.prepare(`UPDATE pmo_projects SET workflow_id = 'deletable-wf' WHERE id = 'test-project'`).run();

      const output = await execInProcess('workflow delete deletable-wf --force');
      expect(output.toLowerCase()).to.match(/used by|in use|test.project/i);
    });
  });

  describe('workflow switch --machine', () => {
    beforeEach(() => {
      // Use unique IDs that don't conflict with builtin 'kanban' template
      createTestWorkflow(db, { id: 'test-kanban-wf', name: 'Test Kanban', description: 'Test Kanban workflow' });
      addTestWorkflowStatus(db, 'test-kanban-wf', { id: 'test-kanban-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: true });
      addTestWorkflowStatus(db, 'test-kanban-wf', { id: 'test-kanban-doing', name: 'Doing', category: 'started', position: 1 });
      addTestWorkflowStatus(db, 'test-kanban-wf', { id: 'test-kanban-done', name: 'Done', category: 'completed', position: 2 });

      // Add a ticket so switch will go through confirmation flow
      createTestTicket(db, 'test-project', { id: 'TKT-SWITCH-BASIC', title: 'Switch Test Ticket', status: 'Backlog', statusId: 'default-backlog' });
    });

    it('should output workflow selection prompt when workflow not provided', async () => {
      const output = await execInProcess('workflow switch -P test-project --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include project flag in choices for flag accumulation', async () => {
      const output = await execInProcess('workflow switch -P test-project --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('-P test-project');
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('workflow switch -P test-project -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should switch workflow when --force provided', async () => {
      const output = await execInProcess('workflow switch test-kanban-wf -P test-project --force');

      expect(output).to.include('Switched');
      expect(output).to.include('Test Kanban');

      // Verify in database
      const project = db.prepare('SELECT workflow_id FROM pmo_projects WHERE id = ?').get('test-project') as { workflow_id: string };
      expect(project.workflow_id).to.equal('test-kanban-wf');
    });

    it('should prompt for confirmation when project has tickets', async () => {
      // Ticket already added in beforeEach
      const output = await execInProcess('workflow switch test-kanban-wf -P test-project --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; choices: Array<{ name: string; value: unknown; command?: string }> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');

      // Should show confirmation choices
      const yesChoice = json.prompt.choices.find(c => c.value === 'true');
      expect(yesChoice).to.exist;
      expect(yesChoice!.command).to.include('--force');
    });
  });

  // ===========================================================================
  // End-to-end Agent Flow Tests
  // ===========================================================================
  // These tests simulate an AI agent navigating through the CLI using --machine
  // flag, selecting choices, and completing multi-step workflows.

  describe('End-to-end agent flows (--machine flag)', () => {
    /**
     * Helper to simulate agent flow: execute command, parse JSON, return parsed result
     */
    interface AgentPrompt {
      prompt: {
        type: string;
        name: string;
        message: string;
        choices?: Array<{ name: string; value: string; command?: string }>;
        fields?: Array<{ name: string; type: string; message: string }>;
        context?: Record<string, unknown>;
      };
      metadata: {
        command: string;
        flags: Record<string, unknown>;
      };
    }

    async function agentExec(cmd: string): Promise<AgentPrompt> {
      const output = await execInProcess(cmd);
      return extractJson<AgentPrompt>(output);
    }

    /**
     * Helper to find a choice by partial name match
     */
    function findChoice(
      choices: Array<{ name: string; value: string; command?: string }>,
      pattern: string
    ): { name: string; value: string; command?: string } | undefined {
      return choices.find(c => c.name.toLowerCase().includes(pattern.toLowerCase()));
    }

    /**
     * Helper to get the command from a choice (strips 'prlt ' prefix)
     */
    function execChoice(choice: { command?: string }): string {
      if (!choice.command) {
        throw new Error('Choice has no command field');
      }
      return choice.command.replace('prlt ', '');
    }

    /**
     * Helper to execute final command (strips --json/--machine flags)
     */
    async function execFinal(cmd: string): Promise<string> {
      return await execInProcess(cmd.replace(' --json', '').replace(' --machine', ''));
    }

    describe('workflow list - agent data retrieval', () => {
      beforeEach(() => {
        createTestWorkflow(db, { id: 'agent-wf-1', name: 'Agent Workflow One' });
        createTestWorkflow(db, { id: 'agent-wf-2', name: 'Agent Workflow Two' });
      });

      it('should return all workflows as JSON array for agent processing', async () => {
        const output = await execInProcess('workflow list --machine');
        const workflows = extractJson<Array<{ id: string; name: string; isBuiltin: boolean }>>(output);

        expect(workflows).to.be.an('array');
        expect(workflows.length).to.be.greaterThan(0);

        // Agent can find specific workflows
        const customWf = workflows.find(w => w.name === 'Agent Workflow One');
        expect(customWf).to.exist;
        expect(customWf!.isBuiltin).to.equal(false);
      });

      it('should filter workflows by type for agent', async () => {
        const output = await execInProcess('workflow list --custom --machine');
        const workflows = extractJson<Array<{ id: string; isBuiltin: boolean }>>(output);

        // All returned workflows should be custom
        for (const wf of workflows) {
          expect(wf.isBuiltin).to.equal(false);
        }
      });
    });

    describe('workflow view - full agent flow', () => {
      it('should complete flow: select workflow → view details', () => {
        // Agent Step 1: No workflow ID, get selection prompt
        const step1 = agentExec('workflow view --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.choices).to.be.an('array');

        // Find default workflow
        const workflowChoice = findChoice(step1.prompt.choices!, 'Default');
        expect(workflowChoice).to.exist;
        expect(workflowChoice!.command).to.include('--json');

        // Agent Step 2: Execute the view command (without --json to get human output)
        const result = execFinal(execChoice(workflowChoice!));

        // Verify workflow details shown (human readable format includes workflow name)
        expect(result).to.include('Default');
      });

      it('should complete flow with workflow ID provided directly', async () => {
        const output = await execInProcess('workflow view default --machine');
        const json = extractJson<{ workflow: { id: string; name: string } }>(output);

        expect(json.workflow.id).to.equal('default');
        expect(json.workflow.name).to.equal('Default');
      });
    });

    describe('workflow create - full agent flow', () => {
      it('should complete flow: form prompt → provide flags → workflow created', async () => {
        // Agent Step 1: No name provided, get form prompt
        const step1 = agentExec('workflow create --machine');
        expect(step1.prompt.type).to.equal('form');
        expect(step1.prompt.fields).to.be.an('array');

        // Agent Step 2: Provide required fields via flags
        const result = await execInProcess('workflow create "Agent Created Workflow" --description "Created by agent"');

        // Verify workflow was created
        expect(result).to.include('Created workflow');
        expect(result).to.include('Agent Created Workflow');

        // Verify in database
        const wf = db.prepare('SELECT * FROM pmo_workflows WHERE name = ?').get('Agent Created Workflow');
        expect(wf).to.exist;
      });

      it('should complete flow with all flags provided directly', async () => {
        // Agent provides all required flags - no prompts needed
        const result = await execInProcess('workflow create "Direct Workflow" --description "No prompts" --statuses "New,Active,Done"');

        expect(result).to.include('Created workflow');
        expect(result).to.include('Direct Workflow');

        // Verify statuses were created
        const wf = db.prepare('SELECT id FROM pmo_workflows WHERE name = ?').get('Direct Workflow') as { id: string };
        const statuses = db.prepare('SELECT name FROM pmo_workflow_statuses WHERE workflow_id = ?').all(wf.id);
        expect(statuses.length).to.equal(3);
      });
    });

    describe('workflow delete - full agent flow', () => {
      beforeEach(() => {
        createTestWorkflow(db, { id: 'delete-flow-wf', name: 'Delete Flow Workflow' });
        addTestWorkflowStatus(db, 'delete-flow-wf', { id: 'dfw-todo', name: 'To Do', category: 'backlog', position: 0, isDefault: true });
      });

      it('should complete flow: select workflow → confirm deletion → workflow deleted', () => {
        // Agent Step 1: No workflow ID, get workflow selection
        const step1 = agentExec('workflow delete --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.choices).to.be.an('array');

        // Find the test workflow
        const workflowChoice = findChoice(step1.prompt.choices!, 'Delete Flow');
        expect(workflowChoice).to.exist;
        expect(workflowChoice!.command).to.include('--json');

        // Agent Step 2: Select workflow, get confirmation prompt
        const step2 = agentExec(execChoice(workflowChoice!));
        expect(step2.prompt.type).to.equal('list');

        // Find Yes choice
        const yesChoice = step2.prompt.choices!.find(c => c.value === 'true');
        expect(yesChoice).to.exist;
        expect(yesChoice!.command).to.include('--force');

        // Agent Step 3: Confirm deletion
        const result = execFinal(execChoice(yesChoice!));

        // Verify deletion succeeded
        expect(result).to.include('Deleted workflow');
        expect(result).to.include('Delete Flow Workflow');

        // Verify workflow is gone from database
        const wf = db.prepare('SELECT id FROM pmo_workflows WHERE id = ?').get('delete-flow-wf');
        expect(wf).to.be.undefined;
      });

      it('should complete flow with --force flag (skip confirmation)', async () => {
        // Agent uses --force to skip confirmation prompt
        const result = await execInProcess('workflow delete delete-flow-wf --force');

        expect(result).to.include('Deleted workflow');

        // Verify workflow is gone
        const wf = db.prepare('SELECT id FROM pmo_workflows WHERE id = ?').get('delete-flow-wf');
        expect(wf).to.be.undefined;
      });
    });

    describe('workflow switch - full agent flow', () => {
      beforeEach(() => {
        createTestWorkflow(db, { id: 'switch-target-wf', name: 'Switch Target', description: 'Target workflow for switch' });
        addTestWorkflowStatus(db, 'switch-target-wf', { id: 'st-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: true });
        addTestWorkflowStatus(db, 'switch-target-wf', { id: 'st-active', name: 'Active', category: 'started', position: 1 });
        addTestWorkflowStatus(db, 'switch-target-wf', { id: 'st-done', name: 'Done', category: 'completed', position: 2 });

        // Add a ticket so switch will prompt for confirmation
        createTestTicket(db, 'test-project', { id: 'TKT-SWITCH', title: 'Switch Test Ticket', status: 'Backlog', statusId: 'default-backlog' });
      });

      it('should complete flow: select workflow → confirm switch → workflow switched', () => {
        // Agent Step 1: No workflow provided, get workflow selection
        const step1 = agentExec('workflow switch -P test-project --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.choices).to.be.an('array');

        // Find the target workflow
        const workflowChoice = findChoice(step1.prompt.choices!, 'Switch Target');
        expect(workflowChoice).to.exist;
        expect(workflowChoice!.command).to.include('-P test-project');
        expect(workflowChoice!.command).to.include('--json');

        // Agent Step 2: Select workflow, get confirmation prompt
        const step2 = agentExec(execChoice(workflowChoice!));
        expect(step2.prompt.type).to.equal('list');

        // Find Yes choice
        const yesChoice = step2.prompt.choices!.find(c => c.value === 'true');
        expect(yesChoice).to.exist;
        expect(yesChoice!.command).to.include('--force');
        expect(yesChoice!.command).to.include('-P test-project');

        // Agent Step 3: Confirm switch
        const result = execFinal(execChoice(yesChoice!));

        // Verify switch succeeded
        expect(result).to.include('Switched');
        expect(result).to.include('Switch Target');

        // Verify in database
        const project = db.prepare('SELECT workflow_id FROM pmo_projects WHERE id = ?').get('test-project') as { workflow_id: string };
        expect(project.workflow_id).to.equal('switch-target-wf');
      });

      it('should complete flow with workflow ID and --force provided directly', async () => {
        // Agent provides workflow ID and --force - no prompts needed
        const result = await execInProcess('workflow switch switch-target-wf -P test-project --force');

        expect(result).to.include('Switched');
        expect(result).to.include('Switch Target');

        // Verify in database
        const project = db.prepare('SELECT workflow_id FROM pmo_projects WHERE id = ?').get('test-project') as { workflow_id: string };
        expect(project.workflow_id).to.equal('switch-target-wf');
      });

      it('should propagate project flag through multi-step flow', () => {
        // Step 1: Initial command with project
        const step1 = agentExec('workflow switch -P test-project --machine');
        expect(step1.prompt.choices).to.be.an('array');

        // All choices should include project flag
        for (const choice of step1.prompt.choices!) {
          if (choice.command) {
            expect(choice.command).to.include('-P test-project');
          }
        }

        // Step 2: Follow a choice
        const workflowChoice = findChoice(step1.prompt.choices!, 'Switch Target');
        const step2 = agentExec(execChoice(workflowChoice!));

        // Confirmation choices should still have project flag
        for (const choice of step2.prompt.choices!) {
          if (choice.command) {
            expect(choice.command).to.include('-P test-project');
          }
        }
      });
    });

    describe('backward compatibility: --json flag flows', () => {
      beforeEach(() => {
        createTestWorkflow(db, { id: 'json-compat-wf', name: 'JSON Compat Workflow' });
        addTestWorkflowStatus(db, 'json-compat-wf', { id: 'jc-todo', name: 'To Do', category: 'backlog', position: 0, isDefault: true });
      });

      it('should complete view flow with --json flag (legacy)', () => {
        // Use --json instead of --machine
        const step1 = agentExec('workflow view --json');
        expect(step1.prompt.type).to.equal('list');

        const workflowChoice = findChoice(step1.prompt.choices!, 'Default');
        const result = execFinal(execChoice(workflowChoice!));

        expect(result).to.include('Default');
      });

      it('should complete delete flow with --json flag (legacy)', () => {
        const step1 = agentExec('workflow delete json-compat-wf --json');
        expect(step1.prompt.type).to.equal('list');

        const yesChoice = step1.prompt.choices!.find(c => c.value === 'true');
        const result = execFinal(execChoice(yesChoice!));

        expect(result).to.include('Deleted workflow');
      });
    });
  });
});

