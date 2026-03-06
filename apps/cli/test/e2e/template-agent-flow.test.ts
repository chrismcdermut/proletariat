/**
 * E2E Agent Flow Tests for template/* commands
 *
 * Tests that AI agents can navigate through template commands using --machine flag,
 * following the command field in each choice to reach the desired action.
 */

import { expect } from 'chai';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  createTestProject,
  findChoice,
  execInProcess,
  hasContextError,
  extractJson,
  type TestEnvironment,
  type AgentPromptResponse,
} from './test-helpers.js';
import Database from 'better-sqlite3';

/**
 * Execute a CLI command with --machine flag and parse the JSON response.
 * This is the async in-process version of the shared agentExec helper.
 */
async function agentExec(cmd: string): Promise<AgentPromptResponse | null> {
  const output = await execInProcess(cmd);
  if (hasContextError(output)) return null;
  return extractJson<AgentPromptResponse>(output);
}

describe('Template Commands - Agent Flow E2E Tests', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('template-agent-');
    db = setupProductionSchema(env.dbPath, env.pmoPath);
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');
    createTestProject(db);
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  describe('template index - menu navigation with --machine', () => {
    it('should output JSON prompt with command field for each choice', async () => {
      const result = await agentExec('template --machine');

      expect(result, 'Failed to parse JSON from template --machine').to.not.be.null;
      expect(result!.prompt.type).to.equal('list');
      expect(result!.prompt.name).to.equal('action');
      expect(result!.prompt.choices).to.be.an('array');
      expect(result!.prompt.choices.length).to.be.greaterThan(0);

      // Each choice should have a command field (except Cancel)
      for (const choice of result!.prompt.choices) {
        if (choice.value !== 'cancel') {
          expect(choice.command, `Choice "${choice.name}" missing command`).to.exist;
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('should have list option that navigates to template list', async () => {
      const result = await agentExec('template --machine');
      expect(result).to.not.be.null;

      const listChoice = findChoice(result!.prompt.choices, 'List templates');
      expect(listChoice).to.exist;
      expect(listChoice!.command).to.include('template list');
    });

    it('should have create option that navigates to template create', async () => {
      const result = await agentExec('template --machine');
      expect(result).to.not.be.null;

      const createChoice = findChoice(result!.prompt.choices, 'Create template');
      expect(createChoice).to.exist;
      expect(createChoice!.command).to.include('template create');
    });

    it('should have apply option that navigates to template apply', async () => {
      const result = await agentExec('template --machine');
      expect(result).to.not.be.null;

      const applyChoice = findChoice(result!.prompt.choices, 'Apply template');
      expect(applyChoice).to.exist;
      expect(applyChoice!.command).to.include('template apply');
    });

    it('should have save option that navigates to template save', async () => {
      const result = await agentExec('template --machine');
      expect(result).to.not.be.null;

      const saveChoice = findChoice(result!.prompt.choices, 'Save ticket as template');
      expect(saveChoice).to.exist;
      expect(saveChoice!.command).to.include('template save');
    });

    it('should have update option that navigates to template update', async () => {
      const result = await agentExec('template --machine');
      expect(result).to.not.be.null;

      const updateChoice = findChoice(result!.prompt.choices, 'Update phase template');
      expect(updateChoice).to.exist;
      expect(updateChoice!.command).to.include('template update');
    });

    it('should have delete option that navigates to template delete', async () => {
      const result = await agentExec('template --machine');
      expect(result).to.not.be.null;

      const deleteChoice = findChoice(result!.prompt.choices, 'Delete template');
      expect(deleteChoice).to.exist;
      expect(deleteChoice!.command).to.include('template delete');
    });
  });

  describe('--json flag (legacy) support', () => {
    it('template --json should output same structure as --machine', async () => {
      const machineResult = await agentExec('template --machine');
      const jsonResult = await agentExec('template --json');

      expect(machineResult).to.not.be.null;
      expect(jsonResult).to.not.be.null;
      expect(machineResult!.prompt.type).to.equal(jsonResult!.prompt.type);
      expect(machineResult!.prompt.choices.length).to.equal(jsonResult!.prompt.choices.length);
    });
  });

  describe('help output includes --json flag', () => {
    it('template --help should show --json flag', async () => {
      const output = await execInProcess('template --help');
      expect(output).to.include('--json');
      expect(output).to.include('-m');
    });
  });
});
