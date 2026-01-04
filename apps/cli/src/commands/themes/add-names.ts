import { Command, Args } from '@oclif/core';
import chalk from 'chalk';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { isValidAgentName } from '../../lib/themes.js';
import { getTheme, addThemeNames, getThemeNames } from '../../lib/database/index.js';

export default class ThemesAddNames extends Command {
  static description = 'Add names to a theme';

  static examples = [
    '<%= config.bin %> <%= command.id %> greek-gods zeus athena poseidon',
    '<%= config.bin %> <%= command.id %> my-theme agent-a agent-b',
  ];

  static args = {
    theme: Args.string({
      description: 'Theme ID to add names to',
      required: true,
    }),
  };

  static strict = false; // Allow multiple name arguments

  async run(): Promise<void> {
    const { args, argv } = await this.parse(ThemesAddNames);

    try {
      const workspaceInfo = getWorkspaceInfo();

      // Validate theme exists
      const theme = getTheme(workspaceInfo.path, args.theme);
      if (!theme) {
        this.error(`Theme "${args.theme}" not found. Run "prlt themes list" to see available themes.`);
      }

      // Get names from remaining arguments (skip the theme arg)
      const names = (argv as string[]).slice(1);

      if (names.length === 0) {
        this.error('Please provide at least one name to add.');
      }

      // Validate names
      const validNames: string[] = [];
      const invalidNames: string[] = [];

      for (const name of names) {
        if (isValidAgentName(name)) {
          validNames.push(name);
        } else {
          invalidNames.push(name);
        }
      }

      if (invalidNames.length > 0) {
        this.log(chalk.red(`Invalid names: ${invalidNames.join(', ')}`));
        this.log(chalk.yellow('Names must be lowercase alphanumeric with optional hyphens/underscores.'));
      }

      if (validNames.length === 0) {
        this.error('No valid names to add.');
      }

      // Add names to theme
      addThemeNames(workspaceInfo.path, theme.id, validNames);

      // Get updated count
      const allNames = getThemeNames(workspaceInfo.path, theme.id);

      this.log(chalk.green(`\n Added ${validNames.length} name(s) to ${theme.display_name}:`));
      this.log(chalk.gray(`   ${validNames.join(', ')}`));
      this.log(chalk.gray(`\n   Theme now has ${allNames.length} names total.`));

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
