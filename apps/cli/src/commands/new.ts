import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
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
import {
  readMachineConfig,
  ensureMachineConfigDir,
} from '../lib/machine-config.js';
import {
  isFirstTimeUser,
  runOnboardingWizard,
  runOnboardingJsonMode,
  promptForPMOProvider,
  connectPMOProvider,
  PMO_PROVIDERS,
  detectAITools,
} from '../lib/onboarding/index.js';

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

    // Ensure machine config exists
    ensureMachineConfigDir();

    if (shouldOutputJson(flags)) {
      await this.runAgentMode(flags);
    } else {
      await this.runHumanMode(flags);
    }
  }

  /**
   * Human mode: interactive prompts with colored output.
   * For first-time users, runs the full onboarding flow including
   * AI tool detection and PMO provider connection.
   */
  private async runHumanMode(flags: { setup?: string }): Promise<void> {
    const config = readMachineConfig();
    const firstTime = isFirstTimeUser(config.headquarters.length, config.activeHeadquarters);

    if (firstTime) {
      // First-time user: run onboarding wizard (AI tool detection + choice)
      const result = await runOnboardingWizard();

      if (result.method === 'ai' && result.spawned) {
        // AI tool handled setup — we're done
        return;
      }

      if (result.method === 'ai' && !result.spawned) {
        // AI tool failed to spawn — fall through to manual
        console.log(chalk.gray('Continuing with manual setup...\n'));
      }

      // Manual setup: continue with the full onboarding flow below
    }

    console.log(chalk.blue('🚀 Creating a new headquarters...\n'));

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

    // Step 6: For first-time users, prompt to connect a cloud PMO provider
    if (firstTime) {
      await this.runPMOProviderSetup(hqPath);
    }

    // Show next steps
    await showNextSteps(options);

    // Step 7: For first-time users, offer to create a ticket and spawn an agent
    if (firstTime) {
      await this.offerFirstTicketAndAgent(hqPath);
    }
  }

  /**
   * Run PMO provider connection during onboarding.
   * Prompts user to select and connect a cloud PMO.
   */
  private async runPMOProviderSetup(hqPath: string): Promise<void> {
    const provider = await promptForPMOProvider();
    const connected = await connectPMOProvider(provider);

    if (!connected) {
      console.log(chalk.yellow('\n  PMO provider not connected yet.'));
      console.log(chalk.gray('  You can connect it anytime by running the connect command from within your HQ.\n'));
    }
  }

  /**
   * Offer the user to create their first ticket and spawn an agent.
   */
  private async offerFirstTicketAndAgent(hqPath: string): Promise<void> {
    const { wantTicket } = await inquirer.prompt([{
      type: 'list',
      name: 'wantTicket',
      message: 'Would you like to create your first ticket?',
      choices: [
        { name: 'Yes', value: true },
        { name: 'No, I\'ll do it later', value: false },
      ],
    }]);

    if (!wantTicket) {
      console.log(chalk.gray('\n  You can create tickets anytime with: prlt ticket create\n'));
      return;
    }

    // Spawn prlt ticket create interactively from the HQ directory
    const ticketCreated = await this.spawnInteractiveCommand('prlt', ['ticket', 'create'], hqPath);

    if (ticketCreated) {
      const { wantAgent } = await inquirer.prompt([{
        type: 'list',
        name: 'wantAgent',
        message: 'Would you like to spawn an agent on a ticket?',
        choices: [
          { name: 'Yes', value: true },
          { name: 'No, I\'ll do it later', value: false },
        ],
      }]);

      if (wantAgent) {
        await this.spawnInteractiveCommand('prlt', ['work', 'start'], hqPath);
      } else {
        console.log(chalk.gray('\n  You can spawn agents anytime with: prlt work start <ticket-id>\n'));
      }
    }
  }

  /**
   * Spawn a prlt subcommand interactively and wait for it to complete.
   */
  private spawnInteractiveCommand(cmd: string, args: string[], cwd: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        stdio: 'inherit',
        cwd,
        env: { ...process.env },
      });

      child.on('close', (code) => {
        resolve(code === 0);
      });

      child.on('error', () => {
        resolve(false);
      });
    });
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
    // Check if this is a first-time user requesting onboarding setup
    const config = readMachineConfig();
    const firstTime = isFirstTimeUser(config.headquarters.length, config.activeHeadquarters);

    if (firstTime && flags.setup) {
      // Delegate to onboarding JSON mode with the rich prompt
      runOnboardingJsonMode(flags);
      if (flags.setup !== 'manual') {
        return;
      }
      // Manual mode: fall through to HQ creation
    }

    // If --name not provided, output guidance including PMO provider info for first-time users
    if (!flags.name) {
      const promptConfig = buildPromptConfig('input', 'name', 'Enter a name for your headquarters:', undefined, undefined);
      const metadata = createMetadata('new', flags as Record<string, unknown>);

      if (firstTime) {
        // Include onboarding context in the prompt
        const detection = detectAITools();
        promptConfig.context = {
          firstTimeUser: true,
          detectedTools: detection.tools.map(t => ({
            name: t.name,
            command: t.command,
            displayName: t.displayName,
          })),
          pmoProviders: PMO_PROVIDERS.map(p => ({
            name: p.name,
            value: p.value,
            connectCommand: p.connectCommand,
            apiKeyUrl: p.apiKeyUrl,
            apiKeyInstructions: p.apiKeyInstructions,
          })),
          onboardingSteps: [
            'Create HQ with prlt new --json --name <name>',
            'cd into the new HQ directory',
            'Connect a cloud PMO provider (required): prlt linear connect / prlt asana connect / prlt monday connect / prlt trello configure',
            'Add a repository: prlt repo add <path-or-url>',
            'Create a ticket: prlt ticket create --title "..." --description "..."',
            'Spawn an agent: prlt work start <ticket-id>',
          ],
        };
      }

      outputPromptAsJson(promptConfig, metadata);
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

      // Output success JSON with onboarding context for first-time users
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
        result.onboarding = {
          firstTimeUser: true,
          nextSteps: [
            `cd ${hqPath}`,
            'Connect a cloud PMO provider (REQUIRED) — choose one:',
            ...PMO_PROVIDERS.map(p => `  ${p.connectCommand} — ${p.name}`),
            'prlt repo add <path-or-url> — Add a repository',
            'prlt ticket create — Create your first ticket',
            'prlt work start <ticket-id> — Spawn your first agent',
          ],
          pmoProviders: PMO_PROVIDERS.map(p => ({
            name: p.name,
            value: p.value,
            connectCommand: p.connectCommand,
            apiKeyUrl: p.apiKeyUrl,
            apiKeyInstructions: p.apiKeyInstructions,
          })),
        };
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
   * Output JSON to stdout
   */
  private outputJson(data: Record<string, unknown>): void {
    console.log(JSON.stringify(data, null, 2));
  }
}

