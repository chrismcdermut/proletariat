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
    // This command requires project context - store the projectId
    const projectId = await this.requireProject();

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices with emojis for interactive mode, plain names for JSON
    const menuChoices: Array<{ name: string; value: string; emoji: string }> = [
      { name: 'List all tickets', value: 'list', emoji: '📋' },
      { name: 'Move multiple tickets', value: 'move', emoji: '📦' },
      { name: 'Complete multiple tickets', value: 'complete', emoji: '✅' },
      { name: 'Reassign tickets (change assignee)', value: 'reassign', emoji: '👤' },
      { name: 'Link tickets to epic', value: 'epic', emoji: '🔗' },
      { name: 'Link tickets to spec', value: 'spec', emoji: '📄' },
      { name: 'Move tickets to project', value: 'project', emoji: '📁' },
      { name: 'Update tickets (priority/category)', value: 'update', emoji: '✏️ ' },
      { name: 'Delete multiple tickets', value: 'delete', emoji: '🗑️ ' },
      { name: 'Cancel', value: 'cancel', emoji: '' },
    ];
    const message = 'Ticket Management (Bulk Operations) - What would you like to do?';

    // In JSON mode, output action selection prompt (without emojis)
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices.map(c => ({ name: c.name, value: c.value }))),
        createMetadata('ticket bulk', flags)
      );
      return;
    }

    this.log(styles.emphasis('🎫 ' + message.split(' - ')[0]));
    this.log('');

    // Helper to get choice with emoji by value
    const withEmoji = (value: string) => {
      const choice = menuChoices.find(c => c.value === value)!;
      return { name: choice.emoji ? `${choice.emoji} ${choice.name}` : choice.name, value: choice.value };
    };

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        withEmoji('list'),
        withEmoji('move'),
        withEmoji('complete'),
        new inquirer.Separator(),
        withEmoji('reassign'),
        withEmoji('epic'),
        withEmoji('spec'),
        withEmoji('project'),
        withEmoji('update'),
        new inquirer.Separator(),
        withEmoji('delete'),
        new inquirer.Separator(),
        withEmoji('cancel'),
      ]
    }]);

    if (action === 'cancel') {
      this.log(styles.muted('Operation cancelled.'));
      return;
    }

    // Build args for the sub-command
    const projectArgs = ['--project', projectId, '--bulk'];

    try {
      this.log(styles.muted(`\nExecuting: ticket ${action} --bulk`));

      switch (action) {
        case 'list': {
          // List doesn't need bulk mode
          const { default: ListCommand } = await import('./list.js');
          const cmd = new ListCommand(['--project', projectId], this.config);
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
