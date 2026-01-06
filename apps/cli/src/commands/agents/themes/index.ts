import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import chalk from 'chalk';

export default class Themes extends Command {
  static description = 'Manage agent naming themes';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> create greek-gods',
    '<%= config.bin %> <%= command.id %> add-names greek-gods zeus athena',
  ];

  async run(): Promise<void> {
    this.log(chalk.bold('\nAgent Themes'));
    this.log(chalk.dim('Optional themed name pools for your agents.\n'));

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'List themes', value: 'list' },
        { name: 'Create a new theme', value: 'create' },
        { name: 'Add names to a theme', value: 'add-names' },
        new inquirer.Separator(),
        { name: 'Cancel', value: 'cancel' }
      ]
    }]);

    if (action === 'cancel') {
      this.log(chalk.dim('Cancelled.'));
      return;
    }

    try {
      switch (action) {
        case 'list': {
          const { default: ListCommand } = await import('./list.js');
          const cmd = new ListCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'create': {
          // Prompt for theme name interactively
          const { themeName } = await inquirer.prompt([{
            type: 'input',
            name: 'themeName',
            message: 'Theme name (lowercase with hyphens):',
            validate: (input: string) => {
              if (!input.trim()) return 'Theme name is required';
              if (!/^[a-z0-9][a-z0-9-]*$/.test(input.trim())) {
                return 'Must be lowercase alphanumeric with optional hyphens';
              }
              return true;
            }
          }]);
          const { default: CreateCommand } = await import('./create.js');
          const cmd = new CreateCommand([themeName.trim()], this.config);
          await cmd.run();
          break;
        }
        case 'add-names': {
          // Prompt for theme and names interactively
          const { theme, names } = await inquirer.prompt([
            {
              type: 'input',
              name: 'theme',
              message: 'Theme ID to add names to:',
              validate: (input: string) => input.trim() ? true : 'Theme ID is required'
            },
            {
              type: 'input',
              name: 'names',
              message: 'Names to add (space-separated):',
              validate: (input: string) => input.trim() ? true : 'At least one name is required'
            }
          ]);
          const args = [theme.trim(), ...names.trim().split(/\s+/)];
          const { default: AddNamesCommand } = await import('./add-names.js');
          const cmd = new AddNamesCommand(args, this.config);
          await cmd.run();
          break;
        }
        default:
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
