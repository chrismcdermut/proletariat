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

    db = new Database(env.dbPath);
    setupTestDatabase(db, env.pmoPath);

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  /**
   * Helper to create a custom workflow directly in the database.
   */
  function createCustomWorkflow(
    id: string,
    name: string,
    description: string = ''
  ): void {
    db.prepare(`
      INSERT INTO pmo_workflows (id, name, description, is_builtin)
      VALUES (?, ?, ?, 0)
    `).run(id, name, description);
  }

  /**
   * Helper to add statuses to a workflow.
   */
  function addWorkflowStatus(
    workflowId: string,
    id: string,
    name: string,
    category: string,
    position: number,
    isDefault: number = 0
  ): void {
    db.prepare(`
      INSERT INTO pmo_workflow_statuses (id, workflow_id, name, category, position, is_default)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, workflowId, name, category, position, isDefault);
  }

  describe('workflow list --machine', () => {
    it('should output valid JSON with --machine flag', () => {
      const output = exec('workflow list --machine');
      const json = extractJson<Array<{ id: string; name: string; isBuiltin: boolean }>>(output);

      expect(json).to.be.an('array');
      expect(json.length).to.be.greaterThan(0);
      expect(json[0]).to.have.property('id');
      expect(json[0]).to.have.property('name');
      expect(json[0]).to.have.property('isBuiltin');
    });

    it('should output valid JSON with --json flag (legacy)', () => {
      const output = exec('workflow list --json');
      const json = extractJson<Array<{ id: string; name: string }>>(output);

      expect(json).to.be.an('array');
    });

    it('should work with -m shorthand', () => {
      const output = exec('workflow list -m');
      const json = extractJson<Array<{ id: string; name: string }>>(output);

      expect(json).to.be.an('array');
    });

    it('should filter to builtin workflows with --builtin flag', () => {
      createCustomWorkflow('custom-wf', 'Custom Workflow');

      const output = exec('workflow list --builtin --machine');
      const json = extractJson<Array<{ id: string; isBuiltin: boolean }>>(output);

      expect(json).to.be.an('array');
      for (const wf of json) {
        expect(wf.isBuiltin).to.equal(true);
      }
    });

    it('should filter to custom workflows with --custom flag', () => {
      createCustomWorkflow('custom-wf', 'Custom Workflow');

      const output = exec('workflow list --custom --machine');
      const json = extractJson<Array<{ id: string; isBuiltin: boolean }>>(output);

      expect(json).to.be.an('array');
      for (const wf of json) {
        expect(wf.isBuiltin).to.equal(false);
      }
    });

    it('should produce same structure with --machine and --json', () => {
      const jsonOutput = exec('workflow list --json');
      const machineOutput = exec('workflow list --machine');

      const jsonResult = extractJson<Array<{ id: string }>>(jsonOutput);
      const machineResult = extractJson<Array<{ id: string }>>(machineOutput);

      expect(machineResult.length).to.equal(jsonResult.length);
    });
  });

  describe('workflow view --machine', () => {
    it('should output workflow details when ID provided', () => {
      const output = exec('workflow view default --machine');
      const json = extractJson<{
        workflow: { id: string; name: string; isBuiltin: boolean };
        statuses: Array<{ id: string; name: string; category: string }>;
      }>(output);

      expect(json.workflow).to.exist;
      expect(json.workflow.id).to.equal('default');
      expect(json.workflow.name).to.equal('Default');
      expect(json.statuses).to.be.an('array');
    });

    it('should output selection prompt when ID not provided', () => {
      const output = exec('workflow view --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include command field in choices for flag accumulation', () => {
      const output = exec('workflow view --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('should work with -m shorthand', () => {
      const output = exec('workflow view -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });
  });

  describe('workflow create --machine', () => {
    it('should output form prompt when name not provided', () => {
      const output = exec('workflow create --machine');
      const json = extractJson<{
        prompt: { type: string; fields?: Array<{ name: string; type: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('form');
      expect(json.metadata.command).to.equal('workflow create');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should work with -m shorthand', () => {
      const output = exec('workflow create -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should create workflow when all flags provided', () => {
      const output = exec('workflow create "New Workflow" --description "Test workflow"');

      expect(output).to.include('Created workflow');
      expect(output).to.include('New Workflow');

      // Verify in database
      const wf = db.prepare('SELECT * FROM pmo_workflows WHERE name = ?').get('New Workflow');
      expect(wf).to.exist;
    });

    it('should create workflow with statuses when --statuses provided', () => {
      const output = exec('workflow create "Statused Workflow" --statuses "Todo,Doing,Done"');

      expect(output).to.include('Created workflow');

      // Verify statuses in database
      const wf = db.prepare('SELECT id FROM pmo_workflows WHERE name = ?').get('Statused Workflow') as { id: string };
      const statuses = db.prepare('SELECT name FROM pmo_workflow_statuses WHERE workflow_id = ?').all(wf.id) as Array<{ name: string }>;
      expect(statuses.length).to.equal(3);
    });
  });

  describe('workflow delete --machine', () => {
    beforeEach(() => {
      createCustomWorkflow('deletable-wf', 'Deletable Workflow');
      addWorkflowStatus('deletable-wf', 'del-todo', 'To Do', 'backlog', 0, 1);
      addWorkflowStatus('deletable-wf', 'del-done', 'Done', 'completed', 1);
    });

    it('should output selection prompt when ID not provided', () => {
      const output = exec('workflow delete --machine');
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

    it('should output confirmation prompt when ID provided', () => {
      const output = exec('workflow delete deletable-wf --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include force flag in Yes choice command', () => {
      const output = exec('workflow delete deletable-wf --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; command?: string; value: unknown }> };
      }>(output);

      const yesChoice = json.prompt.choices.find(c => c.value === 'true');
      expect(yesChoice).to.exist;
      expect(yesChoice!.command).to.include('--force');
      expect(yesChoice!.command).to.include('--json');
    });

    it('should work with -m shorthand', () => {
      const output = exec('workflow delete -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should delete workflow when --force provided', () => {
      const output = exec('workflow delete deletable-wf --force');

      expect(output).to.include('Deleted workflow');
      expect(output).to.include('Deletable Workflow');

      // Verify in database
      const wf = db.prepare('SELECT id FROM pmo_workflows WHERE id = ?').get('deletable-wf');
      expect(wf).to.be.undefined;
    });

    it('should reject deletion of built-in workflows', () => {
      const output = exec('workflow delete default --force');
      expect(output.toLowerCase()).to.include('cannot delete');
    });

    it('should reject deletion of workflow in use by project', () => {
      db.prepare(`UPDATE pmo_projects SET workflow_id = 'deletable-wf' WHERE id = 'test-project'`).run();

      const output = exec('workflow delete deletable-wf --force');
      expect(output.toLowerCase()).to.match(/used by|in use|test.project/i);
    });
  });

  describe('workflow switch --machine', () => {
    beforeEach(() => {
      // Use unique IDs that don't conflict with builtin 'kanban' template
      createCustomWorkflow('test-kanban-wf', 'Test Kanban', 'Test Kanban workflow');
      addWorkflowStatus('test-kanban-wf', 'test-kanban-backlog', 'Backlog', 'backlog', 0, 1);
      addWorkflowStatus('test-kanban-wf', 'test-kanban-doing', 'Doing', 'started', 1);
      addWorkflowStatus('test-kanban-wf', 'test-kanban-done', 'Done', 'completed', 2);

      // Add a ticket so switch will go through confirmation flow
      db.prepare(`
        INSERT INTO pmo_tickets (id, project_id, title, status, status_id)
        VALUES ('TKT-SWITCH-BASIC', 'test-project', 'Switch Test Ticket', 'Backlog', 'default-backlog')
      `).run();
    });

    it('should output workflow selection prompt when workflow not provided', () => {
      const output = exec('workflow switch -P test-project --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include project flag in choices for flag accumulation', () => {
      const output = exec('workflow switch -P test-project --machine');
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

    it('should work with -m shorthand', () => {
      const output = exec('workflow switch -P test-project -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should switch workflow when --force provided', () => {
      const output = exec('workflow switch test-kanban-wf -P test-project --force');

      expect(output).to.include('Switched');
      expect(output).to.include('Test Kanban');

      // Verify in database
      const project = db.prepare('SELECT workflow_id FROM pmo_projects WHERE id = ?').get('test-project') as { workflow_id: string };
      expect(project.workflow_id).to.equal('test-kanban-wf');
    });

    it('should prompt for confirmation when project has tickets', () => {
      // Ticket already added in beforeEach
      const output = exec('workflow switch test-kanban-wf -P test-project --machine');
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

    function agentExec(cmd: string): AgentPrompt {
      const output = exec(cmd);
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
    function execFinal(cmd: string): string {
      return exec(cmd.replace(' --json', '').replace(' --machine', ''));
    }

    describe('workflow list - agent data retrieval', () => {
      beforeEach(() => {
        createCustomWorkflow('agent-wf-1', 'Agent Workflow One');
        createCustomWorkflow('agent-wf-2', 'Agent Workflow Two');
      });

      it('should return all workflows as JSON array for agent processing', () => {
        const output = exec('workflow list --machine');
        const workflows = extractJson<Array<{ id: string; name: string; isBuiltin: boolean }>>(output);

        expect(workflows).to.be.an('array');
        expect(workflows.length).to.be.greaterThan(0);

        // Agent can find specific workflows
        const customWf = workflows.find(w => w.name === 'Agent Workflow One');
        expect(customWf).to.exist;
        expect(customWf!.isBuiltin).to.equal(false);
      });

      it('should filter workflows by type for agent', () => {
        const output = exec('workflow list --custom --machine');
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

      it('should complete flow with workflow ID provided directly', () => {
        const output = exec('workflow view default --machine');
        const json = extractJson<{ workflow: { id: string; name: string } }>(output);

        expect(json.workflow.id).to.equal('default');
        expect(json.workflow.name).to.equal('Default');
      });
    });

    describe('workflow create - full agent flow', () => {
      it('should complete flow: form prompt → provide flags → workflow created', () => {
        // Agent Step 1: No name provided, get form prompt
        const step1 = agentExec('workflow create --machine');
        expect(step1.prompt.type).to.equal('form');
        expect(step1.prompt.fields).to.be.an('array');

        // Agent Step 2: Provide required fields via flags
        const result = exec('workflow create "Agent Created Workflow" --description "Created by agent"');

        // Verify workflow was created
        expect(result).to.include('Created workflow');
        expect(result).to.include('Agent Created Workflow');

        // Verify in database
        const wf = db.prepare('SELECT * FROM pmo_workflows WHERE name = ?').get('Agent Created Workflow');
        expect(wf).to.exist;
      });

      it('should complete flow with all flags provided directly', () => {
        // Agent provides all required flags - no prompts needed
        const result = exec('workflow create "Direct Workflow" --description "No prompts" --statuses "New,Active,Done"');

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
        createCustomWorkflow('delete-flow-wf', 'Delete Flow Workflow');
        addWorkflowStatus('delete-flow-wf', 'dfw-todo', 'To Do', 'backlog', 0, 1);
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

      it('should complete flow with --force flag (skip confirmation)', () => {
        // Agent uses --force to skip confirmation prompt
        const result = exec('workflow delete delete-flow-wf --force');

        expect(result).to.include('Deleted workflow');

        // Verify workflow is gone
        const wf = db.prepare('SELECT id FROM pmo_workflows WHERE id = ?').get('delete-flow-wf');
        expect(wf).to.be.undefined;
      });
    });

    describe('workflow switch - full agent flow', () => {
      beforeEach(() => {
        createCustomWorkflow('switch-target-wf', 'Switch Target', 'Target workflow for switch');
        addWorkflowStatus('switch-target-wf', 'st-backlog', 'Backlog', 'backlog', 0, 1);
        addWorkflowStatus('switch-target-wf', 'st-active', 'Active', 'started', 1);
        addWorkflowStatus('switch-target-wf', 'st-done', 'Done', 'completed', 2);

        // Add a ticket so switch will prompt for confirmation
        db.prepare(`
          INSERT INTO pmo_tickets (id, project_id, title, status, status_id)
          VALUES ('TKT-SWITCH', 'test-project', 'Switch Test Ticket', 'Backlog', 'default-backlog')
        `).run();
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

      it('should complete flow with workflow ID and --force provided directly', () => {
        // Agent provides workflow ID and --force - no prompts needed
        const result = exec('workflow switch switch-target-wf -P test-project --force');

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
        createCustomWorkflow('json-compat-wf', 'JSON Compat Workflow');
        addWorkflowStatus('json-compat-wf', 'jc-todo', 'To Do', 'backlog', 0, 1);
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

/**
 * Helper function to set up test database with workflow schema.
 * Schema matches production schema from src/lib/pmo/schema.ts
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
      last_synced_from_board TIMESTAMP,
      FOREIGN KEY (status_id) REFERENCES pmo_workflow_statuses(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (project_id, ticket_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pmo_workflows_builtin ON pmo_workflows(is_builtin);
    CREATE INDEX IF NOT EXISTS idx_pmo_workflow_statuses_workflow ON pmo_workflow_statuses(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_projects_workflow ON pmo_projects(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status ON pmo_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status_id ON pmo_tickets(status_id);
  `);

  // Insert default workflow
  db.prepare(`
    INSERT INTO pmo_workflows (id, name, description, is_builtin)
    VALUES ('default', 'Default', 'Default kanban workflow', 1)
  `).run();

  // Insert workflow statuses - IDs match production format: ${workflow_id}-${status_name_slug}
  const statuses = [
    { id: 'default-backlog', name: 'Backlog', category: 'backlog', position: 0, isDefault: 1 },
    { id: 'default-in-progress', name: 'In Progress', category: 'started', position: 1 },
    { id: 'default-done', name: 'Done', category: 'completed', position: 2 },
  ];

  for (const status of statuses) {
    db.prepare(`
      INSERT INTO pmo_workflow_statuses (id, workflow_id, name, category, position, is_default)
      VALUES (?, 'default', ?, ?, ?, ?)
    `).run(status.id, status.name, status.category, status.position, status.isDefault || 0);
  }

  // Insert test project
  db.prepare(`
    INSERT INTO pmo_projects (id, name, description, workflow_id)
    VALUES ('test-project', 'Test Project', 'E2E test project', 'default')
  `).run();

  db.prepare(`
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', ?), ('current_project', 'test-project')
  `).run(pmoPath);

  // Insert columns
  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in-progress', name: 'In Progress', position: 1 },
    { id: 'done', name: 'Done', position: 2 },
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
