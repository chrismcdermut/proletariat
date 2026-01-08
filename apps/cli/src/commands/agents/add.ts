import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  getWorkspaceInfo,
  validateAgentNames,
  addAgentsToWorkspace
} from '../../lib/agents/commands.js';
import { ensureBuiltinThemes, BUILTIN_THEMES, isValidAgentName, normalizeAgentName } from '../../lib/themes.js';
import {
  getTheme,
  getThemes,
  getAvailableThemeNames,
  markThemeNameUsed,
  getActiveTheme
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
      // Interactive mode: show names from workspace's active theme
      else if (agentNames.length === 0) {
        // Ensure built-in themes are seeded
        ensureBuiltinThemes(workspaceInfo.path);

        // Check if workspace has an active theme
        const activeTheme = getActiveTheme(workspaceInfo.path);

        if (activeTheme) {
          // Workspace has a theme - show names from it directly
          themeId = activeTheme.id;
          const availableNames = getAvailableThemeNames(workspaceInfo.path, activeTheme.id);

          if (availableNames.length === 0) {
            this.log(chalk.yellow(`No available names in ${activeTheme.display_name}. All names are in use.`));
            this.log(chalk.blue('Use --theme to pick from a different theme, or enter names directly.'));
            return;
          }

          // Add custom option at the end
          const choices = [
            ...availableNames.map(name => ({ name, value: name })),
            new inquirer.Separator(),
            { name: chalk.blue('Enter custom name(s)...'), value: '__custom__' }
          ];

          const { selected } = await inquirer.prompt([{
            type: 'checkbox',
            name: 'selected',
            message: `Select agents from ${activeTheme.display_name}:`,
            choices,
            pageSize: 20,
            validate: (input) => input.length > 0 || 'Please select at least one name'
          }]);

          // Check if custom was selected
          const hasCustom = selected.includes('__custom__');
          const themedSelections = selected.filter((s: string) => s !== '__custom__');

          if (hasCustom) {
            const { customNames } = await inquirer.prompt([{
              type: 'input',
              name: 'customNames',
              message: 'Enter custom agent names (space-separated):',
              validate: (input: string) => {
                if (!input.trim()) return 'Please enter at least one name';
                return true;
              }
            }]);
            const rawNames = customNames.trim().split(/\s+/);
            const normalizedCustom = rawNames.map((n: string) => normalizeAgentName(n)).filter((n: string) => n && isValidAgentName(n));
            agentNames.push(...normalizedCustom);
          }

          if (themedSelections.length > 0) {
            agentNames.push(...themedSelections);
            // Mark themed names as used
            for (const name of themedSelections) {
              markThemeNameUsed(workspaceInfo.path, activeTheme.id, name);
            }
          }
        } else {
          // No active theme - prompt to pick one or enter custom names
          const themes = getThemes(workspaceInfo.path);
          const themesWithNames = themes.map(t => ({
            theme: t,
            availableCount: getAvailableThemeNames(workspaceInfo.path, t.id).length
          })).filter(t => t.availableCount > 0);

          // Build theme selection choices
          const themeChoices: any[] = themesWithNames.map(({ theme, availableCount }) => ({
            name: `${theme.display_name} ${chalk.dim(`(${availableCount} available)`)}`,
            value: theme.id
          }));
          themeChoices.push(new inquirer.Separator());
          themeChoices.push({ name: chalk.blue('Enter custom name(s)'), value: '__custom__' });

          const { selectedTheme } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedTheme',
            message: 'No theme set. Select a theme or enter custom names:',
            choices: themeChoices
          }]);

          if (selectedTheme === '__custom__') {
            const { customNames } = await inquirer.prompt([{
              type: 'input',
              name: 'customNames',
              message: 'Enter custom agent names (space-separated):',
              validate: (input: string) => {
                if (!input.trim()) return 'Please enter at least one name';
                return true;
              }
            }]);
            const rawNames = customNames.trim().split(/\s+/);
            const normalizedCustom = rawNames.map((n: string) => ({
              original: n,
              normalized: normalizeAgentName(n)
            })).filter((x: { original: string; normalized: string }) => x.normalized && isValidAgentName(x.normalized));

            const changed = normalizedCustom.filter((x: { original: string; normalized: string }) => x.original !== x.normalized);
            if (changed.length > 0) {
              this.log(chalk.blue('Normalized names:'));
              for (const { original, normalized } of changed) {
                this.log(chalk.dim(`   ${original} → ${normalized}`));
              }
            }

            agentNames = normalizedCustom.map((x: { original: string; normalized: string }) => x.normalized);
          } else {
            themeId = selectedTheme;
            const theme = getTheme(workspaceInfo.path, selectedTheme);
            const availableNames = getAvailableThemeNames(workspaceInfo.path, selectedTheme);

            const { selected } = await inquirer.prompt([{
              type: 'checkbox',
              name: 'selected',
              message: `Select agents from ${theme?.display_name}:`,
              choices: availableNames.map(name => ({ name, value: name })),
              pageSize: 20,
              validate: (input) => input.length > 0 || 'Please select at least one name'
            }]);

            agentNames = selected;

            for (const name of agentNames) {
              markThemeNameUsed(workspaceInfo.path, selectedTheme, name);
            }
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