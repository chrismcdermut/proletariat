import { Command, Args } from '@oclif/core';
import chalk from 'chalk';
import { getWorkspaceInfo } from '../../../lib/agents/commands.js';
import { isValidAgentName, normalizeAgentName } from '../../../lib/themes.js';
import { getTheme, addThemeNames, getThemeNames } from '../../../lib/database/index.js';

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
        this.error(`Theme "${args.theme}" not found. Run "prlt agents themes list" to see available themes.`);
      }

      // Get names from remaining arguments (skip the theme arg)
      const rawNames = (argv as string[]).slice(1);

      if (rawNames.length === 0) {
        this.error('Please provide at least one name to add.');
      }

      // Normalize and validate names
      const validNames: string[] = [];
      const normalized: { original: string; normalized: string }[] = [];

      for (const name of rawNames) {
        const normalizedName = normalizeAgentName(name);
        if (normalizedName && isValidAgentName(normalizedName)) {
          validNames.push(normalizedName);
          if (normalizedName !== name) {
            normalized.push({ original: name, normalized: normalizedName });
          }
        }
      }

      if (validNames.length === 0) {
        this.error('No valid names to add after normalization.');
      }

      // Show normalizations
      if (normalized.length > 0) {
        this.log(chalk.blue('Normalized names:'));
        for (const { original, normalized: norm } of normalized) {
          this.log(chalk.dim(`   ${original} → ${norm}`));
        }
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
