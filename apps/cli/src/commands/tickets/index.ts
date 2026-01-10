import inquirer from 'inquirer';
import { colors } from '../../lib/colors.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';

export default class Tickets extends PMOCommand {
  static description = 'Manage tickets in bulk';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> move',
    '<%= config.bin %> <%= command.id %> delete',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    this.log(colors.primary('🎫 Ticket Management (Bulk Operations)'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '📋 List all tickets', value: 'list' },
        { name: '📦 Move multiple tickets', value: 'move' },
        { name: '✅ Complete multiple tickets', value: 'complete' },
        new inquirer.Separator(),
        { name: '👤 Reassign tickets (change assignee)', value: 'reassign' },
        { name: '🔗 Link tickets to epic', value: 'link' },
        { name: '📄 Link tickets to spec', value: 'spec' },
        { name: '📁 Move tickets to project', value: 'project' },
        { name: '✏️  Update tickets (priority/category)', value: 'update' },
        new inquirer.Separator(),
        { name: '🗑️  Delete multiple tickets', value: 'delete' },
        new inquirer.Separator(),
        { name: '❌ Cancel', value: 'cancel' }
      ]
    }]);

    if (action === 'cancel') {
      this.log(colors.textMuted('Operation cancelled.'));
      return;
    }

    try {
      this.log(colors.primary(`\nExecuting: tickets ${action}`));

      // Pass --project flag to sub-command so it doesn't prompt again
      const projectArgs = ['--project', this.projectId];

      switch (action) {
        case 'list': {
          const { default: ListCommand } = await import('./list.js');
          const cmd = new ListCommand(projectArgs, this.config);
          await cmd.init();
          await cmd.run();
          break;
        }
        case 'move': {
          const { default: MoveCommand } = await import('./move.js');
          const cmd = new MoveCommand(projectArgs, this.config);
          await cmd.init();
          await cmd.run();
          break;
        }
        case 'delete': {
          const { default: DeleteCommand } = await import('./delete.js');
          const cmd = new DeleteCommand(projectArgs, this.config);
          await cmd.init();
          await cmd.run();
          break;
        }
        case 'complete': {
          const { default: CompleteCommand } = await import('./complete.js');
          const cmd = new CompleteCommand(projectArgs, this.config);
          await cmd.init();
          await cmd.run();
          break;
        }
        case 'reassign': {
          const { default: ReassignCommand } = await import('./reassign.js');
          const cmd = new ReassignCommand(projectArgs, this.config);
          await cmd.init();
          await cmd.run();
          break;
        }
        case 'link': {
          const { default: LinkCommand } = await import('./link.js');
          const cmd = new LinkCommand(projectArgs, this.config);
          await cmd.init();
          await cmd.run();
          break;
        }
        case 'spec': {
          const { default: SpecCommand } = await import('./spec.js');
          const cmd = new SpecCommand(projectArgs, this.config);
          await cmd.init();
          await cmd.run();
          break;
        }
        case 'project': {
          const { default: ProjectCommand } = await import('./project.js');
          const cmd = new ProjectCommand(projectArgs, this.config);
          await cmd.init();
          await cmd.run();
          break;
        }
        case 'update': {
          const { default: UpdateCommand } = await import('./update.js');
          const cmd = new UpdateCommand(projectArgs, this.config);
          await cmd.init();
          await cmd.run();
          break;
        }
        default:
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.error(`Failed to execute tickets ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
