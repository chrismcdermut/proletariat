import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as path from 'node:path';
import * as fs from 'node:fs';
import inquirer from 'inquirer';
import {
  promptForHQName,
  promptForHQLocation,
  initializeHQ,
  validateHQLocation,
  isHQNameTaken,
} from '../lib/init/index.js';
import { promptForAgentsWithTheme } from '../lib/agents/index.js';
import { promptForRepositories } from '../lib/repos/index.js';
import {
  promptForPMOSetup,
  machineOutputFlags,
  getStorageWithAutoSync,
  autoExportToBoard,
  determinePMOPath,
} from '../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  buildPromptConfig,
  createMetadata,
} from '../lib/prompt-json.js';
import {
  readMachineConfig,
  getRegisteredHeadquarters,
} from '../lib/machine-config.js';
import {
  checkExecutorOnHost,
  getExecutorDisplayName,
} from '../lib/execution/runners.js';
import { saveExecutionSetting } from '../lib/execution/config.js';
import { openWorkspaceDatabase } from '../lib/database/index.js';
import type { ExecutorType } from '../lib/execution/types.js';

/**
 * Detect which AI executor tools are installed on the host machine.
 */
function detectInstalledExecutors(): Array<{ type: ExecutorType; name: string }> {
  const executors: Array<{ type: ExecutorType; name: string }> = [];

  const claudeResult = checkExecutorOnHost('claude-code');
  if (claudeResult.ok) {
    executors.push({ type: 'claude-code', name: getExecutorDisplayName('claude-code') });
  }

  const codexResult = checkExecutorOnHost('codex');
  if (codexResult.ok) {
    executors.push({ type: 'codex', name: getExecutorDisplayName('codex') });
  }

  return executors;
}

export default class Onboard extends Command {
  static description = 'Guided first-run experience: detect tools, create HQ, and get started';

  static examples = [
    // Human mode (interactive wizard)
    '<%= config.bin %> <%= command.id %>',
    // Agent mode (JSON)
    '<%= config.bin %> <%= command.id %> --json --executor claude-code --name myproject',
    '<%= config.bin %> <%= command.id %> --json --executor claude-code --name myproject --path /path/to/hq --agents agent1,agent2',
  ];

