import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';

export default class Repo extends PMOCommand {
  static description = 'Repository management operations';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> add /path/to/repo',
    '<%= config.bin %> <%= command.id %> remove my-repo',
    '<%= config.bin %> <%= command.id %> view my-repo',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    this.log(colors.primary('📦 Repository Operations'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '📋 List all repositories', value: 'list' },
        new inquirer.Separator('─── Single Repository ───'),
        { name: '➕ Add repository', value: 'add' },
        { name: '🗑️  Remove repository', value: 'remove' },
        { name: '📄 View repository details', value: 'view' },
        new inquirer.Separator('─── Bulk Operations ───'),
        { name: '📦 Add multiple repositories', value: 'add-bulk' },
        { name: '🗑️  Remove multiple repositories', value: 'remove-bulk' },
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
        case 'add-bulk': {
          const { default: AddCommand } = await import('./add.js');
          const cmd = new AddCommand(['--bulk'], this.config);
          await cmd.run();
          break;
        }
        case 'remove': {
          const { default: RemoveCommand } = await import('./remove.js');
          const cmd = new RemoveCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'remove-bulk': {
          const { default: RemoveCommand } = await import('./remove.js');
          const cmd = new RemoveCommand(['--bulk'], this.config);
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
