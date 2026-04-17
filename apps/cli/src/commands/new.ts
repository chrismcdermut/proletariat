import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  promptForHQName,
  promptForHQLocation,
  initializeHQ,
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
import {
  isFirstTimeUser,
  detectAITools,
  runOnboardingWizard,
  runOnboardingJsonMode,
} from '../lib/onboarding/index.js';
import {
  readMachineConfig,
  ensureMachineConfigDir,
} from '../lib/machine-config.js';
import { findHQRoot } from '../lib/workspace.js';

export default class New extends Command {
  static description = 'Create a new headquarters for managing repositories, agents, and projects';

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
      description: 'Setup method for agent-driven onboarding (claude-code, codex, or manual)',
      options: ['claude-code', 'codex', 'manual'],
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(New);

    if (shouldOutputJson(flags)) {
      await this.runAgentMode(flags);
    } else {
      await this.runHumanMode(flags);
    }
  }

  /**
   * Detect whether this is the user's first time (no HQ exists anywhere).
   */
  private detectFirstTime(): boolean {
    ensureMachineConfigDir();
    const config = readMachineConfig();
    const currentHQ = findHQRoot();
    return isFirstTimeUser(config.headquarters.length, currentHQ);
  }

  /**
   * Human mode: interactive prompts with colored output.
   * If first-time user, shows welcome + explainer before setup prompts.
   * If returning user, goes straight to setup (power user flow).
   */
  private async runHumanMode(flags: { setup?: string }): Promise<void> {
    const firstTime = this.detectFirstTime();

    if (firstTime) {
      await this.runFirstTimeHumanMode(flags);
    } else {
      await this.runReturningHumanMode();
    }
  }

  /**
   * First-time user flow: welcome, explainer, setup method choice, then HQ creation.
   */
  private async runFirstTimeHumanMode(_flags: { setup?: string }): Promise<void> {
    // Step 1: Welcome + explainer
    const result = await runOnboardingWizard();

    if (result.method === 'ai') {
      // AI tool was spawned — it will guide the user through prlt new
      return;
    }

    // Manual: continue with HQ creation prompts
    console.log(chalk.blue('\n🚀 Let\'s set up your first workspace.\n'));

    await this.createHQ();
  }

  /**
   * Returning user flow: straight to HQ creation (power user mode).
   */
  private async runReturningHumanMode(): Promise<void> {
    console.log(chalk.blue('🚀 Creating a new headquarters...\n'));
    await this.createHQ();
  }

  /**
   * Shared HQ creation flow (used by both first-time and returning user).
   */
  private async createHQ(): Promise<void> {
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
    this.showNextSteps(hqPath);
  }

  /**
   * Show what to do next after HQ creation.
   */
  private showNextSteps(hqPath: string): void {
    const relativePath = path.relative(process.cwd(), hqPath);

    console.log(chalk.green('\n✨ Your workspace is ready!\n'));
    console.log(chalk.white('Here\'s what to do next:\n'));
    console.log(chalk.yellow(`  cd ${relativePath}`));
    console.log(chalk.gray('  Navigate into your new HQ\n'));
    console.log(chalk.yellow('  prlt work start TICKET-ID'));
    console.log(chalk.gray('  Spawn an agent on a ticket\n'));
    console.log(chalk.yellow('  prlt session list'));
    console.log(chalk.gray('  See running agents\n'));
    console.log(chalk.yellow('  prlt work peek AGENT'));
    console.log(chalk.gray('  Watch an agent work\n'));
  }

  /**
   * Agent mode: use flags, output JSON.
   * For first-time users without --name, includes onboarding context.
   */
  private async runAgentMode(flags: {
    name?: string;
    path?: string;
    agents?: string;
    repos?: string;
    pmo: boolean;
    setup?: string;
  }): Promise<void> {
    const firstTime = this.detectFirstTime();

    // Handle --setup flag for first-time agent-driven onboarding
    if (firstTime && flags.setup) {
      runOnboardingJsonMode(flags as Record<string, unknown>);
      // If runOnboardingJsonMode returns (manual mode), fall through to normal flow
    }

    // If --name not provided, output a prompt so agents can supply it
    if (!flags.name) {
      if (firstTime) {
        // First-time user in JSON mode — include onboarding context
        this.outputFirstTimeJsonPrompt(flags);
      } else {
        outputPromptAsJson(
          buildPromptConfig('input', 'name', 'Enter a name for your headquarters:'),
          createMetadata('new', flags as Record<string, unknown>),
        );
      }
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
      const result: Record<string, unknown> = {
        success: true,
        hq: {
          name: hqName,
          path: hqPath,
          agents: selectedAgents,
          repos: repos.map(r => r.path),
          pmo: flags.pmo,
        },
      };

      if (firstTime) {
        result.firstTimeUser = true;
        result.nextSteps = [
          { command: `cd ${path.relative(process.cwd(), hqPath) || hqPath}`, description: 'Navigate into your new HQ' },
          { command: 'prlt work start TICKET-ID', description: 'Spawn an agent on a ticket' },
          { command: 'prlt session list', description: 'See running agents' },
          { command: 'prlt work peek AGENT', description: 'Watch an agent work' },
        ];
      }

      this.outputJson(result);
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
   * Output first-time user JSON prompt with model-friendly context.
   */
  private outputFirstTimeJsonPrompt(flags: Record<string, unknown>): void {
    const detection = detectAITools();
    const metadata = createMetadata('new', flags);

    const output = {
      type: 'prompt' as const,
      firstTimeUser: true,
      onboarding: {
        welcome: 'Welcome to Proletariat — AI agent orchestration.',
        whatIsHQ: 'An HQ (headquarters) is a workspace that manages your repositories, AI agents, and project tracking. It is the central hub for orchestrating AI coding agents across your projects.',
        prerequisites: [
          'Docker running (for agent execution)',
          'A PMO account or local project tracking setup',
        ],
        fullLoop: [
          'Create an HQ workspace (prlt new --json --name YOUR_NAME)',
          'Connect a repository (prlt repo add PATH_OR_URL)',
          'Connect a PMO provider (prlt linear connect / prlt asana connect)',
          'Spawn an agent on a ticket (prlt work start TICKET-ID)',
          'Get a pull request from the agent',
        ],
      },
      prompt: {
        type: 'input',
        name: 'name',
        message: 'Enter a name for your headquarters:',
      },
      detectedTools: detection.tools.map(t => ({
        name: t.name,
        command: t.command,
        displayName: t.displayName,
      })),
      setupChoices: [
        ...(detection.hasClaudeCode ? [{ name: 'Claude Code guided setup', value: 'claude-code', command: 'prlt new --json --setup claude-code' }] : []),
        ...(detection.hasCodex ? [{ name: 'Codex guided setup', value: 'codex', command: 'prlt new --json --setup codex' }] : []),
        { name: 'Manual setup', value: 'manual', command: 'prlt new --json --name YOUR_NAME' },
      ],
      metadata,
    };

    console.log(JSON.stringify(output, null, 2));
  }

  /**
   * Output JSON to stdout
   */
  private outputJson(data: Record<string, unknown>): void {
    console.log(JSON.stringify(data, null, 2));
  }
}
