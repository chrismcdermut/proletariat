import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  promptForHQName,
  promptForHQLocation,
  initializeHQ,
  showNextSteps,
  validateHQLocation
} from '../lib/init/index.js';
import { promptForAgentsWithTheme } from '../lib/agents/index.js';
import { promptForRepositories } from '../lib/repos/index.js';
import { promptForPMOSetup } from '../lib/pmo/index.js';

export default class Init extends Command {
  static description = 'Initialize an HQ (headquarters) for managing repositories, agents, and projects';

  static examples = [
    // Human mode (interactive)
    '<%= config.bin %> <%= command.id %>',
    // Agent mode (JSON)
    '<%= config.bin %> <%= command.id %> --json --name myproject',
    '<%= config.bin %> <%= command.id %> --json --name myproject --path /path/to/hq --agents agent1,agent2 --pmo',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Agent mode: use flags instead of prompts, output JSON',
      default: false,
    }),
    name: Flags.string({
      description: 'HQ name (required in --json mode)',
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
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);

    if (flags.json) {
      await this.runAgentMode(flags);
    } else if (!process.stdin.isTTY) {
      // Non-interactive environment (likely an AI agent)
      // Output guidance as JSON
      this.outputJson({
        success: false,
        error: 'Interactive mode requires a TTY. Use --json flag for agent mode.',
        hint: 'Run: prlt init --json --name <hq-name> [--path <path>] [--agents a1,a2] [--no-pmo]',
        flags: {
          '--json': 'Enable agent mode with JSON output',
          '--name, -n': 'HQ name (required)',
          '--path, -p': 'HQ path (defaults to ./{name}-hq)',
          '--agents, -a': 'Comma-separated agent names',
          '--repos, -r': 'Comma-separated repo paths',
          '--pmo/--no-pmo': 'Include PMO (default: true)',
        },
      });
      this.exit(1);
    } else {
      await this.runHumanMode();
    }
  }

  /**
   * Human mode: interactive prompts with colored output
   */
  private async runHumanMode(): Promise<void> {
    console.log(chalk.blue('🚀 Welcome to Proletariat...\n'));
    console.log(chalk.blue('🏢 Setting up your headquarters...\n'));

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
  }): Promise<void> {
    // Validate required fields
    if (!flags.name) {
      this.outputJson({
        success: false,
        error: 'Missing required flag: --name',
      });
      this.exit(1);
    }

    const hqName = flags.name;
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

    try {
      // Suppress console output in JSON mode
      const originalLog = console.log;
      console.log = () => {};

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
      console.log = console.log;

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
