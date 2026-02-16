/* eslint-disable max-nested-callbacks */
import { expect } from 'chai';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  exec,
  setupProductionSchema,
  createTestProject,
  createTestPhase,
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
 * Integration tests for phase command JSON mode.
 *
 * These tests verify that:
 * 1. Phase commands support --machine flag (and legacy --json)
 * 2. JSON output includes proper prompt schema
 * 3. Flag accumulation works correctly in choices
 */
describe('Phase Commands JSON Mode', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('phase-json-');

    // Use production schema - includes all builtin phases, workflows, actions, etc.
    db = setupProductionSchema(env.dbPath, env.pmoPath);

    // Create test project
    createTestProject(db, { id: 'test-project', name: 'Test Project' });

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  // Using shared createTestPhase helper from test-helpers.ts

  describe('phase list --machine', () => {
    beforeEach(() => {
      createTestPhase(db, { id: 'phase-1', name: 'In Progress', category: 'started', position: 0 });
      createTestPhase(db, { id: 'phase-2', name: 'Review', category: 'started', position: 1 });
    });

    it('should output valid JSON with --machine flag', () => {
      const output = exec('phase list --machine');
      const json = extractJson<Array<{ id: string; name: string; category: string }>>(output);

      expect(json).to.be.an('array');
      expect(json.length).to.be.greaterThan(0);
      expect(json[0]).to.have.property('id');
      expect(json[0]).to.have.property('name');
      expect(json[0]).to.have.property('category');
    });

    it('should output valid JSON with --json flag (legacy)', () => {
      const output = exec('phase list --json');
      const json = extractJson<Array<{ id: string; name: string }>>(output);

      expect(json).to.be.an('array');
    });

    it('should work with -m shorthand', () => {
      const output = exec('phase list -m');
      const json = extractJson<Array<{ id: string; name: string }>>(output);

      expect(json).to.be.an('array');
    });

    it('should filter by category with --machine flag', () => {
      const output = exec('phase list --category started --machine');
      const json = extractJson<Array<{ id: string; category: string }>>(output);

      expect(json).to.be.an('array');
      for (const phase of json) {
        expect(phase.category).to.equal('started');
      }
    });

    it('should produce same structure with --machine and --json', () => {
      const jsonOutput = exec('phase list --json');
      const machineOutput = exec('phase list --machine');

      const jsonResult = extractJson<Array<{ id: string }>>(jsonOutput);
      const machineResult = extractJson<Array<{ id: string }>>(machineOutput);

      expect(machineResult.length).to.equal(jsonResult.length);
    });
  });

  describe('phase create --machine', () => {
    it('should output prompt JSON when name not provided', () => {
      const output = exec('phase create --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('input');
      expect(json.prompt.name).to.equal('name');
      expect(json.metadata.command).to.equal('phase create');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should output category prompt when name provided', () => {
      const output = exec('phase create "Test Phase" --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; choices: Array<{ name: string; value: string }> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('category');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.length).to.be.greaterThan(0);
    });

    it('should work with -m shorthand', () => {
      const output = exec('phase create -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should create phase when all flags provided', () => {
      const output = exec('phase create "New Phase" --category started --machine');

      // Should succeed and create the phase (not return prompt JSON)
      expect(output).to.include('Created phase');
      expect(output).to.include('New Phase');
    });
  });

  describe('phase update --machine', () => {
    beforeEach(() => {
      createTestPhase(db, { id: 'test-phase', name: 'Test Phase', category: 'started', position: 0 });
    });

    it('should output prompt JSON when phase ID not provided', () => {
      const output = exec('phase update --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('phaseId');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include command field in choices for flag accumulation', () => {
      const output = exec('phase update --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string; value: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('should work with -m shorthand', () => {
      const output = exec('phase update -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should update phase when ID and change flags provided', () => {
      const output = exec('phase update test-phase --name "Updated Phase"');

      expect(output).to.include('Updated phase');
      expect(output).to.include('Updated Phase');
    });
  });

  describe('phase delete --machine', () => {
    beforeEach(() => {
      createTestPhase(db, { id: 'delete-phase', name: 'Delete Me', category: 'started', position: 0 });
    });

    it('should output confirmation prompt JSON', () => {
      const output = exec('phase delete delete-phase --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: unknown }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('confirmed');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should include force flag in Yes choice command', () => {
      const output = exec('phase delete delete-phase --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ name: string; command?: string; value: string }> };
      }>(output);

      // FlagResolver converts boolean values to strings in JSON output
      const yesChoice = json.prompt.choices.find(c => c.value === 'true');
      expect(yesChoice).to.exist;
      expect(yesChoice!.command).to.include('--force');
      expect(yesChoice!.command).to.include('--json');
    });

    it('should work with -m shorthand', () => {
      const output = exec('phase delete delete-phase -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should delete phase when --force provided', () => {
      const output = exec('phase delete delete-phase --force');

      expect(output).to.include('Deleted phase');
      expect(output).to.include('Delete Me');
    });
  });

  describe('phase move --machine', () => {
    beforeEach(() => {
      createTestPhase(db, { id: 'move-phase-1', name: 'Phase One', category: 'started', position: 0 });
      createTestPhase(db, { id: 'move-phase-2', name: 'Phase Two', category: 'started', position: 1 });
    });

    it('should output phase selection prompt when ID not provided', () => {
      const output = exec('phase move --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
        metadata: { command: string; flags: { machine: boolean } };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('phaseId');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should output position selection prompt when ID provided', () => {
      const output = exec('phase move move-phase-1 --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string }> };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('position');
      expect(json.prompt.choices).to.be.an('array');
    });

    it('should work with -m shorthand', () => {
      const output = exec('phase move -m');
      const json = extractJson<{ prompt: { type: string }; metadata: { flags: { machine: boolean } } }>(output);

      expect(json.prompt).to.exist;
      expect(json.metadata.flags.machine).to.equal(true);
    });

    it('should move phase when ID and position provided', () => {
      const output = exec('phase move move-phase-1 --position 1');

      expect(output.toLowerCase()).to.match(/moved|position/);
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

    describe('phase create - full agent flow', () => {
      it('should complete flow: enter name → select category → phase created', () => {
        // Agent Step 1: No name provided, get input prompt
        const step1 = agentExec('phase create --machine');
        expect(step1.prompt.type).to.equal('input');
        expect(step1.prompt.name).to.equal('name');
        expect(step1.prompt.context).to.exist;
        expect(step1.prompt.context!.hint).to.include('prlt phase create');

        // Agent Step 2: Provide name, get category selection
        const step2 = agentExec('phase create "Agent Created Phase" --machine');
        expect(step2.prompt.type).to.equal('list');
        expect(step2.prompt.name).to.equal('category');
        expect(step2.prompt.choices).to.be.an('array');
        expect(step2.prompt.choices!.length).to.be.greaterThan(0);

        // Find 'started' category
        const categoryChoice = findChoice(step2.prompt.choices!, 'Started');
        expect(categoryChoice).to.exist;

        // Agent Step 3: Execute the create with category
        const result = execFinal(execChoice(categoryChoice!));

        // Verify phase was created
        expect(result).to.include('Created phase');
        expect(result).to.include('Agent Created Phase');

        // Verify phase exists in database
        const phase = db.prepare('SELECT * FROM pmo_phases WHERE name = ?').get('Agent Created Phase');
        expect(phase).to.exist;
      });

      it('should complete flow with all flags provided directly', () => {
        // Agent provides all required flags - no prompts needed
        const result = exec('phase create "Direct Phase" --category unstarted');

        expect(result).to.include('Created phase');
        expect(result).to.include('Direct Phase');
      });
    });

    describe('phase update - full agent flow', () => {
      beforeEach(() => {
        createTestPhase(db, { id: 'update-flow-phase', name: 'Update Flow Phase', category: 'backlog', position: 0 });
      });

      it('should complete flow: select phase → update with flags', () => {
        // Agent Step 1: No phase ID, get phase selection prompt
        const step1 = agentExec('phase update --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.name).to.equal('phaseId');
        expect(step1.prompt.choices).to.be.an('array');

        // Find the test phase
        const phaseChoice = findChoice(step1.prompt.choices!, 'Update Flow Phase');
        expect(phaseChoice).to.exist;
        expect(phaseChoice!.command).to.include('--json');

        // Agent Step 2: Select phase, then provide update flags
        // The command from step1 leads to interactive mode, so we provide flags directly
        const updateCmd = `phase update ${phaseChoice!.value} --name "Updated By Agent" --category started`;
        const result = exec(updateCmd);

        // Verify update succeeded
        expect(result).to.include('Updated phase');
        expect(result).to.include('Updated By Agent');

        // Verify in database
        const phase = db.prepare('SELECT * FROM pmo_phases WHERE id = ?').get('update-flow-phase') as { name: string; category: string };
        expect(phase.name).to.equal('Updated By Agent');
        expect(phase.category).to.equal('started');
      });

      it('should complete flow with phase ID provided directly', () => {
        // Agent provides phase ID directly, then flags
        const result = exec('phase update update-flow-phase --name "Renamed Phase"');

        expect(result).to.include('Updated phase');
        expect(result).to.include('Renamed Phase');
      });
    });

    describe('phase delete - full agent flow', () => {
      beforeEach(() => {
        createTestPhase(db, { id: 'delete-flow-phase', name: 'Delete Flow Phase', category: 'canceled', position: 0 });
      });

      it('should complete flow: provide ID → confirm deletion → phase deleted', () => {
        // Agent Step 1: Provide phase ID, get confirmation prompt
        const step1 = agentExec('phase delete delete-flow-phase --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.name).to.equal('confirmed');
        expect(step1.prompt.message).to.include('Delete Flow Phase');

        // Find Yes choice (value is 'true' as string due to FlagResolver serialization)
        const yesChoice = step1.prompt.choices!.find(c => c.value === 'true');
        expect(yesChoice).to.exist;
        expect(yesChoice!.command).to.include('--force');

        // Agent Step 2: Confirm deletion
        const result = execFinal(execChoice(yesChoice!));

        // Verify deletion succeeded
        expect(result).to.include('Deleted phase');
        expect(result).to.include('Delete Flow Phase');

        // Verify phase is gone from database
        const phase = db.prepare('SELECT * FROM pmo_phases WHERE id = ?').get('delete-flow-phase');
        expect(phase).to.be.undefined;
      });

      it('should complete flow with --force flag (skip confirmation)', () => {
        // Agent uses --force to skip confirmation prompt
        const result = exec('phase delete delete-flow-phase --force');

        expect(result).to.include('Deleted phase');

        // Verify phase is gone
        const phase = db.prepare('SELECT * FROM pmo_phases WHERE id = ?').get('delete-flow-phase');
        expect(phase).to.be.undefined;
      });
    });

    describe('phase move - full agent flow', () => {
      beforeEach(() => {
        // Create multiple phases in same category for reordering
        createTestPhase(db, { id: 'move-flow-1', name: 'Move Flow First', category: 'started', position: 0 });
        createTestPhase(db, { id: 'move-flow-2', name: 'Move Flow Second', category: 'started', position: 1 });
        createTestPhase(db, { id: 'move-flow-3', name: 'Move Flow Third', category: 'started', position: 2 });
      });

      it('should complete flow: select phase → select position → phase moved', () => {
        // Agent Step 1: No phase ID, get phase selection prompt
        const step1 = agentExec('phase move --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.name).to.equal('phaseId');

        // Find first phase to move
        const phaseChoice = findChoice(step1.prompt.choices!, 'Move Flow First');
        expect(phaseChoice).to.exist;

        // Agent Step 2: Select phase, get position choices
        const step2 = agentExec(execChoice(phaseChoice!));
        expect(step2.prompt.type).to.equal('list');
        expect(step2.prompt.name).to.equal('position');
        expect(step2.prompt.choices).to.be.an('array');
        expect(step2.prompt.choices!.length).to.equal(4); // 3 test phases + 1 default 'active' phase in started category

        // Find position 3 (move to end)
        const positionChoice = findChoice(step2.prompt.choices!, 'Position 3');
        expect(positionChoice).to.exist;

        // Agent Step 3: Execute the move
        const result = execFinal(execChoice(positionChoice!));

        // Verify move succeeded
        expect(result.toLowerCase()).to.match(/moved|position/);
      });

      it('should complete flow with phase ID provided directly', () => {
        // Agent Step 1: Phase ID provided, get position prompt directly
        const step1 = agentExec('phase move move-flow-1 --machine');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.name).to.equal('position');

        // Select position 1
        const positionChoice = findChoice(step1.prompt.choices!, 'Position 1');
        expect(positionChoice).to.exist;

        // Execute move
        const result = execFinal(execChoice(positionChoice!));
        expect(result.toLowerCase()).to.match(/moved|position/);
      });

      it('should complete flow with all flags provided directly', () => {
        // Agent provides all flags - no prompts needed
        const result = exec('phase move move-flow-1 --position 2');

        expect(result.toLowerCase()).to.match(/moved|position/);
      });
    });

    describe('phase list - agent data retrieval', () => {
      beforeEach(() => {
        createTestPhase(db, { id: 'list-flow-1', name: 'List Phase One', category: 'backlog', position: 0 });
        createTestPhase(db, { id: 'list-flow-2', name: 'List Phase Two', category: 'started', position: 0 });
        createTestPhase(db, { id: 'list-flow-3', name: 'List Phase Three', category: 'completed', position: 0 });
      });

      it('should return all phases as JSON array for agent processing', () => {
        const output = exec('phase list --machine');
        const phases = extractJson<Array<{ id: string; name: string; category: string; position: number }>>(output);

        expect(phases).to.be.an('array');
        expect(phases.length).to.be.greaterThan(0);

        // Agent can find specific phases
        const startedPhase = phases.find(p => p.name === 'List Phase Two');
        expect(startedPhase).to.exist;
        expect(startedPhase!.category).to.equal('started');
      });

      it('should filter phases by category for agent', () => {
        const output = exec('phase list --category started --machine');
        const phases = extractJson<Array<{ id: string; category: string }>>(output);

        // All returned phases should be in 'started' category
        for (const phase of phases) {
          expect(phase.category).to.equal('started');
        }
      });
    });

    describe('backward compatibility: --json flag flows', () => {
      beforeEach(() => {
        createTestPhase(db, { id: 'json-compat-phase', name: 'JSON Compat Phase', category: 'unstarted', position: 0 });
      });

      it('should complete create flow with --json flag (legacy)', () => {
        // Use --json instead of --machine
        const step1 = agentExec('phase create "Legacy JSON Phase" --json');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.name).to.equal('category');

        const categoryChoice = findChoice(step1.prompt.choices!, 'Started');
        const result = execFinal(execChoice(categoryChoice!));

        expect(result).to.include('Created phase');
      });

      it('should complete delete flow with --json flag (legacy)', () => {
        const step1 = agentExec('phase delete json-compat-phase --json');
        expect(step1.prompt.type).to.equal('list');
        expect(step1.prompt.name).to.equal('confirmed');

        const yesChoice = step1.prompt.choices!.find(c => c.value === 'true');
        const result = execFinal(execChoice(yesChoice!));

        expect(result).to.include('Deleted phase');
      });
    });
  });
});

