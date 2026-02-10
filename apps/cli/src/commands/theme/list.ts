import { Command } from '@oclif/core';
import chalk from 'chalk';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { ensureBuiltinThemes } from '../../lib/themes.js';
import { getThemes, getThemeNames, getAvailableThemeNames } from '../../lib/database/index.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';

export default class ThemeList extends Command {
  static description = 'List available agent themes';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ThemeList);
    const jsonMode = shouldOutputJson(flags);

    try {
      const workspaceInfo = getWorkspaceInfo();

      // Ensure built-in themes are seeded
      ensureBuiltinThemes(workspaceInfo.path);

      const themes = getThemes(workspaceInfo.path);

      if (themes.length === 0) {
        if (jsonMode) {
          this.log(JSON.stringify([], null, 2));
          return;
        }
        this.log(chalk.yellow('No themes found.'));
        return;
      }

      if (jsonMode) {
        const themesWithNames = themes.map(theme => {
          const allNames = getThemeNames(workspaceInfo.path, theme.id);
          const availableNames = getAvailableThemeNames(workspaceInfo.path, theme.id);
          return {
            ...theme,
            availableNames: availableNames.length,
            inUse: allNames.length - availableNames.length,
            totalNames: allNames.length,
          };
        });
        this.log(JSON.stringify(themesWithNames, null, 2));
        return;
      }

      this.log(chalk.bold('\nAgent Themes\n'));

      for (const theme of themes) {
        const allNames = getThemeNames(workspaceInfo.path, theme.id);
        const availableNames = getAvailableThemeNames(workspaceInfo.path, theme.id);
        const inUse = allNames.length - availableNames.length;

        const builtinTag = theme.builtin ? chalk.gray(' [built-in]') : '';
        this.log(`  ${chalk.cyan(theme.display_name)}${builtinTag}`);
        this.log(chalk.gray(`    ID: ${theme.id}`));
        if (theme.description) {
          this.log(chalk.gray(`    ${theme.description}`));
        }
        this.log(chalk.gray(`    Names: ${chalk.green(availableNames.length + ' available')}, ${chalk.yellow(inUse + ' in use')}`));
        this.log('');
      }

      this.log(chalk.blue('Use: prlt staff add --theme <theme-id>'));

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
