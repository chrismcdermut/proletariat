import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class TicketBulk extends PMOCommand {
  static description = 'Manage tickets in bulk (interactive menu)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(TicketBulk);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // In JSON mode, output action selection prompt
    if (jsonMode) {
      const actionChoices = [
        { name: 'List all tickets', value: 'list' },
        { name: 'Move multiple tickets', value: 'move' },
        { name: 'Complete multiple tickets', value: 'complete' },
        { name: 'Reassign tickets (change assignee)', value: 'reassign' },
        { name: 'Link tickets to epic', value: 'epic' },
        { name: 'Link tickets to spec', value: 'spec' },
        { name: 'Move tickets to project', value: 'project' },
        { name: 'Update tickets (priority/category)', value: 'update' },
        { name: 'Delete multiple tickets', value: 'delete' },
      ];
      outputPromptAsJson(
        buildPromptConfig('list', 'action', 'Ticket Management (Bulk Operations) - What would you like to do?', actionChoices),
        createMetadata('ticket bulk', flags)
      );
      return;
    }

    this.log(styles.emphasis('🎫 Ticket Management (Bulk Operations)'));
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
        { name: '🔗 Link tickets to epic', value: 'epic' },
        { name: '📄 Link tickets to spec', value: 'spec' },
        { name: '📁 Move tickets to project', value: 'project' },
        { name: '✏️  Update tickets (priority/category)', value: 'update' },
        new inquirer.Separator(),
        { name: '🗑️  Delete multiple tickets', value: 'delete' },
        new inquirer.Separator(),
        { name: 'Cancel', value: 'cancel' }
      ]
    }]);

    if (action === 'cancel') {
      this.log(styles.muted('Operation cancelled.'));
      return;
    }

    // Build args for the sub-command
    const projectArgs = ['--project', this.projectId, '--bulk'];

    try {
      this.log(styles.muted(`\nExecuting: ticket ${action} --bulk`));

      switch (action) {
        case 'list': {
          // List doesn't need bulk mode
          const { default: ListCommand } = await import('./list.js');
          const cmd = new ListCommand(['--project', this.projectId], this.config);
          await cmd.run();
          break;
        }
        case 'move': {
          const { default: MoveCommand } = await import('./move.js');
          const cmd = new MoveCommand(projectArgs, this.config);
          await cmd.run();
          break;
        }
        case 'delete': {
          const { default: DeleteCommand } = await import('./delete.js');
          const cmd = new DeleteCommand(projectArgs, this.config);
          await cmd.run();
          break;
        }
        case 'complete': {
          const { default: CompleteCommand } = await import('./complete.js');
          const cmd = new CompleteCommand(projectArgs, this.config);
          await cmd.run();
          break;
        }
        case 'reassign': {
          const { default: ReassignCommand } = await import('./reassign.js');
          const cmd = new ReassignCommand(projectArgs, this.config);
          await cmd.run();
          break;
        }
        case 'epic': {
          const { default: EpicCommand } = await import('./epic.js');
          const cmd = new EpicCommand(projectArgs, this.config);
          await cmd.run();
          break;
        }
        case 'spec': {
          const { default: SpecCommand } = await import('./spec.js');
          const cmd = new SpecCommand(projectArgs, this.config);
          await cmd.run();
          break;
        }
        case 'project': {
          const { default: ProjectCommand } = await import('./project.js');
          const cmd = new ProjectCommand(projectArgs, this.config);
          await cmd.run();
          break;
        }
        case 'update': {
          const { default: UpdateCommand } = await import('./update.js');
          const cmd = new UpdateCommand(projectArgs, this.config);
          await cmd.run();
          break;
        }
        default:
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.error(`Failed to execute ticket ${action}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
