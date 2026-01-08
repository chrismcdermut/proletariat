import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';

export default class Repos extends PMOCommand {
  static description = 'Manage repositories in bulk';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> add',
    '<%= config.bin %> <%= command.id %> remove',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    this.log(colors.primary('📦 Repository Management (Bulk Operations)'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '📋 List all repositories', value: 'list' },
        { name: '➕ Add repositories (bulk)', value: 'add' },
        { name: '➖ Remove repositories (bulk)', value: 'remove' },
        new inquirer.Separator(),
        { name: '❌ Cancel', value: 'cancel' }
      ]
    }]);

    if (action === 'cancel') {
      this.log(colors.textMuted('Operation cancelled.'));
      return;
    }

    try {
      this.log(colors.primary(`\nExecuting: repos ${action}`));

      switch (action) {
        case 'list': {
          const { default: ListCommand } = await import('./list.js');
          const cmd = new ListCommand([], this.config);
          await cmd.run();
          break;
        }
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
        default:
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.error(`Failed to execute repos ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
