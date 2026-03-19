import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import * as path from 'node:path';
import * as fs from 'node:fs';
import Database from 'better-sqlite3';
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
  outputSuccessAsJson,
  outputErrorAsJson,
  buildPromptConfig,
  createMetadata,
} from '../lib/prompt-json.js';
import {
  detectAITools,
  promptForPMOProvider,
  promptForAITool,
  PMO_PROVIDERS,
  saveHQPMOProvider,
  saveHQAITool,
  type PMOProviderValue,
} from '../lib/onboarding/index.js';
import { execSync } from 'node:child_process';

export default class New extends Command {
  static description = 'Create a new headquarters for managing repositories, agents, and projects';

  static examples = [
    // Human mode (interactive)
    '<%= config.bin %> <%= command.id %>',
    // Agent mode (JSON)
    '<%= config.bin %> <%= command.id %> --json --name myproject',
    '<%= config.bin %> <%= command.id %> --json --name myproject --path /path/to/hq --agents agent1,agent2 --pmo',
    '<%= config.bin %> <%= command.id %> --json --name myproject --provider linear --ai-tool claude-code',
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
    provider: Flags.string({
      description: 'PMO provider (linear, github, jira, asana, trello, monday, shortcut, none)',
    }),
    'ai-tool': Flags.string({
      description: 'AI tool preference (claude-code, codex)',
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

    // Step 1: Get HQ name
    const hqName = await promptForHQName();

    // Step 2: Determine location (always adds -hq suffix)
    const hqPath = await promptForHQLocation(hqName);

    // Step 3: Detect and select AI tool
    console.log(chalk.gray('\n  Detecting AI tools...\n'));
    const detection = detectAITools();
    const selectedAITool = await promptForAITool(detection);

    // Step 4: Select PMO provider
    console.log(chalk.blue('\n📋 Project management setup\n'));
    const selectedProvider = await promptForPMOProvider();

    // Step 5: Add agents (with theme options)
    const agentResult = await promptForAgentsWithTheme();

    // Step 6: Add repositories
    const repos = await promptForRepositories(process.cwd(), []);

    // Step 7: PMO setup (uses shared prompt from lib/pmo)
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

    // Store per-HQ config (pmoProvider + aiTool) in workspace_settings
    this.savePerHQConfig(hqPath, selectedProvider, selectedAITool);

    // Connect PMO provider if one was selected (not 'none')
    if (selectedProvider !== 'none') {
      await this.connectPMOProvider(hqPath, selectedProvider);
    }

    // Show next steps (includes offer to create ticket + spawn agent)
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
    provider?: string;
    'ai-tool'?: string;
  }): Promise<void> {
    const metadata = createMetadata('new', flags as Record<string, unknown>);

    // If --name not provided, output a prompt so agents can supply it
    if (!flags.name) {
      outputPromptAsJson(
        buildPromptConfig('input', 'name', 'Enter a name for your headquarters:', undefined, undefined),
        metadata,
      );
      return
    }

    const hqName = flags.name;

    // Check if HQ name is already in use
    if (hqName && isHQNameTaken(hqName)) {
      outputErrorAsJson(
        'HQ_NAME_TAKEN',
        `HQ name "${hqName}" is already in use on this machine. Pick another name.`,
        metadata,
      );
      return;
    }

    const hqPath = flags.path || path.resolve(`./${hqName}-hq`);

    // Validate HQ path is not inside a git repo
    const validation = validateHQLocation(hqPath);
    if (!validation.valid) {
      outputErrorAsJson(
        'INVALID_LOCATION',
        validation.reason === 'inside-git'
          ? 'Cannot create HQ inside a git repository'
          : 'Cannot create HQ inside another HQ',
        metadata,
      );
      return;
    }

    // Check if directory already exists
    if (fs.existsSync(hqPath)) {
      outputErrorAsJson('DIR_EXISTS', 'Directory already exists', metadata);
      return;
    }

    // If --provider not provided, output a prompt for it
    if (!flags.provider) {
      const providerChoices = PMO_PROVIDERS.map(p => ({
        name: p.name,
        value: p.value,
        command: `prlt new --json --name ${hqName} --provider ${p.value}${flags['ai-tool'] ? ` --ai-tool ${flags['ai-tool']}` : ''}`,
      }));
      outputPromptAsJson(
        buildPromptConfig('list', 'provider', 'Which project management tool do you use?', providerChoices),
        metadata,
      );
      return;
    }

    // Validate provider
    const validProviders = PMO_PROVIDERS.map(p => p.value);
    if (!validProviders.includes(flags.provider as PMOProviderValue)) {
      outputErrorAsJson(
        'INVALID_PROVIDER',
        `Invalid provider "${flags.provider}". Valid options: ${validProviders.join(', ')}`,
        metadata,
      );
      return;
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

      // Store per-HQ config
      const provider = flags.provider as PMOProviderValue;
      const aiToolFlag = flags['ai-tool'];

      const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
      if (fs.existsSync(dbPath)) {
        const db = new Database(dbPath);
        try {
          saveHQPMOProvider(db, provider, false);
          if (aiToolFlag) {
            const detection = detectAITools();
            const tool = detection.tools.find(t => t.name === aiToolFlag);
            if (tool) {
              saveHQAITool(db, tool.name, tool.command);
            } else {
              saveHQAITool(db, aiToolFlag, aiToolFlag);
            }
          }
        } finally {
          db.close();
        }
      }

      // Restore console.log
      console.log = originalLog;

      // Build provider info for JSON output
      const providerInfo = PMO_PROVIDERS.find(p => p.value === provider);

      // Output success JSON
      outputSuccessAsJson({
        hq: {
          name: hqName,
          path: hqPath,
          agents: selectedAgents,
          repos: repos.map(r => r.path),
          pmo: flags.pmo,
          pmoProvider: {
            provider,
            connected: false,
            connectCommand: providerInfo?.connectCommand ?? null,
          },
          aiTool: aiToolFlag ?? null,
        },
        nextSteps: provider !== 'none'
          ? [
              `cd ${hqPath}`,
              providerInfo?.connectCommand ?? `Connect your ${provider} integration`,
              'prlt repo add',
              'prlt ticket create --title "My first ticket"',
              'prlt work start TKT-1',
            ]
          : [
              `cd ${hqPath}`,
              'prlt repo add',
              'prlt ticket create --title "My first ticket"',
              'prlt work start TKT-1',
            ],
      }, metadata);
    } catch (error) {
      // Restore console.log on error
      console.log = originalLog;

      outputErrorAsJson(
        'HQ_CREATION_FAILED',
        error instanceof Error ? error.message : 'Unknown error',
        metadata,
      );
    }
  }

  /**
   * Save per-HQ config (pmoProvider + aiTool) to workspace_settings.
   */
  private savePerHQConfig(
    hqPath: string,
    provider: PMOProviderValue,
    aiTool: ReturnType<typeof detectAITools>['tools'][number] | null,
  ): void {
    const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
    if (!fs.existsSync(dbPath)) return;

    const db = new Database(dbPath);
    try {
      saveHQPMOProvider(db, provider, false);
      if (aiTool) {
        saveHQAITool(db, aiTool.name, aiTool.command);
      }
    } finally {
      db.close();
    }
  }

  /**
   * Attempt to connect the selected PMO provider after HQ creation.
   * Runs the provider's connect command interactively.
   */
  private async connectPMOProvider(hqPath: string, provider: PMOProviderValue): Promise<void> {
    const providerInfo = PMO_PROVIDERS.find(p => p.value === provider);
    if (!providerInfo || !providerInfo.connectCommand) return;

    console.log(chalk.blue(`\n🔗 Connecting ${providerInfo.name}...\n`));
    console.log(chalk.gray(`  API key URL: ${providerInfo.apiKeyUrl}`));
    console.log(chalk.gray(`  ${providerInfo.apiKeyInstructions}\n`));

    const connectChoices = [
      { name: `Connect ${providerInfo.name} now`, value: true },
      { name: 'Skip for now (connect later)', value: false },
    ];

    const { connectNow } = await inquirer.prompt([{
      type: 'list',
      name: 'connectNow',
      message: `Connect ${providerInfo.name}?`,
      choices: connectChoices,
    }]);

    if (!connectNow) {
      console.log(chalk.gray(`  You can connect later with: ${providerInfo.connectCommand}\n`));
      return;
    }

    try {
      // Run the connect command interactively from within the HQ directory
      execSync(providerInfo.connectCommand, {
        stdio: 'inherit',
        cwd: hqPath,
        env: { ...process.env },
      });

      // Update the connected status
      const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
      if (fs.existsSync(dbPath)) {
        const db = new Database(dbPath);
        try {
          saveHQPMOProvider(db, provider, true);
        } finally {
          db.close();
        }
      }

      console.log(chalk.green(`\n  ✓ ${providerInfo.name} connected!\n`));
    } catch {
      console.log(chalk.yellow(`\n  Could not connect ${providerInfo.name}. You can try again with: ${providerInfo.connectCommand}\n`));
    }
  }
}
