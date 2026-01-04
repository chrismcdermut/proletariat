import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  getWorkspaceInfo,
  selectAgentsInteractively,
  validateAgentNames,
  addAgentsToWorkspace
} from '../../lib/agents/commands.js';
import { ensureBuiltinThemes, BUILTIN_THEMES } from '../../lib/themes.js';
import {
  getTheme,
  getAvailableThemeNames,
  markThemeNameUsed
} from '../../lib/database/index.js';

export default class Add extends Command {
  static description = 'Add new agents to the workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> zeus',
    '<%= config.bin %> <%= command.id %> agent-1 agent-2',
    '<%= config.bin %> <%= command.id %> --theme billionaires',
    '<%= config.bin %> <%= command.id %> my-agent --no-container',
  ];

  static args = {
    names: Args.string({
      description: 'Agent names to add (space-separated)',
      required: false,
    }),
  };

  static flags = {
    'no-container': Flags.boolean({
      description: 'Skip devcontainer setup (not recommended for autonomous agents)',
      default: false,
    }),
    theme: Flags.string({
      char: 't',
      description: 'Pick agent name(s) from a theme (billionaires, toyotas, companies, or custom)',
    }),
  };

  static strict = false; // Allow multiple agent names

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(Add);

    try {
      // Get workspace information
      const workspaceInfo = getWorkspaceInfo();

      let agentNames = argv as string[];
      let themeId: string | undefined;

      // Theme mode: pick from a theme
      if (flags.theme) {
        // Ensure built-in themes are seeded
        ensureBuiltinThemes(workspaceInfo.path);

        // Validate theme exists
        const theme = getTheme(workspaceInfo.path, flags.theme);
        if (!theme) {
          const available = BUILTIN_THEMES.map(t => t.name).join(', ');
          this.error(`Theme "${flags.theme}" not found. Available: ${available}`);
        }

        themeId = theme.id;

        // Get available names from theme
        const availableNames = getAvailableThemeNames(workspaceInfo.path, themeId);
        if (availableNames.length === 0) {
          this.error(`No available names in theme "${theme.display_name}". All names are in use.`);
        }

        // Interactive selection from theme
        const { selected } = await inquirer.prompt([{
          type: 'checkbox',
          name: 'selected',
          message: `Select agent names from ${theme.display_name}:`,
          choices: availableNames.map(name => ({ name, value: name })),
          validate: (input) => input.length > 0 || 'Please select at least one name'
        }]);

        agentNames = selected;

        // Mark selected names as used
        for (const name of agentNames) {
          markThemeNameUsed(workspaceInfo.path, themeId, name);
        }
      }
      // Non-theme mode: direct names or interactive
      else if (agentNames.length === 0) {
        try {
          agentNames = await selectAgentsInteractively(workspaceInfo, 'Enter agent names to add');
          if (agentNames.length === 0) {
            this.log(chalk.yellow('No agents specified.'));
            return;
          }
        } catch (error) {
          this.error(error instanceof Error ? error.message : String(error));
        }
      }

      // Validate agent names (skip for theme mode - already validated)
      if (!flags.theme) {
        const { valid, invalid } = validateAgentNames(agentNames);

        if (invalid.length > 0) {
          this.log(chalk.red(`Invalid agent names: ${invalid.join(', ')}`));
          this.log(chalk.yellow('Agent names must be lowercase alphanumeric with optional hyphens/underscores.'));
          if (valid.length === 0) {
            return;
          }
          this.log(chalk.blue(`Proceeding with valid agents: ${valid.join(', ')}`));
        }
        agentNames = valid;
      }

      // Add agents to workspace
      const addedAgents = await addAgentsToWorkspace(workspaceInfo, agentNames, {
        skipDevcontainer: flags['no-container'],
        themeId,
      });

      if (addedAgents.length === 0) {
        this.log(chalk.yellow('No new agents to add. All specified agents already exist.'));
        return;
      }

      this.log(chalk.green(`\n Successfully added ${addedAgents.length} agent(s): ${addedAgents.join(', ')}`));

      if (themeId) {
        const theme = getTheme(workspaceInfo.path, themeId);
        this.log(chalk.blue(`   From theme: ${theme?.display_name || themeId}`));
      }

      if (!flags['no-container']) {
        this.log(chalk.blue('   Devcontainer config created for sandboxed execution'));
      }

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}