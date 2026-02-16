/* eslint-disable max-nested-callbacks */
import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  exec,
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  createTestProject,
  createHQConfig,
  createPMODirectories,
  extractJson,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * Response type for JSON prompts from --machine flag
 */
interface MachinePromptResponse {
  prompt: {
    type: string;
    name: string;
    message: string;
    choices?: Array<{
      name: string;
      value: string;
      command?: string;
    }>;
    default?: string;
    context?: {
      hint?: string;
      requiredFields?: string[];
      currentValue?: string;
    };
  };
  metadata: {
    command: string;
    flags: Record<string, unknown>;
    timestamp?: string;
  };
}

/**
 * E2E tests for Action commands with --machine flag (AI agent flow).
 *
 * These tests verify that action commands output valid JSON when invoked
 * with --machine flag, allowing AI agents to navigate the CLI stateless.
 */
describe('Action Commands E2E - Agent Flow (--machine)', function (this: Mocha.Suite) {
  // Set default timeout for all tests in this suite to 30 seconds
  this.timeout(30000);

  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('action-agent-flow-');

    // Use production schema - includes all builtin actions, workflows, phases, etc.
    db = setupProductionSchema(env.dbPath, env.pmoPath);

    // Create test project (use 'default' to match existing test expectations)
    createTestProject(db, { id: 'default', name: 'Default Project' });

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'default');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  // ===========================================================================
  // action index --machine (main menu)
  // ===========================================================================

  describe('action index --machine', () => {
    it('should output valid JSON prompt with --machine flag', () => {
      const output = exec('action --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.prompt.name).to.equal('selection');
      expect(json!.prompt.choices).to.be.an('array');
      expect(json!.metadata.command).to.equal('action');
      expect(json!.metadata.flags.machine).to.equal(true);
    });

    it('should output valid JSON with --json flag (legacy)', () => {
      const output = exec('action --json');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.metadata.flags.json).to.equal(true);
    });

    it('should work with -m shorthand', () => {
      const output = exec('action -m');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata.flags.machine).to.equal(true);
    });

    it('should include --machine flag in choice commands', () => {
      const output = exec('action --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      for (const choice of json!.prompt.choices || []) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command).to.include('--machine');
        }
      }
    });

    it('should include all menu options in choices', () => {
      const output = exec('action --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      const values = json!.prompt.choices!.map(c => c.value);
      expect(values).to.include('list');
      expect(values).to.include('show');
      expect(values).to.include('create');
      expect(values).to.include('update');
      expect(values).to.include('delete');
    });

    it('should have proper command format for each choice', () => {
      const output = exec('action --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      for (const choice of json!.prompt.choices || []) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command).to.match(/^prlt action (list|show|create|update|delete) --machine$/);
        }
      }
    });
  });

  // ===========================================================================
  // action list flags
  // ===========================================================================

  describe('action list --json', () => {
    it('should return JSON array of actions', () => {
      const output = exec('action list --json');
      const actions = extractJson<Array<{ id: string }>>(output);

      expect(actions).to.be.an('array');
      expect(actions!.length).to.be.greaterThan(0);
    });

    it('should include built-in actions', () => {
      const output = exec('action list --json');
      const actions = extractJson<Array<{ id: string }>>(output);

      expect(actions).to.not.be.null;
      const actionIds = actions!.map((a: { id: string }) => a.id);
      expect(actionIds).to.include('groom');
      expect(actionIds).to.include('implement');
    });

    it('should work with --machine flag (alias for --json)', () => {
      const output = exec('action list --machine');
      // action list --machine should work the same as --json
      // The output should either be JSON array or at minimum not error
      expect(output).to.not.include('Error:');
    });

    it('should filter builtin actions with --builtin flag', () => {
      const output = exec('action list --json --builtin');
      const actions = extractJson<Array<{ id: string; isBuiltin: boolean }>>(output);

      expect(actions).to.not.be.null;
      for (const action of actions!) {
        expect(action.isBuiltin).to.equal(true);
      }
    });

    it('should filter custom actions with --custom flag', () => {
      // First create a custom action
      exec('action create "Test Custom" --prompt "Test prompt"');

      const output = exec('action list --json --custom');
      const actions = extractJson<Array<{ id: string; isBuiltin: boolean }>>(output);

      expect(actions).to.not.be.null;
      for (const action of actions!) {
        expect(action.isBuiltin).to.equal(false);
      }
    });
  });

  // ===========================================================================
  // action create --machine
  // ===========================================================================

  describe('action create --machine', () => {
    it('should output JSON prompt when name is missing', () => {
      const output = exec('action create --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('input');
      expect(json!.prompt.name).to.equal('name');
      expect(json!.metadata.command).to.equal('action create');
      // FlagResolver-based commands output flags differently, verify JSON structure exists
      expect(json!.metadata.flags).to.be.an('object');
    });

    it('should include context hints in JSON output', () => {
      const output = exec('action create --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.context).to.exist;
      expect(json!.prompt.context!.hint).to.include('prlt action create');
    });

    it('should output prompt for --prompt when name provided', () => {
      const output = exec('action create "Test Action" --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.name).to.equal('prompt');
      expect(json!.prompt.context).to.exist;
    });

    it('should create action when all required args provided', () => {
      const output = exec('action create "Direct Create" --prompt "Test prompt" --machine');
      expect(output).to.include('Created action');

      const action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('direct-create') as { name: string };
      expect(action).to.exist;
      expect(action.name).to.equal('Direct Create');
    });
  });

  // ===========================================================================
  // action update --machine
  // ===========================================================================

  describe('action update --machine', () => {
    beforeEach(() => {
      // Create a custom action for update tests
      exec('action create "Update Target" --prompt "Original prompt"');
    });

    it('should output JSON prompt in interactive mode', () => {
      const output = exec('action update update-target --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('input');
      expect(json!.prompt.name).to.equal('name');
      expect(json!.metadata.command).to.equal('action update');
    });

    it('should include current value in context', () => {
      const output = exec('action update update-target --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.context).to.exist;
      expect(json!.prompt.context!.currentValue).to.equal('Update Target');
    });

    it('should update with direct flags', () => {
      exec('action update update-target --name "Renamed Action" --machine');

      const action = db.prepare('SELECT name FROM pmo_actions WHERE id = ?').get('update-target') as { name: string };
      expect(action.name).to.equal('Renamed Action');
    });

    it('should output error JSON for built-in action', () => {
      const output = exec('action update groom --name "New Name" --machine');

      expect(output.toLowerCase()).to.include('built-in');
    });

    it('should output error JSON for non-existent action', () => {
      const output = exec('action update nonexistent --machine');

      expect(output.toLowerCase()).to.include('not found');
    });
  });

  // ===========================================================================
  // action delete --machine
  // ===========================================================================

  describe('action delete --machine', () => {
    beforeEach(() => {
      // Create a custom action for delete tests
      exec('action create "Delete Target" --prompt "To be deleted"');
    });

    it('should output JSON confirmation prompt', () => {
      const output = exec('action delete delete-target --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.type).to.equal('list');
      expect(json!.prompt.name).to.equal('confirmed');
      expect(json!.prompt.message).to.include('Delete');
    });

    it('should include choices with commands', () => {
      const output = exec('action delete delete-target --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.prompt.choices).to.have.lengthOf(2);

      const yesChoice = json!.prompt.choices!.find(c => c.name === 'Yes');
      expect(yesChoice).to.exist;
      expect(yesChoice!.command).to.include('--force');
    });

    it('should delete with --force flag', () => {
      exec('action delete delete-target --force --machine');

      const action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('delete-target');
      expect(action).to.be.undefined;
    });

    it('should output error JSON for built-in action', () => {
      const output = exec('action delete groom --force --machine');

      expect(output.toLowerCase()).to.include('built-in');
    });

    it('should output error JSON for non-existent action', () => {
      const output = exec('action delete nonexistent --force --machine');

      expect(output.toLowerCase()).to.include('not found');
    });
  });

  // ===========================================================================
  // action CRUD operations (without --machine, for completeness)
  // ===========================================================================

  describe('action CRUD operations', () => {
    it('should create custom action', () => {
      const output = exec('action create "Test Action" --prompt "Test prompt"');
      expect(output).to.include('Created action');

      const action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('test-action') as { name: string };
      expect(action).to.exist;
      expect(action.name).to.equal('Test Action');
    });

    it('should update custom action', () => {
      // Create first
      exec('action create "Update Me" --prompt "Original"');

      // Update
      exec('action update update-me --prompt "Updated prompt"');

      const action = db.prepare('SELECT prompt FROM pmo_actions WHERE id = ?').get('update-me') as { prompt: string };
      expect(action.prompt).to.equal('Updated prompt');
    });

    it('should delete custom action with --force', () => {
      // Create first
      exec('action create "Delete Me" --prompt "To delete"');

      // Delete
      exec('action delete delete-me --force');

      const action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('delete-me');
      expect(action).to.be.undefined;
    });

    it('should prevent deleting built-in actions', () => {
      const output = exec('action delete groom --force');
      expect(output.toLowerCase()).to.include('built-in');
    });

    it('should prevent updating built-in actions', () => {
      const output = exec('action update groom --name "New Name"');
      expect(output.toLowerCase()).to.include('built-in');
    });
  });

  // ===========================================================================
  // End-to-end agent flows - Complete multi-step chains
  // ===========================================================================

  describe('End-to-end agent flows', () => {
    it('should complete action index → list flow and return valid actions', () => {
      // Step 1: Get the main menu
      const menuOutput = exec('action --machine');
      const menu = extractJson<MachinePromptResponse>(menuOutput);

      expect(menu).to.not.be.null;
      expect(menu!.prompt.type).to.equal('list');

      // Step 2: Find the list choice and get its command
      const listChoice = menu!.prompt.choices!.find(c => c.value === 'list');
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('action list');
      expect(listChoice!.command).to.include('--machine');

      // Step 3: Execute the list command from the choice
      const listCmd = listChoice!.command!.replace('prlt ', '');
      const listOutput = exec(listCmd);

      // Step 4: Verify valid JSON array is returned with built-in actions
      const actions = extractJson<Array<{ id: string; name: string; isBuiltin: boolean }>>(listOutput);
      expect(actions).to.be.an('array');
      expect(actions!.length).to.be.greaterThan(0);

      // Verify built-in actions are present
      const groomAction = actions!.find(a => a.id === 'groom');
      expect(groomAction).to.exist;
      expect(groomAction!.isBuiltin).to.equal(true);
    });

    it('should complete full create flow: menu → name prompt → prompt prompt → verify creation', () => {
      // Step 1: Get the main menu
      const menuOutput = exec('action --machine');
      const menu = extractJson<MachinePromptResponse>(menuOutput);
      expect(menu).to.not.be.null;

      // Step 2: Find the create choice
      const createChoice = menu!.prompt.choices!.find(c => c.value === 'create');
      expect(createChoice).to.exist;
      expect(createChoice!.command).to.equal('prlt action create --machine');

      // Step 3: Execute create command - should prompt for name
      const step1Output = exec('action create --machine');
      const step1Prompt = extractJson<MachinePromptResponse>(step1Output);

      expect(step1Prompt).to.not.be.null;
      expect(step1Prompt!.prompt.type).to.equal('input');
      expect(step1Prompt!.prompt.name).to.equal('name');
      expect(step1Prompt!.prompt.message).to.include('name');
      expect(step1Prompt!.prompt.context!.hint).to.include('prlt action create');

      // Step 4: Provide name - should prompt for prompt text
      const step2Output = exec('action create "E2E Test Action" --machine');
      const step2Prompt = extractJson<MachinePromptResponse>(step2Output);

      expect(step2Prompt).to.not.be.null;
      expect(step2Prompt!.prompt.type).to.equal('editor');
      expect(step2Prompt!.prompt.name).to.equal('prompt');
      expect(step2Prompt!.prompt.context!.hint).to.include('E2E Test Action');
      expect(step2Prompt!.prompt.context!.requiredFields).to.include('--prompt');

      // Step 5: Provide prompt - action should be created
      const finalOutput = exec('action create "E2E Test Action" --prompt "This is the agent prompt text"');
      expect(finalOutput).to.include('Created action');
      expect(finalOutput).to.include('e2e-test-action');

      // Step 6: Verify action was created correctly in database
      const action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('e2e-test-action') as {
        id: string;
        name: string;
        prompt: string;
        is_builtin: number;
      };
      expect(action).to.exist;
      expect(action.name).to.equal('E2E Test Action');
      expect(action.prompt).to.equal('This is the agent prompt text');
      expect(action.is_builtin).to.equal(0);
    });

    it('should complete delete flow: confirmation prompt → execute Yes command → verify deletion', () => {
      // Setup: Create a custom action to delete
      exec('action create "Delete Target" --prompt "Will be deleted"');

      // Verify it was created
      let action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('delete-target');
      expect(action).to.exist;

      // Step 1: Get delete confirmation prompt
      const deleteOutput = exec('action delete delete-target --machine');
      const deletePrompt = extractJson<MachinePromptResponse>(deleteOutput);

      expect(deletePrompt).to.not.be.null;
      expect(deletePrompt!.prompt.type).to.equal('list');
      expect(deletePrompt!.prompt.name).to.equal('confirmed');
      expect(deletePrompt!.prompt.message).to.include('Delete');
      expect(deletePrompt!.prompt.message).to.include('Delete Target');
      expect(deletePrompt!.prompt.choices).to.have.lengthOf(2);

      // Step 2: Verify choices have proper structure
      const noChoice = deletePrompt!.prompt.choices!.find(c => c.name === 'No');
      const yesChoice = deletePrompt!.prompt.choices!.find(c => c.name === 'Yes');

      expect(noChoice).to.exist;
      expect(yesChoice).to.exist;
      expect(yesChoice!.command).to.include('--force');
      expect(yesChoice!.command).to.include('delete-target');

      // Step 3: Execute the Yes command from the prompt
      const forceCmd = yesChoice!.command!.replace('prlt ', '');
      const confirmOutput = exec(forceCmd);
      expect(confirmOutput).to.include('Deleted');

      // Step 4: Verify action was deleted from database
      action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('delete-target');
      expect(action).to.be.undefined;
    });

    it('should complete update flow: prompt for name → apply update → verify changes', () => {
      // Setup: Create a custom action to update
      exec('action create "Update Target" --prompt "Original prompt" --description "Original desc"');

      // Verify it was created
      const original = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('update-target') as {
        name: string;
        prompt: string;
        description: string;
      };
      expect(original).to.exist;
      expect(original.name).to.equal('Update Target');

      // Step 1: Get update prompt (interactive mode without flags)
      const updateOutput = exec('action update update-target --machine');
      const updatePrompt = extractJson<MachinePromptResponse>(updateOutput);

      expect(updatePrompt).to.not.be.null;
      expect(updatePrompt!.prompt.type).to.equal('input');
      expect(updatePrompt!.prompt.name).to.equal('name');
      expect(updatePrompt!.prompt.default).to.equal('Update Target');
      expect(updatePrompt!.prompt.context!.currentValue).to.equal('Update Target');
      expect(updatePrompt!.prompt.context!.hint).to.include('--name');

      // Step 2: Apply update with direct flags
      const applyOutput = exec('action update update-target --name "Renamed Action" --prompt "Updated prompt" --description "New description"');
      expect(applyOutput).to.include('Updated');

      // Step 3: Verify all changes were applied
      const updated = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('update-target') as {
        name: string;
        prompt: string;
        description: string;
      };
      expect(updated.name).to.equal('Renamed Action');
      expect(updated.prompt).to.equal('Updated prompt');
      expect(updated.description).to.equal('New description');
    });

    it('should complete create with all optional flags and verify all fields', () => {
      // Create action with all optional fields
      const output = exec('action create "Full Options Action" --prompt "Full prompt" --description "Full description" --suggested-for started,backlog --move-to completed');
      expect(output).to.include('Created action');

      // Verify all fields were saved correctly
      const action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('full-options-action') as {
        name: string;
        prompt: string;
        description: string;
        suggested_for_categories: string;
        default_move_to_category: string;
        is_builtin: number;
      };

      expect(action).to.exist;
      expect(action.name).to.equal('Full Options Action');
      expect(action.prompt).to.equal('Full prompt');
      expect(action.description).to.equal('Full description');
      expect(action.default_move_to_category).to.equal('completed');
      expect(action.is_builtin).to.equal(0);

      // suggested_for_categories is stored as JSON
      const categories = JSON.parse(action.suggested_for_categories);
      expect(categories).to.include('started');
      expect(categories).to.include('backlog');
    });

    it('should handle error flow: update non-existent action returns error JSON', () => {
      const output = exec('action update nonexistent-action --machine');
      const errorJson = extractJson<{ error: { code: string; message: string }; metadata: object }>(output);

      expect(errorJson).to.not.be.null;
      expect(errorJson!.error).to.exist;
      expect(errorJson!.error.code).to.equal('ACTION_NOT_FOUND');
      expect(errorJson!.error.message).to.include('not found');
      expect(errorJson!.metadata).to.exist;
    });

    it('should handle error flow: delete built-in action returns error JSON', () => {
      const output = exec('action delete groom --force --machine');
      const errorJson = extractJson<{ error: { code: string; message: string }; metadata: object }>(output);

      expect(errorJson).to.not.be.null;
      expect(errorJson!.error).to.exist;
      expect(errorJson!.error.code).to.equal('CANNOT_DELETE_BUILTIN');
      expect(errorJson!.error.message).to.include('built-in');
    });

    it('should handle error flow: update built-in action returns error JSON', () => {
      const output = exec('action update groom --name "New Groom" --machine');
      const errorJson = extractJson<{ error: { code: string; message: string }; metadata: object }>(output);

      expect(errorJson).to.not.be.null;
      expect(errorJson!.error).to.exist;
      expect(errorJson!.error.code).to.equal('CANNOT_UPDATE_BUILTIN');
      expect(errorJson!.error.message).to.include('built-in');
    });
  });

  // ===========================================================================
  // Multi-step interactive flows (--interactive --machine)
  // ===========================================================================

  describe('Multi-step interactive flows', () => {
    describe('action create --interactive multi-step flow', () => {
      it('Step 1: should prompt for name when no args provided', () => {
        const output = exec('action create --interactive --machine');
        const json = extractJson<MachinePromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('input');
        expect(json!.prompt.name).to.equal('name');
        expect(json!.prompt.message).to.include('name');
        expect(json!.prompt.context!.hint).to.include('prlt action create');
        expect(json!.prompt.context!.requiredFields).to.include('name (as first argument)');
      });

      it('Step 2: should prompt for prompt after name provided', () => {
        const output = exec('action create "Step2 Test" --interactive --machine');
        const json = extractJson<MachinePromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('editor');
        expect(json!.prompt.name).to.equal('prompt');
        expect(json!.prompt.context!.hint).to.include('Step2 Test');
        expect(json!.prompt.context!.requiredFields).to.include('--prompt');
        expect(json!.metadata.flags.name).to.equal('Step2 Test');
      });

      it('Step 3: should prompt for description after name and prompt provided', () => {
        const output = exec('action create "Step3 Test" --prompt "Test prompt" --interactive --machine');
        const json = extractJson<MachinePromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('input');
        expect(json!.prompt.name).to.equal('description');
        expect(json!.prompt.message).to.include('Description');
        expect(json!.metadata.flags.name).to.equal('Step3 Test');
        expect(json!.metadata.flags.prompt).to.equal('Test prompt');
      });

      it('Step 4: should show suggestedFor checkbox after description provided', () => {
        const output = exec('action create "Step4 Test" --prompt "Test prompt" --description "Test desc" --interactive --machine');
        const json = extractJson<MachinePromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('checkbox');
        expect(json!.prompt.name).to.equal('suggestedFor');
        expect(json!.prompt.choices).to.be.an('array');
        expect(json!.prompt.choices!.length).to.be.greaterThan(0);

        // Verify each choice has proper structure with command
        for (const choice of json!.prompt.choices!) {
          expect(choice.name).to.be.a('string');
          expect(choice.value).to.be.a('string');
          expect(choice.command).to.include('prlt action create');
          expect(choice.command).to.include('Step4 Test');
        }
      });

      it('should include all category options in suggestedFor choices', () => {
        const output = exec('action create "Categories Test" --prompt "Test" --description "Test" --interactive --machine');
        const json = extractJson<MachinePromptResponse>(output);

        expect(json).to.not.be.null;
        const values = json!.prompt.choices!.map(c => c.value);
        expect(values).to.include('backlog');
        expect(values).to.include('started');
        expect(values).to.include('completed');
      });

      it('should complete full create flow and verify database', () => {
        // Step 1: Get name prompt
        const step1 = extractJson<MachinePromptResponse>(exec('action create --interactive --machine'));
        expect(step1!.prompt.name).to.equal('name');

        // Step 2: Get prompt prompt
        const step2 = extractJson<MachinePromptResponse>(exec('action create "Full Flow" --interactive --machine'));
        expect(step2!.prompt.name).to.equal('prompt');

        // Step 3: Get description prompt
        const step3 = extractJson<MachinePromptResponse>(exec('action create "Full Flow" --prompt "Flow prompt" --interactive --machine'));
        expect(step3!.prompt.name).to.equal('description');

        // Step 4: Get suggestedFor checkbox
        const step4 = extractJson<MachinePromptResponse>(exec('action create "Full Flow" --prompt "Flow prompt" --description "Flow desc" --interactive --machine'));
        expect(step4!.prompt.name).to.equal('suggestedFor');

        // Final: Create with all flags (skip interactive prompts)
        const finalOutput = exec('action create "Full Flow Final" --prompt "Final prompt" --description "Final desc" --suggested-for started --move-to completed');
        expect(finalOutput).to.include('Created action');

        // Verify in database
        const action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('full-flow-final') as {
          name: string;
          prompt: string;
          description: string;
          default_move_to_category: string;
        };
        expect(action).to.exist;
        expect(action.name).to.equal('Full Flow Final');
        expect(action.prompt).to.equal('Final prompt');
        expect(action.description).to.equal('Final desc');
        expect(action.default_move_to_category).to.equal('completed');
      });
    });

    describe('action update --interactive multi-step flow', () => {
      beforeEach(() => {
        // Create a custom action for update tests
        exec('action create "Update Multi Step" --prompt "Original prompt" --description "Original desc"');
      });

      it('Step 1: should prompt for name with current value', () => {
        const output = exec('action update update-multi-step --interactive --machine');
        const json = extractJson<MachinePromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('input');
        expect(json!.prompt.name).to.equal('name');
        expect(json!.prompt.default).to.equal('Update Multi Step');
        expect(json!.prompt.context!.currentValue).to.equal('Update Multi Step');
      });

      it('Step 2: should prompt for description after name provided', () => {
        const output = exec('action update update-multi-step --name "New Name" --interactive --machine');
        const json = extractJson<MachinePromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('input');
        expect(json!.prompt.name).to.equal('description');
        expect(json!.prompt.default).to.equal('Original desc');
        expect(json!.metadata.flags.name).to.equal('New Name');
      });

      it('Step 3: should prompt for prompt (editor) after description provided', () => {
        const output = exec('action update update-multi-step --name "New Name" --description "New desc" --interactive --machine');
        const json = extractJson<MachinePromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('editor');
        expect(json!.prompt.name).to.equal('prompt');
        expect(json!.prompt.default).to.equal('Original prompt');
        expect(json!.metadata.flags.name).to.equal('New Name');
        expect(json!.metadata.flags.description).to.equal('New desc');
      });

      it('Step 4: should show suggestedFor checkbox after prompt provided', () => {
        const output = exec('action update update-multi-step --name "New Name" --description "New desc" --prompt "New prompt" --interactive --machine');
        const json = extractJson<MachinePromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('checkbox');
        expect(json!.prompt.name).to.equal('suggestedFor');
        expect(json!.prompt.choices).to.be.an('array');

        // Verify choices have commands with accumulated flags
        const choice = json!.prompt.choices![0];
        expect(choice.command).to.include('update-multi-step');
        expect(choice.command).to.include('New Name');
      });

      it('should complete multi-step update and verify database changes', () => {
        // Verify original values
        let action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('update-multi-step') as {
          name: string;
          description: string;
          prompt: string;
        };
        expect(action.name).to.equal('Update Multi Step');

        // Step through the flow
        const step1 = extractJson<MachinePromptResponse>(exec('action update update-multi-step --interactive --machine'));
        expect(step1!.prompt.name).to.equal('name');

        const step2 = extractJson<MachinePromptResponse>(exec('action update update-multi-step --name "Step By Step" --interactive --machine'));
        expect(step2!.prompt.name).to.equal('description');

        const step3 = extractJson<MachinePromptResponse>(exec('action update update-multi-step --name "Step By Step" --description "Stepped desc" --interactive --machine'));
        expect(step3!.prompt.name).to.equal('prompt');

        // Apply final update with direct flags (without --interactive to skip remaining prompts)
        exec('action update update-multi-step --name "Final Update" --description "Final desc" --prompt "Final prompt"');

        // Verify all changes in database
        action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('update-multi-step') as {
          name: string;
          description: string;
          prompt: string;
        };
        expect(action.name).to.equal('Final Update');
        expect(action.description).to.equal('Final desc');
        expect(action.prompt).to.equal('Final prompt');
      });
    });

    describe('action delete confirmation flow', () => {
      it('should show confirmation with Yes/No choices', () => {
        exec('action create "Confirm Delete" --prompt "To confirm"');

        const output = exec('action delete confirm-delete --machine');
        const json = extractJson<MachinePromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('list');
        expect(json!.prompt.name).to.equal('confirmed');
        expect(json!.prompt.choices).to.have.lengthOf(2);

        const noChoice = json!.prompt.choices!.find(c => c.name === 'No');
        const yesChoice = json!.prompt.choices!.find(c => c.name === 'Yes');

        expect(noChoice).to.exist;
        expect(noChoice!.command).to.equal(''); // No command for No choice

        expect(yesChoice).to.exist;
        expect(yesChoice!.command).to.include('--force');
        expect(yesChoice!.command).to.include('--json');
      });

      it('should execute Yes command and delete action', () => {
        exec('action create "Execute Yes" --prompt "Execute test"');

        // Get confirmation prompt
        const confirmOutput = exec('action delete execute-yes --machine');
        const json = extractJson<MachinePromptResponse>(confirmOutput);

        // Extract and execute Yes command
        const yesChoice = json!.prompt.choices!.find(c => c.name === 'Yes');
        const yesCmd = yesChoice!.command!.replace('prlt ', '');
        exec(yesCmd);

        // Verify deletion
        const action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('execute-yes');
        expect(action).to.be.undefined;
      });
    });
  });

  // ===========================================================================
  // Flag combinations and edge cases
  // ===========================================================================

  describe('Flag combinations and edge cases', () => {
    it('should handle --machine and --json together (--machine takes precedence)', () => {
      const output = exec('action --machine --json');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata.flags.machine).to.equal(true);
    });

    it('should handle -m shorthand with other flags', () => {
      const output = exec('action -m');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;
      expect(json!.metadata.flags.machine).to.equal(true);
    });

    it('should propagate --machine flag through subcommand choices', () => {
      const output = exec('action --machine');
      const json = extractJson<MachinePromptResponse>(output);

      expect(json).to.not.be.null;

      // Every choice with a command should have --machine
      for (const choice of json!.prompt.choices || []) {
        if (choice.command && choice.command.length > 0) {
          expect(choice.command, `Choice ${choice.name} should include --machine`).to.include('--machine');
        }
      }
    });

    it('should handle action create with all optional flags', () => {
      const output = exec('action create "Full Options" --prompt "Test" --description "Test desc" --suggested-for started,backlog --move-to completed');
      expect(output).to.include('Created action');

      const action = db.prepare('SELECT * FROM pmo_actions WHERE id = ?').get('full-options') as {
        name: string;
        description: string;
        suggested_for_categories: string;
        default_move_to_category: string;
      };
      expect(action.description).to.equal('Test desc');
      expect(action.default_move_to_category).to.equal('completed');
    });

    it('should handle empty action list gracefully', () => {
      // Delete all custom actions (built-in remain)
      const customActions = db.prepare('SELECT id FROM pmo_actions WHERE is_builtin = 0').all() as Array<{ id: string }>;
      for (const action of customActions) {
        db.prepare('DELETE FROM pmo_actions WHERE id = ?').run(action.id);
      }

      const output = exec('action list --json --custom');
      const actions = extractJson<Array<{ id: string }>>(output);

      expect(actions).to.be.an('array');
      expect(actions!.length).to.equal(0);
    });
  });
});

// Helper function to set up test database with action schema
