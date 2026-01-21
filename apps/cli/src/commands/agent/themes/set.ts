import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { getWorkspaceInfo } from '../../../lib/agents/commands.js';
import { ensureBuiltinThemes } from '../../../lib/themes.js';
import { getThemes, getAvailableThemeNames, setActiveTheme, getActiveTheme } from '../../../lib/database/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class ThemesSet extends Command {
  static description = 'Set the active theme for this workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> billionaires',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    theme: Args.string({
      description: 'Theme ID to set as active',
      required: false,
    }),
  };

  static flags = {
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ThemesSet);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    try {
      const workspaceInfo = getWorkspaceInfo();
      ensureBuiltinThemes(workspaceInfo.path);

      let themeId = args.theme;

      if (!themeId) {
        // Interactive selection
        const themes = getThemes(workspaceInfo.path);
        const currentTheme = getActiveTheme(workspaceInfo.path);

        // In JSON mode, output theme selection prompt
        if (jsonMode) {
          const themeChoices = themes.map(t => {
            const availableCount = getAvailableThemeNames(workspaceInfo.path, t.id).length;
            const isCurrent = currentTheme?.id === t.id;
            return {
              name: `${t.display_name} (${availableCount} available)${isCurrent ? ' ✓ current' : ''}`,
              value: t.id
            };
          });
          outputPromptAsJson(
            buildPromptConfig('list', 'theme', 'Select theme for this workspace:', themeChoices),
            createMetadata('agent themes set', flags)
          );
          return;
        }

        const choices = themes.map(t => {
          const availableCount = getAvailableThemeNames(workspaceInfo.path, t.id).length;
          const isCurrent = currentTheme?.id === t.id;
          return {
            name: `${t.display_name} ${chalk.dim(`(${availableCount} available)`)}${isCurrent ? chalk.green(' ✓ current') : ''}`,
            value: t.id
          };
        });

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select theme for this workspace:',
          choices
        }]);

        themeId = selected;
      }

      setActiveTheme(workspaceInfo.path, themeId!);

      const themes = getThemes(workspaceInfo.path);
      const theme = themes.find(t => t.id === themeId);

      this.log(chalk.green(`\n✓ Active theme set to: ${theme?.display_name || themeId}`));
      this.log(chalk.dim('  New agents will be selected from this theme.'));

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
