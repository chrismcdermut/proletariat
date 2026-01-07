import { Command } from '@oclif/core';
import chalk from 'chalk';
import { getWorkspaceInfo } from '../../../lib/agents/commands.js';
import { ensureBuiltinThemes } from '../../../lib/themes.js';
import { getThemes, getThemeNames } from '../../../lib/database/index.js';

export default class ThemesList extends Command {
  static description = 'List available agent themes';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    try {
      const workspaceInfo = getWorkspaceInfo();

      // Ensure built-in themes are seeded
      ensureBuiltinThemes(workspaceInfo.path);

      const themes = getThemes(workspaceInfo.path);

      if (themes.length === 0) {
        this.log(chalk.yellow('No themes found.'));
        return;
      }

      this.log(chalk.bold('\nAgent Themes\n'));

      for (const theme of themes) {
        const names = getThemeNames(workspaceInfo.path, theme.id);
        const available = names.filter(n => !n.used).length;
        const used = names.filter(n => n.used).length;

        const builtinTag = theme.builtin ? chalk.gray(' [built-in]') : '';
        this.log(`  ${chalk.cyan(theme.display_name)}${builtinTag}`);
        this.log(chalk.gray(`    ID: ${theme.id}`));
        if (theme.description) {
          this.log(chalk.gray(`    ${theme.description}`));
        }
        this.log(chalk.gray(`    Names: ${chalk.green(available + ' available')}, ${chalk.yellow(used + ' in use')}`));
        this.log('');
      }

      this.log(chalk.blue('Use: prlt agents add --theme <theme-id>'));

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