  static flags = {
    ...machineOutputFlags,
    executor: Flags.string({
      description: 'AI executor to use (claude-code, codex)',
      char: 'e',
      options: ['claude-code', 'codex'],
    }),
    name: Flags.string({
      description: 'HQ name',
      char: 'n',
    }),
    path: Flags.string({
      description: 'HQ path (defaults to ./{name}-hq)',
      char: 'p',
    }),
    agents: Flags.string({
      description: 'Comma-separated list of agent names',
      char: 'a',
    }),
    repos: Flags.string({
      description: 'Comma-separated list of repository paths to clone/move',
      char: 'r',
    }),
    'sample-ticket': Flags.boolean({
      description: 'Create a sample ticket during onboarding',
      default: true,
      allowNo: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Onboard);

    if (shouldOutputJson(flags)) {
      await this.runAgentMode(flags);
    } else {
      await this.runHumanMode();
    }
  }

  /**
   * Human mode: interactive wizard with colored output
   */
  private async runHumanMode(): Promise<void> {
    // Welcome banner
    console.log('');
    console.log(chalk.bold.blue('  Welcome to Proletariat'));
    console.log(chalk.gray('  Let\'s get your headquarters set up.\n'));

    // Check if user already has an HQ
    const existingHQs = getRegisteredHeadquarters();
    if (existingHQs.length > 0) {
      console.log(chalk.yellow(`  You already have ${existingHQs.length} headquarters registered.`));
      const { continueSetup } = await inquirer.prompt([{
        type: 'list',
        name: 'continueSetup',
        message: 'Create another headquarters?',
        choices: [
          { name: 'Yes - set up a new headquarters', value: true },
          { name: 'No - exit', value: false },
        ],
      }]);

      if (!continueSetup) {
        console.log(chalk.gray('\n  Run `prlt new` anytime to create a new HQ.'));
        return;
      }
    }

    // Step 1: Detect AI tools
    console.log(chalk.cyan('  Step 1/5: Detecting AI tools...\n'));
    const detectedExecutors = detectInstalledExecutors();

    let selectedExecutor: ExecutorType;

    if (detectedExecutors.length === 0) {
      console.log(chalk.yellow('  No AI coding tools detected.'));
      console.log(chalk.gray('  Install one of the following:'));
      console.log(chalk.gray('    - Claude Code: npm install -g @anthropic-ai/claude-code'));
      console.log(chalk.gray('    - Codex:       npm install -g @openai/codex\n'));

      const { manualExecutor } = await inquirer.prompt([{
        type: 'list',
        name: 'manualExecutor',
        message: 'Which tool will you use?',
        choices: [
          { name: 'Claude Code (will install later)', value: 'claude-code' },
          { name: 'Codex (will install later)', value: 'codex' },
        ],
      }]);
      selectedExecutor = manualExecutor;
    } else if (detectedExecutors.length === 1) {
      selectedExecutor = detectedExecutors[0].type;
      console.log(chalk.green(`  Found: ${detectedExecutors[0].name}`));
      console.log(chalk.gray(`  Using ${detectedExecutors[0].name} as your AI executor.\n`));
    } else {
      console.log(chalk.green('  Found multiple AI tools:'));
      for (const executor of detectedExecutors) {
        console.log(chalk.green(`    - ${executor.name}`));
      }
      console.log('');

      const { chosenExecutor } = await inquirer.prompt([{
        type: 'list',
        name: 'chosenExecutor',
        message: 'Which tool should agents use?',
        choices: detectedExecutors.map(e => ({
          name: e.name,
          value: e.type,
        })),
      }]);
      selectedExecutor = chosenExecutor;
    }

    // Step 2: Create HQ
    console.log(chalk.cyan('\n  Step 2/5: Create your headquarters\n'));

    const hqName = await promptForHQName();
    const hqPath = await promptForHQLocation(hqName);

    // Step 3: Add agents and repos
    console.log(chalk.cyan('\n  Step 3/5: Configure agents\n'));

    const agentResult = await promptForAgentsWithTheme();

    console.log(chalk.cyan('\n  Step 4/5: Add repositories\n'));

    const repos = await promptForRepositories(process.cwd(), []);

    // PMO setup (always included)
    const pmoSetup = await promptForPMOSetup(hqPath, hqName);

    // Create the HQ
    const options = {
      workspaceType: 'hq' as const,
      hqName,
      hqPath,
      selectedAgents: agentResult.agents,
      repos,
      pmoSetup,
      themeId: agentResult.themeId,
      customTheme: agentResult.customTheme,
    };

    await initializeHQ(options);

    // Save executor preference to the workspace database
    try {
      const db = openWorkspaceDatabase(hqPath);
      saveExecutionSetting(db, 'defaultExecutor', selectedExecutor);
      db.close();
    } catch {
      // Non-fatal: executor preference can be set later
    }

    // Step 5: Create sample ticket and show guidance
    console.log(chalk.cyan('\n  Step 5/5: Getting you started\n'));

    let sampleTicketId: string | null = null;
    if (pmoSetup.includePMO) {
      const { createSample } = await inquirer.prompt([{
        type: 'list',
        name: 'createSample',
        message: 'Create a sample ticket to try out the workflow?',
        choices: [
          { name: 'Yes', value: true },
          { name: 'No', value: false },
        ],
      }]);

      if (createSample) {
        sampleTicketId = await this.createSampleTicket(hqPath, pmoSetup.boardName);
      }
    }

    // Show final guidance
    this.showGuidance(hqPath, hqName, selectedExecutor, sampleTicketId);
  }

  /**
   * Agent mode: use flags, output JSON
   */
  private async runAgentMode(flags: {
    executor?: string;
    name?: string;
    path?: string;
    agents?: string;
    repos?: string;
    'sample-ticket': boolean;
  }): Promise<void> {
    const metadata = createMetadata('onboard', flags as Record<string, unknown>);

    // Detect available executors for context
    const detectedExecutors = detectInstalledExecutors();

    // Require --executor
    if (!flags.executor) {
      const executorChoices = [
        { name: 'Claude Code', value: 'claude-code' },
        { name: 'Codex', value: 'codex' },
      ];

      // Mark detected executors
      for (const choice of executorChoices) {
        const isDetected = detectedExecutors.some(e => e.type === choice.value);
        if (isDetected) {
          choice.name += ' (detected)';
        }
      }

      outputPromptAsJson(
        buildPromptConfig('list', 'executor', 'Select AI executor:', executorChoices),
        metadata,
      );
    }

    // Require --name
    if (!flags.name) {
      outputPromptAsJson(
        buildPromptConfig('input', 'name', 'Enter a name for your headquarters:'),
        metadata,
      );
    }

    const hqName = flags.name;
    const selectedExecutor = flags.executor as ExecutorType;

    // Validate HQ name
    if (hqName && isHQNameTaken(hqName)) {
      outputErrorAsJson(
        'HQ_NAME_TAKEN',
        `HQ name "${hqName}" is already in use on this machine. Pick another name.`,
        metadata,
      );
    }

    const hqPath = flags.path || path.resolve(`./${hqName}-hq`);

    // Validate HQ path
    const validation = validateHQLocation(hqPath);
    if (!validation.valid) {
      const reason = validation.reason === 'inside-git'
        ? 'Cannot create HQ inside a git repository'
        : 'Cannot create HQ inside another HQ';
      outputErrorAsJson('INVALID_LOCATION', reason, metadata);
    }

    if (fs.existsSync(hqPath)) {
      outputErrorAsJson('PATH_EXISTS', `Directory already exists: ${hqPath}`, metadata);
    }

    // Parse agents
    const selectedAgents = flags.agents
      ? flags.agents.split(',').map(a => a.trim()).filter(Boolean)
      : [];

    // Parse repos
    const repos = flags.repos
      ? flags.repos.split(',').map(r => ({
          path: r.trim(),
          action: 'clone' as const,
        })).filter(r => r.path)
      : [];

    // Create HQ
    const options = {
      workspaceType: 'hq' as const,
      hqName,
      hqPath,
      selectedAgents,
      repos,
      quiet: true,
      pmoSetup: {
        includePMO: true,
        location: 'separate' as const,
        boardTemplate: 'default',
        boardName: `${hqName}-kanban`,
        columns: ['Backlog', 'In Progress', 'Review', 'Done'],
        storageType: 'sqlite' as const,
      },
    };

    // Suppress console output in JSON mode
    const originalLog = console.log;
    console.log = () => {};

    try {
      await initializeHQ(options);
      console.log = originalLog;

      // Save executor preference
      try {
        const db = openWorkspaceDatabase(hqPath);
        saveExecutionSetting(db, 'defaultExecutor', selectedExecutor);
        db.close();
      } catch {
        // Non-fatal
      }

      // Create sample ticket if requested
      let sampleTicketId: string | null = null;
      if (flags['sample-ticket']) {
        console.log = () => {};
        sampleTicketId = await this.createSampleTicket(hqPath, `${hqName}-kanban`);
        console.log = originalLog;
      }

      outputSuccessAsJson({
        hq: {
          name: hqName,
          path: hqPath,
          agents: selectedAgents,
          repos: repos.map(r => r.path),
        },
        executor: selectedExecutor,
        sampleTicketId,
        nextSteps: {
          navigate: `cd ${hqPath}`,
          createTicket: 'prlt ticket create',
          spawnAgent: 'prlt work start <ticket-id>',
          viewBoard: 'prlt board',
        },
      }, metadata);
    } catch (error) {
      console.log = originalLog;
      outputErrorAsJson(
        'ONBOARD_FAILED',
        error instanceof Error ? error.message : 'Unknown error during onboarding',
        metadata,
      );
    }
  }

  /**
   * Create a sample ticket in the PMO
   */
  private async createSampleTicket(hqPath: string, boardName: string): Promise<string | null> {
    try {
      const pmoPath = determinePMOPath(hqPath, 'separate');
      const storage = getStorageWithAutoSync(pmoPath, 'sqlite');

      // Find the project (board)
      const projects = await storage.listProjects();
      const project = projects.find(p => p.name === boardName) || projects[0];
      if (!project) return null;

      // Create a sample ticket
      const ticket = await storage.createTicket(project.id, {
        title: 'Hello World - your first ticket',
        description: 'This is a sample ticket created during onboarding. Try assigning an agent to work on it with `prlt work start` or delete it and create your own tickets.',
        priority: 'P2',
        category: 'feature',
      });

      // Export to board markdown
      await autoExportToBoard(pmoPath, storage);

      return ticket.id;
    } catch {
      // Non-fatal: sample ticket creation is optional
      return null;
    }
  }

  /**
   * Show guidance and next steps after setup
   */
  private showGuidance(hqPath: string, hqName: string, executor: ExecutorType, sampleTicketId: string | null): void {
    const relativePath = path.relative(process.cwd(), hqPath);
    const executorName = getExecutorDisplayName(executor);

    console.log(chalk.bold.green('\n  Setup complete!\n'));

    console.log(chalk.white('  Your headquarters is ready. Here\'s what to do next:\n'));

    // Navigate to HQ
    console.log(chalk.cyan('  1. Navigate to your HQ:'));
    console.log(chalk.yellow(`     cd ${relativePath}\n`));

    // Create a ticket
    if (sampleTicketId) {
      console.log(chalk.cyan('  2. Check out your sample ticket:'));
      console.log(chalk.yellow(`     prlt ticket show ${sampleTicketId}\n`));

      console.log(chalk.cyan('  3. Spawn an agent to work on it:'));
      console.log(chalk.yellow(`     prlt work start ${sampleTicketId}\n`));
    } else {
      console.log(chalk.cyan('  2. Create a ticket:'));
      console.log(chalk.yellow('     prlt ticket create\n'));

      console.log(chalk.cyan('  3. Spawn an agent to work on it:'));
      console.log(chalk.yellow('     prlt work start <ticket-id>\n'));
    }

    // Monitor
    console.log(chalk.cyan('  4. Monitor your agents:'));
    console.log(chalk.yellow('     prlt board'));
    console.log(chalk.yellow('     prlt session list\n'));

    console.log(chalk.gray(`  Executor: ${executorName}`));
    console.log(chalk.gray(`  HQ: ${hqPath}\n`));
  }
}
