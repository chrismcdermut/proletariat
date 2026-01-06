import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  getWorkspaceInfo,
  validateAgentNames,
  addAgentsToWorkspace
} from '../../lib/agents/commands.js';
import { ensureBuiltinThemes, BUILTIN_THEMES, isValidAgentName } from '../../lib/themes.js';
import {
  getTheme,
  getThemes,
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

      // Theme mode: pick from a specific theme
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
      // Interactive mode: show themes and available names
      else if (agentNames.length === 0) {
        // Ensure built-in themes are seeded
        ensureBuiltinThemes(workspaceInfo.path);

        // Get all themes with available names
        const themes = getThemes(workspaceInfo.path);
        const themesWithNames = themes.map(t => ({
          theme: t,
          names: getAvailableThemeNames(workspaceInfo.path, t.id)
        })).filter(t => t.names.length > 0);

        // Build choices: themes with their available names, plus custom option
        const choices: any[] = [];

        for (const { theme, names } of themesWithNames) {
          choices.push(new inquirer.Separator(`── ${theme.display_name} ──`));
          for (const name of names) {
            choices.push({ name: `  ${name}`, value: { name, themeId: theme.id } });
          }
        }

        choices.push(new inquirer.Separator('──────────────'));
        choices.push({ name: chalk.blue('Enter custom name(s)...'), value: '__custom__' });

        const { selection } = await inquirer.prompt([{
          type: 'checkbox',
          name: 'selection',
          message: 'Select agent names to add:',
          choices,
          pageSize: 20,
          validate: (input) => input.length > 0 || 'Please select at least one name or choose custom'
        }]);

        // Check if custom was selected
        const hasCustom = selection.some((s: any) => s === '__custom__');
        const themedSelections = selection.filter((s: any) => s !== '__custom__');

        if (hasCustom) {
          // Prompt for custom names
          const { customNames } = await inquirer.prompt([{
            type: 'input',
            name: 'customNames',
            message: 'Enter custom agent names (space-separated):',
            validate: (input: string) => {
              if (!input.trim()) return 'Please enter at least one name';
              const names = input.trim().split(/\s+/);
              const invalid = names.filter(n => !isValidAgentName(n));
              if (invalid.length > 0) {
                return `Invalid names: ${invalid.join(', ')}. Use lowercase alphanumeric with hyphens/underscores.`;
              }
              return true;
            }
          }]);
          agentNames = customNames.trim().split(/\s+/);
        }

        if (themedSelections.length > 0) {
          // Mark themed names as used and collect them
          for (const sel of themedSelections) {
            markThemeNameUsed(workspaceInfo.path, sel.themeId, sel.name);
            agentNames.push(sel.name);
          }
          // Use the first theme if all from same theme, otherwise no theme tracking
          const themeIds: string[] = themedSelections.map((s: any) => s.themeId);
          const uniqueThemes = [...new Set(themeIds)];
          if (uniqueThemes.length === 1) {
            themeId = uniqueThemes[0];
          }
        }

        if (agentNames.length === 0) {
          this.log(chalk.yellow('No agents specified.'));
          return;
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