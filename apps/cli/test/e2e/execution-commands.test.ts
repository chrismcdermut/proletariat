/* eslint-disable max-nested-callbacks */
import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  execInProcess,
  extractJson,
  findChoice,
  findChoiceByValue,
  execChoice,
  execFinal,
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  addWorkspaceTables,
  createHQConfig,
  createPMODirectories,
  createTestProject,
  createTestTicket,
  type TestEnvironment,
  type AgentPromptResponse,
} from './test-helpers.js';

/**
 * End-to-end tests for Execution Commands (migrated to this.prompt())
 *
 * Full coverage matrix:
 * - Each subcommand tested (execution, list, logs, stop)
 * - Both --json and --machine flags tested for agent prompt output
 * - Full agent workflow tested: get prompt → extract command → execute → verify result
 * - All flags tested (--status, --agent, --limit, --tail, --force, --all)
 * - End results verified (DB state, output content)
 */
describe('Execution Commands E2E Tests', () => {
  let env: TestEnvironment;
  let testDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    executionCounter = 0;
    env = createTestEnvironment('execution-e2e-');
    testDir = env.testDir;
    dbPath = env.dbPath;

    // Setup additional directories needed by execution commands
    const logsDir = path.join(env.proletariatDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(path.join(testDir, 'agents', 'staff'), { recursive: true });

    // Initialize PMO with production schema (creates pmo_projects table needed by findPMO)
    db = setupProductionSchema(dbPath, env.pmoPath);

    // Add workspace tables (agents, repositories, etc.)
    addWorkspaceTables(db, { type: 'hq', workspaceName: 'test-hq', hasPmo: true });

    // Create HQ config and PMO directories
    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');

    // Create a test project and seed tickets referenced by executions
    createTestProject(db, { id: 'test-project', name: 'Test Project' });
    for (let i = 1; i <= 10; i++) {
      createTestTicket(db, 'test-project', {
        id: `TKT-${String(i).padStart(3, '0')}`,
        title: `Test Ticket ${i}`,
      });
    }
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  // ===========================================================================
  // execution (main menu)
  // ===========================================================================
  describe('prlt execution (main menu)', () => {
    describe('--json mode', () => {
      it('should output JSON prompt schema with all menu choices', async () => {
        const output = await execInProcess('execution --json');
        const json = extractJson<AgentPromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('list');
        expect(json!.prompt.name).to.equal('action');
        expect(json!.prompt.message).to.include('What would you like to do');
        expect(json!.prompt.choices).to.be.an('array');
        expect(json!.prompt.choices.length).to.be.greaterThanOrEqual(4);
      });

      it('should include command field in each choice for agent navigation', async () => {
        const output = await execInProcess('execution --json');
        const json = extractJson<AgentPromptResponse>(output);
        const choices = json!.prompt.choices;

        const listChoice = findChoiceByValue(choices, 'list');
        expect(listChoice).to.exist;
        expect(listChoice!.command).to.include('prlt execution list');

        const logsChoice = findChoiceByValue(choices, 'logs');
        expect(logsChoice).to.exist;
        expect(logsChoice!.command).to.include('prlt execution logs');

        const stopChoice = findChoiceByValue(choices, 'stop');
        expect(stopChoice).to.exist;
        expect(stopChoice!.command).to.include('prlt execution stop');

        const stopAllChoice = findChoiceByValue(choices, 'stop-all');
        expect(stopAllChoice).to.exist;
        expect(stopAllChoice!.command).to.include('prlt execution stop --all');

        const cancelChoice = findChoiceByValue(choices, 'cancel');
        expect(cancelChoice).to.exist;
      });

      it('should include metadata with command name', async () => {
        const output = await execInProcess('execution --json');
        const json = extractJson<AgentPromptResponse>(output);

        expect(json!.metadata).to.exist;
        expect(json!.metadata.command).to.equal('execution');
      });
    });

    describe('--machine mode', () => {
      it('should output identical prompt schema as --json', async () => {
        const output = await execInProcess('execution --machine');
        const json = extractJson<AgentPromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('list');
        expect(json!.prompt.name).to.equal('action');
        expect(json!.prompt.message).to.include('What would you like to do');
        expect(json!.prompt.choices.length).to.be.greaterThanOrEqual(4);
      });

      it('should include command fields in choices with --machine', async () => {
        const output = await execInProcess('execution --machine');
        const json = extractJson<AgentPromptResponse>(output);

        const listChoice = findChoiceByValue(json!.prompt.choices, 'list');
        expect(listChoice!.command).to.include('prlt execution list');

        const stopChoice = findChoiceByValue(json!.prompt.choices, 'stop');
        expect(stopChoice!.command).to.include('prlt execution stop');
      });
    });

    describe('full agent workflow', () => {
      it('should navigate menu → list → verify output with all key fields', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running', { environment: 'host' });

        // Step 1: Get the main menu prompt
        const menuOutput = await execInProcess('execution --json');
        const menu = extractJson<AgentPromptResponse>(menuOutput);
        expect(menu).to.not.be.null;

        // Step 2: Find the "list" choice and extract its command
        const listChoice = findChoiceByValue(menu!.prompt.choices, 'list');
        expect(listChoice).to.exist;
        const listCmd = execChoice(listChoice!);

        // Step 3: Execute the extracted command (strip --json for final execution)
        const listOutput = execFinal(listCmd);

        // Step 4: Verify all key fields are present in output
        expect(listOutput).to.contain('WORK-001');
        expect(listOutput).to.contain('TKT-001');
        expect(listOutput).to.contain('agent-1');
        expect(listOutput).to.contain('running');
        expect(listOutput).to.contain('host');
      });

      it('should navigate menu → logs → select execution → verify logs', async () => {
        const logPath = path.join(testDir, '.proletariat', 'logs', 'work-WORK-001.log');
        fs.writeFileSync(logPath, 'Build started\nCompilation complete\nTests passed\n');
        createExecution(db, 'TKT-001', 'agent-1', 'running', { log_path: logPath });

        // Step 1: Get menu, find logs choice
        const menuOutput = await execInProcess('execution --json');
        const menu = extractJson<AgentPromptResponse>(menuOutput);
        const logsChoice = findChoiceByValue(menu!.prompt.choices, 'logs');
        expect(logsChoice).to.exist;

        // Step 2: Execute logs command (which prompts for execution selection in JSON mode)
        const logsPromptOutput = await execInProcess(execChoice(logsChoice!));
        const logsPrompt = extractJson<AgentPromptResponse>(logsPromptOutput);
        expect(logsPrompt).to.not.be.null;
        expect(logsPrompt!.prompt.name).to.equal('selectedId');

        // Step 3: Find the execution choice and execute it (final, no JSON)
        const execChoice1 = logsPrompt!.prompt.choices[0];
        expect(execChoice1.command).to.include('WORK-001');
        const logsOutput = execFinal(execChoice(execChoice1));

        // Step 4: Verify the actual logs are shown
        expect(logsOutput).to.contain('Build started');
        expect(logsOutput).to.contain('Compilation complete');
        expect(logsOutput).to.contain('Tests passed');
      });

      it('should navigate menu → stop → select execution → verify stopped', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        // Step 1: Get menu, find stop choice
        const menuOutput = await execInProcess('execution --json');
        const menu = extractJson<AgentPromptResponse>(menuOutput);
        const stopMenuChoice = findChoiceByValue(menu!.prompt.choices, 'stop');
        expect(stopMenuChoice).to.exist;

        // Step 2: Execute stop command (prompts for execution selection)
        const stopPromptOutput = await execInProcess(execChoice(stopMenuChoice!));
        const stopPrompt = extractJson<AgentPromptResponse>(stopPromptOutput);
        expect(stopPrompt).to.not.be.null;
        expect(stopPrompt!.prompt.name).to.equal('selectedId');

        // Step 3: Find the execution and execute the stop
        const execStopChoice = stopPrompt!.prompt.choices[0];
        expect(execStopChoice.command).to.include('WORK-001');
        const stopOutput = execFinal(execStopChoice.command!.replace('prlt ', ''));

        // Step 4: Verify DB state
        expect(stopOutput).to.contain('Stopped');
        const row = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(row.status).to.equal('stopped');
      });

      it('should navigate menu → stop-all → verify all stopped', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'running');

        // Step 1: Get menu, find stop-all choice
        const menuOutput = await execInProcess('execution --json');
        const menu = extractJson<AgentPromptResponse>(menuOutput);
        const stopAllChoice = findChoiceByValue(menu!.prompt.choices, 'stop-all');
        expect(stopAllChoice).to.exist;

        // Step 2: Execute the stop-all command directly (no prompt needed)
        const stopOutput = execFinal(execChoice(stopAllChoice!));

        // Step 3: Verify all stopped in DB
        expect(stopOutput).to.contain('Stopping 2 execution(s)');
        const rows = db.prepare('SELECT status FROM agent_work WHERE status = ?').all('stopped') as { status: string }[];
        expect(rows.length).to.equal(2);
      });
    });

    describe('full agent workflow with --machine', () => {
      it('should navigate menu → list → verify output with all key fields using --machine', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running', { environment: 'host' });

        // Step 1: Get the main menu prompt via --machine
        const menuOutput = await execInProcess('execution --machine');
        const menu = extractJson<AgentPromptResponse>(menuOutput);
        expect(menu).to.not.be.null;

        // Step 2: Find the "list" choice and extract its command
        const listChoice = findChoiceByValue(menu!.prompt.choices, 'list');
        expect(listChoice).to.exist;
        const listCmd = execChoice(listChoice!);

        // Step 3: Execute the extracted command
        const listOutput = execFinal(listCmd);

        // Step 4: Verify all key fields are present in output
        expect(listOutput).to.contain('WORK-001');
        expect(listOutput).to.contain('TKT-001');
        expect(listOutput).to.contain('agent-1');
        expect(listOutput).to.contain('running');
        expect(listOutput).to.contain('host');
      });

      it('should navigate menu → logs → select execution → verify logs using --machine', async () => {
        const logPath = path.join(testDir, '.proletariat', 'logs', 'work-WORK-001.log');
        fs.writeFileSync(logPath, 'Machine mode log output\n');
        createExecution(db, 'TKT-001', 'agent-1', 'running', { log_path: logPath });

        // Step 1: Get menu via --machine, find logs choice
        const menuOutput = await execInProcess('execution --machine');
        const menu = extractJson<AgentPromptResponse>(menuOutput);
        const logsChoice = findChoiceByValue(menu!.prompt.choices, 'logs');
        expect(logsChoice).to.exist;

        // Step 2: Execute logs command (prompts for execution selection)
        const logsPromptOutput = await execInProcess(execChoice(logsChoice!));
        const logsPrompt = extractJson<AgentPromptResponse>(logsPromptOutput);
        expect(logsPrompt).to.not.be.null;
        expect(logsPrompt!.prompt.name).to.equal('selectedId');

        // Step 3: Find the execution choice and execute it
        const execChoice1 = logsPrompt!.prompt.choices[0];
        expect(execChoice1.command).to.include('WORK-001');
        const logsOutput = execFinal(execChoice(execChoice1));

        // Step 4: Verify the actual logs are shown
        expect(logsOutput).to.contain('Machine mode log output');
      });

      it('should navigate menu → stop → select execution → verify stopped using --machine', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        // Step 1: Get menu via --machine, find stop choice
        const menuOutput = await execInProcess('execution --machine');
        const menu = extractJson<AgentPromptResponse>(menuOutput);
        const stopMenuChoice = findChoiceByValue(menu!.prompt.choices, 'stop');
        expect(stopMenuChoice).to.exist;

        // Step 2: Execute stop command (prompts for execution selection)
        const stopPromptOutput = await execInProcess(execChoice(stopMenuChoice!));
        const stopPrompt = extractJson<AgentPromptResponse>(stopPromptOutput);
        expect(stopPrompt).to.not.be.null;
        expect(stopPrompt!.prompt.name).to.equal('selectedId');

        // Step 3: Find the execution and execute the stop
        const execStopChoice = stopPrompt!.prompt.choices[0];
        expect(execStopChoice.command).to.include('WORK-001');
        const stopOutput = execFinal(execStopChoice.command!.replace('prlt ', ''));

        // Step 4: Verify DB state
        expect(stopOutput).to.contain('Stopped');
        const row = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(row.status).to.equal('stopped');
      });

      it('should navigate menu → stop-all → verify all stopped using --machine', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'running');

        // Step 1: Get menu via --machine, find stop-all choice
        const menuOutput = await execInProcess('execution --machine');
        const menu = extractJson<AgentPromptResponse>(menuOutput);
        const stopAllChoice = findChoiceByValue(menu!.prompt.choices, 'stop-all');
        expect(stopAllChoice).to.exist;

        // Step 2: Execute the stop-all command directly
        const stopOutput = execFinal(execChoice(stopAllChoice!));

        // Step 3: Verify all stopped in DB
        expect(stopOutput).to.contain('Stopping 2 execution(s)');
        const rows = db.prepare('SELECT status FROM agent_work WHERE status = ?').all('stopped') as { status: string }[];
        expect(rows.length).to.equal(2);
      });
    });
  });

  // ===========================================================================
  // execution list
  // ===========================================================================
  describe('prlt execution list', () => {
    it('should list executions with all key data columns', async () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running', { environment: 'host', display_mode: 'terminal' });

      const output = await execInProcess('execution list --machine');

      expect(output).to.contain('WORK-001');
      expect(output).to.contain('TKT-001');
      expect(output).to.contain('agent-1');
      expect(output).to.contain('host');
      expect(output).to.contain('terminal');
    });

    it('should list multiple executions with different statuses', async () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');
      createExecution(db, 'TKT-002', 'agent-2', 'completed');
      createExecution(db, 'TKT-003', 'agent-3', 'failed');

      const output = await execInProcess('execution list --machine');

      expect(output).to.contain('agent-1');
      expect(output).to.contain('agent-2');
      expect(output).to.contain('agent-3');
      expect(output).to.contain('running');
      expect(output).to.contain('completed');
      expect(output).to.contain('failed');
    });

    it('should show empty message when no executions', async () => {
      const output = await execInProcess('execution list --machine');
      expect(output).to.contain('No executions found');
    });

    it('should filter by --status running', async () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');
      createExecution(db, 'TKT-002', 'agent-2', 'completed');

      const output = await execInProcess('execution list --status running --machine');
      expect(output).to.contain('agent-1');
      expect(output).not.to.contain('agent-2');
    });

    it('should filter by --status completed', async () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');
      createExecution(db, 'TKT-002', 'agent-2', 'completed');

      const output = await execInProcess('execution list --status completed --machine');
      expect(output).not.to.contain('agent-1');
      expect(output).to.contain('agent-2');
    });

    it('should filter by --status failed', async () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');
      createExecution(db, 'TKT-002', 'agent-2', 'failed');

      const output = await execInProcess('execution list --status failed --machine');
      expect(output).not.to.contain('agent-1');
      expect(output).to.contain('agent-2');
    });

    it('should filter by --agent', async () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');
      createExecution(db, 'TKT-002', 'agent-2', 'running');

      const output = await execInProcess('execution list --agent agent-1 --machine');
      expect(output).to.contain('agent-1');
      expect(output).not.to.contain('agent-2');
    });

    it('should respect --limit flag', async () => {
      for (let i = 1; i <= 5; i++) {
        createExecution(db, `TKT-${String(i).padStart(3, '0')}`, 'agent-1', 'completed');
      }

      const output = await execInProcess('execution list --limit 2 --machine');
      const matches = output.match(/WORK-/g) || [];
      expect(matches.length).to.equal(2);
    });

    it('should show suggested commands for running executions', async () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running');

      const output = await execInProcess('execution list --machine');
      expect(output).to.contain('prlt execution logs');
      expect(output).to.contain('prlt execution stop');
    });

    it('should display devcontainer environment correctly', async () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running', { environment: 'devcontainer' });

      const output = await execInProcess('execution list --machine');
      expect(output).to.contain('devcontainer');
    });

    it('should display sandbox status correctly', async () => {
      createExecution(db, 'TKT-001', 'agent-1', 'running', { permission_mode: 'safe' });
      createExecution(db, 'TKT-002', 'agent-2', 'running', { permission_mode: 'danger' });

      const output = await execInProcess('execution list --machine');
      expect(output).to.contain('safe');
      expect(output).to.contain('danger');
    });
  });

  // ===========================================================================
  // execution logs
  // ===========================================================================
  describe('prlt execution logs', () => {
    describe('direct execution with ID', () => {
      it('should display full log content for an execution', async () => {
        const logContent = 'Line 1: Starting agent\nLine 2: Processing ticket\nLine 3: Done\n';
        const logPath = path.join(testDir, '.proletariat', 'logs', 'work-WORK-001.log');
        fs.writeFileSync(logPath, logContent);
        createExecution(db, 'TKT-001', 'agent-1', 'running', { log_path: logPath });

        const output = await execInProcess('execution logs WORK-001 --machine');

        expect(output).to.contain('Line 1: Starting agent');
        expect(output).to.contain('Line 2: Processing ticket');
        expect(output).to.contain('Line 3: Done');
      });

      it('should show execution header with ID and ticket', async () => {
        const logPath = path.join(testDir, '.proletariat', 'logs', 'work-WORK-001.log');
        fs.writeFileSync(logPath, 'test log content\n');
        createExecution(db, 'TKT-001', 'agent-1', 'running', { log_path: logPath });

        const output = await execInProcess('execution logs WORK-001 --machine');
        expect(output).to.contain('WORK-001');
        expect(output).to.contain('TKT-001');
      });

      it('should show message when execution has no log file', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution logs WORK-001 --machine');
        expect(output).to.contain('No log file');
      });

      it('should show tmux attach command when session exists', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running', { session_id: 'prlt-session-1' });

        const output = await execInProcess('execution logs WORK-001 --machine');
        expect(output).to.contain('tmux attach -t prlt-session-1');
      });

      it('should error when execution not found', async () => {
        const output = await execInProcess('execution logs NONEXISTENT --machine');
        expect(output.toLowerCase()).to.contain('not found');
      });

      it('should display last N lines with --tail flag', async () => {
        const logPath = path.join(testDir, '.proletariat', 'logs', 'work-WORK-001.log');
        const lines = Array.from({ length: 20 }, (_, i) => `Log line ${i + 1}`).join('\n') + '\n';
        fs.writeFileSync(logPath, lines);
        createExecution(db, 'TKT-001', 'agent-1', 'running', { log_path: logPath });

        const output = await execInProcess('execution logs WORK-001 --tail 3 --machine');

        expect(output).to.contain('Log line 18');
        expect(output).to.contain('Log line 19');
        expect(output).to.contain('Log line 20');
        expect(output).not.to.contain('Log line 1\n');
      });
    });

    describe('--json mode (no ID - prompt for selection)', () => {
      it('should output JSON prompt with execution choices', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'completed');

        const output = await execInProcess('execution logs --json');
        const json = extractJson<AgentPromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('list');
        expect(json!.prompt.name).to.equal('selectedId');
        expect(json!.prompt.message).to.include('Select execution to view logs');
        expect(json!.prompt.choices.length).to.equal(2);
      });

      it('should include command field with execution ID in each choice', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution logs --json');
        const json = extractJson<AgentPromptResponse>(output);

        const choice = json!.prompt.choices[0];
        expect(choice.command).to.include('prlt execution logs');
        expect(choice.command).to.include('WORK-001');
        expect(choice.command).to.include('--json');
      });

      it('should include execution details in choice names', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution logs --json');
        const json = extractJson<AgentPromptResponse>(output);

        const choice = json!.prompt.choices[0];
        expect(choice.name).to.contain('WORK-001');
        expect(choice.name).to.contain('TKT-001');
        expect(choice.name).to.contain('agent-1');
        expect(choice.name).to.contain('running');
      });

      it('should include metadata with command name', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution logs --json');
        const json = extractJson<AgentPromptResponse>(output);

        expect(json!.metadata.command).to.equal('execution logs');
      });
    });

    describe('--machine mode (no ID - prompt for selection)', () => {
      it('should output identical prompt schema as --json', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution logs --machine');
        const json = extractJson<AgentPromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('list');
        expect(json!.prompt.name).to.equal('selectedId');
        expect(json!.prompt.choices.length).to.equal(1);
        expect(json!.prompt.choices[0].command).to.include('prlt execution logs');
      });
    });

    describe('--json error cases', () => {
      it('should output JSON error when no executions exist and --json used', async () => {
        const output = await execInProcess('execution logs --json');

        // Should contain error JSON (not a prompt)
        expect(output.toLowerCase()).to.contain('no executions found');
      });

      it('should output JSON error when no executions exist and --machine used', async () => {
        const output = await execInProcess('execution logs --machine');

        expect(output.toLowerCase()).to.contain('no executions found');
      });
    });

    describe('full agent workflow for logs', () => {
      it('should complete: get prompt → select specific execution → see correct logs (not other)', async () => {
        const logPath1 = path.join(testDir, '.proletariat', 'logs', 'work-WORK-001.log');
        fs.writeFileSync(logPath1, 'Agent-1 output: building frontend\n');
        createExecution(db, 'TKT-001', 'agent-1', 'running', { log_path: logPath1 });

        const logPath2 = path.join(testDir, '.proletariat', 'logs', 'work-WORK-002.log');
        fs.writeFileSync(logPath2, 'Agent-2 output: running migrations\n');
        createExecution(db, 'TKT-002', 'agent-2', 'running', { log_path: logPath2 });

        // Step 1: Agent requests execution selection
        const promptOutput = await execInProcess('execution logs --json');
        const prompt = extractJson<AgentPromptResponse>(promptOutput);
        expect(prompt).to.not.be.null;
        expect(prompt!.prompt.choices.length).to.equal(2);

        // Step 2: Agent picks WORK-002 specifically
        const selectedExec = findChoice(prompt!.prompt.choices, 'WORK-002');
        expect(selectedExec).to.exist;
        expect(selectedExec!.command).to.include('WORK-002');

        // Step 3: Agent executes the selected command (without --json for final output)
        const logsOutput = execFinal(execChoice(selectedExec!));

        // Step 4: Verify the CORRECT log content is displayed (agent-2, not agent-1)
        expect(logsOutput).to.contain('Agent-2 output: running migrations');
        expect(logsOutput).not.to.contain('Agent-1 output: building frontend');
      });

      it('should complete workflow with --machine flag and show correct logs', async () => {
        const logPath1 = path.join(testDir, '.proletariat', 'logs', 'work-WORK-001.log');
        fs.writeFileSync(logPath1, 'First execution logs\n');
        createExecution(db, 'TKT-001', 'agent-1', 'running', { log_path: logPath1 });

        const logPath2 = path.join(testDir, '.proletariat', 'logs', 'work-WORK-002.log');
        fs.writeFileSync(logPath2, 'Second execution logs\n');
        createExecution(db, 'TKT-002', 'agent-2', 'completed', { log_path: logPath2 });

        // Step 1: Agent requests execution selection via --machine
        const promptOutput = await execInProcess('execution logs --machine');
        const prompt = extractJson<AgentPromptResponse>(promptOutput);
        expect(prompt).to.not.be.null;
        expect(prompt!.prompt.choices.length).to.equal(2);

        // Step 2: Agent picks WORK-001 specifically
        const selectedExec = findChoice(prompt!.prompt.choices, 'WORK-001');
        expect(selectedExec).to.exist;
        expect(selectedExec!.command).to.include('WORK-001');

        // Step 3: Execute the command without --json
        const logsOutput = execFinal(execChoice(selectedExec!));

        // Step 4: Verify correct log content (first, not second)
        expect(logsOutput).to.contain('First execution logs');
        expect(logsOutput).not.to.contain('Second execution logs');
      });
    });
  });

  // ===========================================================================
  // execution stop
  // ===========================================================================
  describe('prlt execution stop', () => {
    describe('single stop with ID', () => {
      it('should stop a running execution and update DB status', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution stop WORK-001 --machine');

        expect(output).to.contain('Stopped');
        expect(output).to.contain('WORK-001');

        // Verify DB state
        const row = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(row.status).to.equal('stopped');
      });

      it('should show agent and ticket details after stop', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution stop WORK-001 --machine');

        expect(output).to.contain('TKT-001');
        expect(output).to.contain('agent-1');
      });

      it('should only stop the targeted execution, leaving others unchanged', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'running');

        const output = await execInProcess('execution stop WORK-001 --machine');

        expect(output).to.contain('Stopped');
        // Target execution stopped
        const stopped = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(stopped.status).to.equal('stopped');
        // Other execution remains running
        const untouched = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-002') as { status: string };
        expect(untouched.status).to.equal('running');
      });

      it('should stop a starting execution', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'starting');

        const output = await execInProcess('execution stop WORK-001 --machine');

        expect(output).to.contain('Stopped');
        const row = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(row.status).to.equal('stopped');
      });

      it('should show message when execution is already stopped and not change DB', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'stopped');

        const output = await execInProcess('execution stop WORK-001 --machine');
        expect(output).to.contain('not running');
        // Verify DB status was NOT changed
        const row = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(row.status).to.equal('stopped');
      });

      it('should show message when execution is completed and not change DB', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'completed');

        const output = await execInProcess('execution stop WORK-001 --machine');
        expect(output).to.contain('not running');
        // Verify DB status was NOT changed to 'stopped'
        const row = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(row.status).to.equal('completed');
      });

      it('should error when execution not found', async () => {
        const output = await execInProcess('execution stop NONEXISTENT --machine');
        expect(output.toLowerCase()).to.contain('not found');
      });

      it('should handle --force flag', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution stop WORK-001 --force --machine');

        expect(output).to.contain('Stopped');
        const row = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(row.status).to.equal('stopped');
      });
    });

    describe('bulk stop with --all', () => {
      it('should stop all running executions and verify each by ID', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'running');

        const output = await execInProcess('execution stop --all --machine');

        expect(output).to.contain('Stopping 2 execution(s)');
        // Verify each specific execution was stopped
        const row1 = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(row1.status).to.equal('stopped');
        const row2 = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-002') as { status: string };
        expect(row2.status).to.equal('stopped');
      });

      it('should include starting executions in bulk stop', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'starting');

        const output = await execInProcess('execution stop --all --machine');

        expect(output).to.contain('Stopping 2 execution(s)');
        const rows = db.prepare('SELECT status FROM agent_work WHERE status = ?').all('stopped') as { status: string }[];
        expect(rows.length).to.equal(2);
      });

      it('should not stop already completed/failed executions', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'completed');
        createExecution(db, 'TKT-003', 'agent-3', 'failed');

        const output = await execInProcess('execution stop --all --machine');

        expect(output).to.contain('Stopping 1 execution(s)');
        const completedRow = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-002') as { status: string };
        expect(completedRow.status).to.equal('completed');
        const failedRow = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-003') as { status: string };
        expect(failedRow.status).to.equal('failed');
      });

      it('should show summary with stopped count', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'running');

        const output = await execInProcess('execution stop --all --machine');

        expect(output).to.contain('Summary');
        expect(output).to.contain('Stopped: 2');
      });

      it('should show empty message when no running executions', async () => {
        const output = await execInProcess('execution stop --all --machine');
        expect(output).to.contain('No running executions');
      });

      it('should work with --all --force combined', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'running');

        const output = await execInProcess('execution stop --all --force --machine');

        expect(output).to.contain('Stopping 2 execution(s)');
        const rows = db.prepare('SELECT status FROM agent_work WHERE status = ?').all('stopped') as { status: string }[];
        expect(rows.length).to.equal(2);
      });
    });

    describe('stop by agent with --agent', () => {
      it('should stop only executions for the specified agent', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'running');

        const output = await execInProcess('execution stop --agent agent-1 --machine');

        expect(output).to.contain('Stopping 1 execution(s)');

        const agent1 = db.prepare('SELECT status FROM agent_work WHERE agent_name = ?').get('agent-1') as { status: string };
        expect(agent1.status).to.equal('stopped');

        const agent2 = db.prepare('SELECT status FROM agent_work WHERE agent_name = ?').get('agent-2') as { status: string };
        expect(agent2.status).to.equal('running');
      });

      it('should stop multiple executions for the same agent', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-1', 'running');
        createExecution(db, 'TKT-003', 'agent-2', 'running');

        const output = await execInProcess('execution stop --agent agent-1 --machine');

        expect(output).to.contain('Stopping 2 execution(s)');
        const rows = db.prepare('SELECT status FROM agent_work WHERE agent_name = ? AND status = ?').all('agent-1', 'stopped') as { status: string }[];
        expect(rows.length).to.equal(2);
      });

      it('should show empty message when agent has no running executions', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'completed');

        const output = await execInProcess('execution stop --agent agent-1 --machine');
        expect(output).to.contain('No running executions');
        expect(output).to.contain('agent-1');
      });
    });

    describe('--json mode (no ID - prompt for selection)', () => {
      it('should output JSON prompt with active execution choices', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'starting');

        const output = await execInProcess('execution stop --json');
        const json = extractJson<AgentPromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('list');
        expect(json!.prompt.name).to.equal('selectedId');
        expect(json!.prompt.message).to.include('Select execution to stop');
        expect(json!.prompt.choices.length).to.equal(2);
      });

      it('should include command field with execution ID in choices', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution stop --json');
        const json = extractJson<AgentPromptResponse>(output);

        const choice = json!.prompt.choices[0];
        expect(choice.command).to.include('prlt execution stop');
        expect(choice.command).to.include('WORK-001');
        expect(choice.command).to.include('--json');
      });

      it('should include execution details in choice names', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running', { environment: 'devcontainer' });

        const output = await execInProcess('execution stop --json');
        const json = extractJson<AgentPromptResponse>(output);

        const choice = json!.prompt.choices[0];
        expect(choice.name).to.contain('WORK-001');
        expect(choice.name).to.contain('TKT-001');
        expect(choice.name).to.contain('agent-1');
        expect(choice.name).to.contain('devcontainer');
      });

      it('should include metadata with command name', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution stop --json');
        const json = extractJson<AgentPromptResponse>(output);

        expect(json!.metadata.command).to.equal('execution stop');
      });

      it('should only show running and starting executions (not completed/failed)', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'completed');
        createExecution(db, 'TKT-003', 'agent-3', 'starting');

        const output = await execInProcess('execution stop --json');
        const json = extractJson<AgentPromptResponse>(output);

        expect(json!.prompt.choices.length).to.equal(2);
        const values = json!.prompt.choices.map(c => c.value);
        expect(values).to.include('WORK-001');
        expect(values).to.include('WORK-003');
        expect(values).not.to.include('WORK-002');
      });
    });

    describe('--machine mode (no ID - prompt for selection)', () => {
      it('should output identical prompt schema as --json', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution stop --machine');
        const json = extractJson<AgentPromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('list');
        expect(json!.prompt.name).to.equal('selectedId');
        expect(json!.prompt.choices.length).to.equal(1);
        expect(json!.prompt.choices[0].command).to.include('prlt execution stop');
        expect(json!.prompt.choices[0].command).to.include('WORK-001');
      });
    });

    describe('--json/--machine with no active executions', () => {
      it('should show no running executions message with --json when all completed', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'completed');
        createExecution(db, 'TKT-002', 'agent-2', 'failed');

        const output = await execInProcess('execution stop --json');
        expect(output).to.contain('No running executions');
      });

      it('should show no running executions message with --machine when all completed', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'completed');

        const output = await execInProcess('execution stop --machine');
        expect(output).to.contain('No running executions');
      });

      it('should show no running executions message with --json when no executions at all', async () => {
        const output = await execInProcess('execution stop --json');
        expect(output).to.contain('No running executions');
      });
    });

    describe('full agent workflow for stop', () => {
      it('should complete: get prompt → select specific execution → stop → verify only that one stopped', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'running');

        // Step 1: Agent requests execution selection
        const promptOutput = await execInProcess('execution stop --json');
        const prompt = extractJson<AgentPromptResponse>(promptOutput);
        expect(prompt).to.not.be.null;
        expect(prompt!.prompt.choices.length).to.equal(2);

        // Step 2: Agent picks WORK-001 specifically (not WORK-002)
        const selectedExec = findChoice(prompt!.prompt.choices, 'WORK-001');
        expect(selectedExec).to.exist;
        expect(selectedExec!.command).to.exist;
        expect(selectedExec!.command).to.include('WORK-001');

        // Step 3: Agent executes the stop command (without --json for final execution)
        const stopOutput = execFinal(execChoice(selectedExec!));

        // Step 4: Verify ONLY the selected execution was stopped
        expect(stopOutput).to.contain('Stopped');
        expect(stopOutput).to.contain('WORK-001');
        const stoppedRow = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(stoppedRow.status).to.equal('stopped');
        // The other execution must remain running
        const untouchedRow = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-002') as { status: string };
        expect(untouchedRow.status).to.equal('running');
      });

      it('should complete workflow with --machine flag and verify correct execution stopped', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'running');

        // Step 1: Use --machine flag
        const promptOutput = await execInProcess('execution stop --machine');
        const prompt = extractJson<AgentPromptResponse>(promptOutput);
        expect(prompt).to.not.be.null;
        expect(prompt!.prompt.choices.length).to.equal(2);

        // Step 2: Agent picks WORK-002 specifically (second choice)
        const selectedExec = findChoice(prompt!.prompt.choices, 'WORK-002');
        expect(selectedExec).to.exist;
        expect(selectedExec!.command).to.include('WORK-002');
        const stopOutput = execFinal(execChoice(selectedExec!));

        // Step 3: Verify ONLY WORK-002 was stopped
        expect(stopOutput).to.contain('Stopped');
        expect(stopOutput).to.contain('WORK-002');
        const stoppedRow = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-002') as { status: string };
        expect(stoppedRow.status).to.equal('stopped');
        // WORK-001 must remain running
        const untouchedRow = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(untouchedRow.status).to.equal('running');
      });
    });
  });

  // ===========================================================================
  // execution kill (alias for execution stop)
  // ===========================================================================
  describe('prlt execution kill (alias for stop)', () => {
    describe('single kill with ID', () => {
      it('should stop a running execution and update DB status', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution kill WORK-001 --machine');

        expect(output).to.contain('Stopped');
        expect(output).to.contain('WORK-001');

        // Verify DB state
        const row = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(row.status).to.equal('stopped');
      });

      it('should show agent and ticket details after kill', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution kill WORK-001 --machine');

        expect(output).to.contain('TKT-001');
        expect(output).to.contain('agent-1');
      });

      it('should handle --force flag', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution kill WORK-001 --force --machine');

        expect(output).to.contain('Stopped');
        const row = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(row.status).to.equal('stopped');
      });

      it('should error when execution not found', async () => {
        const output = await execInProcess('execution kill NONEXISTENT --machine');
        expect(output.toLowerCase()).to.contain('not found');
      });
    });

    describe('bulk kill with --all', () => {
      it('should stop all running executions', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'running');

        const output = await execInProcess('execution kill --all --machine');

        expect(output).to.contain('Stopping 2 execution(s)');
        const rows = db.prepare('SELECT status FROM agent_work WHERE status = ?').all('stopped') as { status: string }[];
        expect(rows.length).to.equal(2);
      });

      it('should show empty message when no running executions', async () => {
        const output = await execInProcess('execution kill --all --machine');
        expect(output).to.contain('No running executions');
      });
    });

    describe('kill by agent with --agent', () => {
      it('should stop only executions for the specified agent', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'running');

        const output = await execInProcess('execution kill --agent agent-1 --machine');

        expect(output).to.contain('Stopping 1 execution(s)');

        const agent1 = db.prepare('SELECT status FROM agent_work WHERE agent_name = ?').get('agent-1') as { status: string };
        expect(agent1.status).to.equal('stopped');

        const agent2 = db.prepare('SELECT status FROM agent_work WHERE agent_name = ?').get('agent-2') as { status: string };
        expect(agent2.status).to.equal('running');
      });
    });

    describe('--json mode', () => {
      it('should output JSON prompt with active execution choices', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution kill --json');
        const json = extractJson<AgentPromptResponse>(output);

        expect(json).to.not.be.null;
        expect(json!.prompt.type).to.equal('list');
        expect(json!.prompt.name).to.equal('selectedId');
        expect(json!.prompt.message).to.include('Select execution to stop');
        expect(json!.prompt.choices.length).to.equal(1);
      });

      it('should include command field with execution ID in choices', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');

        const output = await execInProcess('execution kill --json');
        const json = extractJson<AgentPromptResponse>(output);

        const choice = json!.prompt.choices[0];
        // Note: The command in choices still references 'execution stop' since kill extends stop
        expect(choice.command).to.include('prlt execution');
        expect(choice.command).to.include('WORK-001');
        expect(choice.command).to.include('--json');
      });
    });

    describe('full agent workflow', () => {
      it('should complete: get prompt → select execution → kill → verify stopped', async () => {
        createExecution(db, 'TKT-001', 'agent-1', 'running');
        createExecution(db, 'TKT-002', 'agent-2', 'running');

        // Step 1: Agent requests execution selection
        const promptOutput = await execInProcess('execution kill --json');
        const prompt = extractJson<AgentPromptResponse>(promptOutput);
        expect(prompt).to.not.be.null;
        expect(prompt!.prompt.choices.length).to.equal(2);

        // Step 2: Agent picks WORK-001 specifically
        const selectedExec = findChoice(prompt!.prompt.choices, 'WORK-001');
        expect(selectedExec).to.exist;

        // Step 3: Agent executes the kill command (use execution kill directly)
        const killOutput = await execInProcess('execution kill WORK-001 --machine');

        // Step 4: Verify ONLY the selected execution was stopped
        expect(killOutput).to.contain('Stopped');
        expect(killOutput).to.contain('WORK-001');
        const stoppedRow = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-001') as { status: string };
        expect(stoppedRow.status).to.equal('stopped');
        // The other execution must remain running
        const untouchedRow = db.prepare('SELECT status FROM agent_work WHERE id = ?').get('WORK-002') as { status: string };
        expect(untouchedRow.status).to.equal('running');
      });
    });
  });
});

// =============================================================================
// Helper Functions
// =============================================================================

let executionCounter = 0;
function createExecution(
  db: Database.Database,
  ticketId: string,
  agentName: string,
  status: string,
  options: {
    executor?: string;
    environment?: string;
    display_mode?: string;
    permission_mode?: string;
    branch?: string;
    pid?: string;
    container_id?: string;
    session_id?: string;
    host?: string;
    log_path?: string;
  } = {}
): string {
  executionCounter++;
  const execId = `WORK-${String(executionCounter).padStart(3, '0')}`;

  db.prepare(`
    INSERT INTO agent_work (
      id, ticket_id, agent_name, status, executor,
      environment, display_mode, permission_mode, branch,
      pid, container_id, session_id, host, log_path
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    execId,
    ticketId,
    agentName,
    status,
    options.executor || 'claude-code',
    options.environment || 'host',
    options.display_mode || 'terminal',
    options.permission_mode || 'safe',
    options.branch || null,
    options.pid || null,
    options.container_id || null,
    options.session_id || null,
    options.host || null,
    options.log_path || null
  );

  return execId;
}
