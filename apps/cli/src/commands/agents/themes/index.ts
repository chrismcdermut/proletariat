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
    this.log(chalk.gray('Optional themed name pools for your agents.\n'));

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
      this.log(chalk.gray('Cancelled.'));
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
          const { default: CreateCommand } = await import('./create.js');
          const cmd = new CreateCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'add-names': {
          const { default: AddNamesCommand } = await import('./add-names.js');
          const cmd = new AddNamesCommand([], this.config);
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
