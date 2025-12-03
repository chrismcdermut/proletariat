import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';

export default class Repo extends Command {
  static description = 'Individual repository operations';

  static examples = [
    '<%= config.bin %> <%= command.id %> add /path/to/repo',
    '<%= config.bin %> <%= command.id %> remove my-repo',
    '<%= config.bin %> <%= command.id %> view my-repo',
  ];

  async run(): Promise<void> {
    this.log(colors.primary('📦 Individual Repository Operations'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '➕ Add repository', value: 'add' },
        { name: '🗑️  Remove repository', value: 'remove' },
        { name: '📄 View repository details', value: 'view' },
        new inquirer.Separator(),
        { name: '❌ Cancel', value: 'cancel' }
      ]
    }]);

    if (action === 'cancel') {
      this.log(colors.textMuted('Operation cancelled.'));
      return;
    }

    try {
      this.log(colors.primary(`\nExecuting: repo ${action}`));

      switch (action) {
        case 'add': {
          const { default: AddCommand } = await import('./add.js');
          const cmd = new AddCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'remove': {
          const { default: RemoveCommand } = await import('./remove.js');
          const cmd = new RemoveCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'view': {
          const { default: ViewCommand } = await import('./view.js');
          const cmd = new ViewCommand([], this.config);
          await cmd.run();
          break;
        }
        default:
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.error(`Failed to execute repo ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
