import { Command, Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { createTheme, getTheme } from '../../lib/database/index.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class ThemeCreate extends Command {
  static description = 'Create a custom agent theme';

  static examples = [
    '<%= config.bin %> <%= command.id %> greek-gods',
    '<%= config.bin %> <%= command.id %> greek-gods --description "Mount Olympus crew"',
    '<%= config.bin %> <%= command.id %> greek-gods --display-name "Greek Gods"',
  ];

  static args = {
    name: Args.string({
      description: 'Theme name (used as ID, lowercase with hyphens)',
      required: true,
    }),
  };

  static flags = {
    ...machineOutputFlags,
    description: Flags.string({
      char: 'd',
      description: 'Theme description',
    }),
    'display-name': Flags.string({
      description: 'Display name (defaults to formatted name)',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ThemeCreate);
    const jsonMode = shouldOutputJson(flags)

    try {
      const workspaceInfo = getWorkspaceInfo();

      // Validate theme name format
      const name = args.name.toLowerCase().replace(/\s+/g, '-');
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
        this.error('Theme name must be lowercase alphanumeric with optional hyphens.');
      }

      // Check if theme already exists
      const existing = getTheme(workspaceInfo.path, name);
      if (existing) {
        this.error(`Theme "${name}" already exists.`);
      }

      // Create display name from name if not provided
      const displayName = flags['display-name'] || name
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      // Create the theme
      const theme = createTheme(workspaceInfo.path, {
        id: name,
        name: name,
        displayName: displayName,
        description: flags.description,
        builtin: false,
      });

      if (jsonMode) {
        this.log(JSON.stringify({ type: 'success', result: { id: theme.id, displayName: theme.display_name, description: theme.description } }, null, 2))
        return
      }

      this.log(chalk.green(`\n Created theme: ${theme.display_name}`));
      this.log(chalk.gray(`   ID: ${theme.id}`));
      if (theme.description) {
        this.log(chalk.gray(`   ${theme.description}`));
      }
      this.log('');
      this.log(chalk.blue('Add names with: prlt theme add-names ' + name + ' <names...>'));

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
