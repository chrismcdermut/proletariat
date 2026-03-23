import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as path from 'node:path';
import * as fs from 'node:fs';
import inquirer from 'inquirer';
import {
  promptForHQName,
  promptForHQLocation,
  initializeHQ,
  showNextSteps,
  validateHQLocation,
  isHQNameTaken,
} from '../lib/init/index.js';
import { promptForAgentsWithTheme } from '../lib/agents/index.js';
import { promptForRepositories } from '../lib/repos/index.js';
import { promptForPMOSetup, machineOutputFlags } from '../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  buildPromptConfig,
  createMetadata,
} from '../lib/prompt-json.js';
import { runOnboardingWizard } from '../lib/onboarding/wizard.js';

export default class New extends Command {
  static description = `Create a new headquarters (HQ) for managing repositories, agents, and projects.

An HQ is a workspace directory containing repos, agents, and a project board.
Setup can be done manually (step-by-step prompts) or with an AI agent (Claude Code or Codex).

After creation, cd into the HQ and connect your PMO provider:
  prlt linear connect   # or jira, asana, monday, trello, shortcut
Then spawn agents on tickets:
  prlt work implement TKT-1`;

  static examples = [
    // Human mode (interactive)
    '<%= config.bin %> <%= command.id %>',
    // Agent mode (JSON)
    '<%= config.bin %> <%= command.id %> --json --name myproject',
    '<%= config.bin %> <%= command.id %> --json --name myproject --path /path/to/hq --agents agent1,agent2 --pmo',
  ];

  static flags = {
    ...machineOutputFlags,
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
    pmo: Flags.boolean({
      description: 'Include PMO (Project Management Org)',
      default: true,
      allowNo: true,
    }),
    setup: Flags.string({
      description: 'Setup method: manual, claude-code, or codex',
      options: ['manual', 'claude-code', 'codex'],
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(New);

    if (shouldOutputJson(flags)) {
      await this.runAgentMode(flags);
    } else {
      await this.runHumanMode();
    }
  }

  /**
   * Human mode: interactive prompts with colored output
   */
  private async runHumanMode(): Promise<void> {
    console.log(chalk.blue('🚀 Creating a new headquarters...\n'));

    // Step 0: Choose setup method — agent-guided or manual
    const { setupMethod } = await inquirer.prompt([{
      type: 'list',
      name: 'setupMethod',
      message: 'How would you like to configure your HQ?',
      choices: [
        { name: 'Manual config (step-by-step prompts)', value: 'manual' },
        { name: 'Agent-guided config (AI walks you through setup)', value: 'agent' },
      ],
    }]);

    if (setupMethod === 'agent') {
      const result = await runOnboardingWizard();
      if (result.method === 'ai' && result.spawned) {
        // Agent completed setup — nothing else to do
        return;
      }
      if (result.method === 'ai' && !result.spawned) {
        // Agent failed to spawn — fall through to manual
        console.log(chalk.yellow('Falling back to manual setup...\n'));
      }
      // If result.method === 'manual', user chose manual in the wizard — continue below
    }

    // Manual config: step-by-step prompts

    // Step 1: Get HQ name
    const hqName = await promptForHQName();

    // Step 2: Determine location (always adds -hq suffix)
    const hqPath = await promptForHQLocation(hqName);

    // Step 3: Add agents (with theme options)
    const agentResult = await promptForAgentsWithTheme();

    // Step 4: Add repositories
    const repos = await promptForRepositories(process.cwd(), []);

    // Step 5: PMO setup (uses shared prompt from lib/pmo)
    const pmoSetup = await promptForPMOSetup(hqPath, hqName);

    // Create the options object
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

    // Initialize the HQ
    await initializeHQ(options);

    // Show next steps
    await showNextSteps(options);
  }

  /**
   * Agent mode: use flags, output JSON
   */
  private async runAgentMode(flags: {
    name?: string;
    path?: string;
    agents?: string;
    repos?: string;
    pmo: boolean;
    setup?: string;
  }): Promise<void> {
    // If --setup not provided, prompt for setup method first
    if (!flags.setup && !flags.name) {
      const { runOnboardingJsonMode } = await import('../lib/onboarding/wizard.js');
      runOnboardingJsonMode(flags as Record<string, unknown>);
      return;
    }

    // If agent-guided setup was chosen, handle it
    if (flags.setup && flags.setup !== 'manual') {
      const { runOnboardingJsonMode } = await import('../lib/onboarding/wizard.js');
      runOnboardingJsonMode({ ...flags, setup: flags.setup } as Record<string, unknown>);
      return;
    }

    // Manual setup: If --name not provided, output a prompt so agents can supply it
    if (!flags.name) {
      outputPromptAsJson(
        buildPromptConfig('input', 'name', 'Enter a name for your headquarters:', undefined, undefined),
        createMetadata('new', flags as Record<string, unknown>),
      );
      return
    }

    const hqName = flags.name;

    // Check if HQ name is already in use
    if (hqName && isHQNameTaken(hqName)) {
      this.outputJson({
        success: false,
        error: `HQ name "${hqName}" is already in use on this machine. Pick another name.`,
      });
      this.exit(1);
    }

    const hqPath = flags.path || path.resolve(`./${hqName}-hq`);

    // Validate HQ path is not inside a git repo
    if (!validateHQLocation(hqPath)) {
      this.outputJson({
        success: false,
        error: 'Cannot create HQ inside a git repository',
        path: hqPath,
      });
      this.exit(1);
    }

    // Check if directory already exists
    if (fs.existsSync(hqPath)) {
      this.outputJson({
        success: false,
        error: 'Directory already exists',
        path: hqPath,
      });
      this.exit(1);
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

    // Create options
    const options = {
      workspaceType: 'hq' as const,
      hqName,
      hqPath,
      selectedAgents,
      repos,
      quiet: true, // Suppress console output in JSON mode
      pmoSetup: {
        includePMO: flags.pmo,
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
      // Initialize the HQ
      await initializeHQ(options);

      // Restore console.log
      console.log = originalLog;

      // Output success JSON
      this.outputJson({
        success: true,
        hq: {
          name: hqName,
          path: hqPath,
          agents: selectedAgents,
          repos: repos.map(r => r.path),
          pmo: flags.pmo,
        },
      });
    } catch (error) {
      // Restore console.log on error
      console.log = originalLog;

      this.outputJson({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.exit(1);
    }
  }

  /**
   * Output JSON to stdout
   */
  private outputJson(data: Record<string, unknown>): void {
    console.log(JSON.stringify(data, null, 2));
  }
}
