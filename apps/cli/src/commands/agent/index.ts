import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';

export default class Agent extends PMOCommand {
  static description = 'Individual agent operations';

  static examples = [
    '<%= config.bin %> <%= command.id %> status camry',
    '<%= config.bin %> <%= command.id %> visit tacoma',
    '<%= config.bin %> <%= command.id %> add',
    '<%= config.bin %> <%= command.id %> remove camry',
    '<%= config.bin %> <%= command.id %> restart altman',
    '<%= config.bin %> <%= command.id %> rebuild altman',
    '<%= config.bin %> <%= command.id %> shell altman',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    this.log(colors.primary('🤖 Individual Agent Operations'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        new inquirer.Separator('── View ──'),
        { name: '📊 Show status', value: 'status' },
        { name: '📁 Visit directory', value: 'visit' },
        new inquirer.Separator('── Manage ──'),
        { name: '➕ Add agent', value: 'add' },
        { name: '🗑️  Remove agent', value: 'remove' },
        new inquirer.Separator('── Container ──'),
        { name: '🐚 Open shell', value: 'shell' },
        { name: '🔄 Restart', value: 'restart' },
        { name: '🔨 Rebuild', value: 'rebuild' },
        new inquirer.Separator(),
        { name: '❌ Cancel', value: 'cancel' }
      ]
    }]);

    if (action === 'cancel') {
      this.log(colors.textMuted('Operation cancelled.'));
      return;
    }

    // Execute the selected command directly (no subprocess)
    try {
      this.log(colors.primary(`\nExecuting: agent ${action}`));

      switch (action) {
        case 'status': {
          const { default: StatusCommand } = await import('../agent/status.js');
          const cmd = new StatusCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'visit': {
          const { default: VisitCommand } = await import('../agent/visit.js');
          const cmd = new VisitCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'add': {
          const { default: AddCommand } = await import('../agents/add.js');
          const cmd = new AddCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'remove': {
          const { default: RemoveCommand } = await import('../agent/remove.js');
          const cmd = new RemoveCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'restart': {
          const { default: RestartCommand } = await import('../agent/restart.js');
          const cmd = new RestartCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'rebuild': {
          const { default: RebuildCommand } = await import('../agent/rebuild.js');
          const cmd = new RebuildCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'shell': {
          const { default: ShellCommand } = await import('../agent/shell.js');
          const cmd = new ShellCommand([], this.config);
          await cmd.run();
          break;
        }
        default:
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.error(`Failed to execute agent ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}