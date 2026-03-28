
import inquirer from 'inquirer';
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Ticket extends PromptCommand {
  static description = 'Interactive menu for ticket operations';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Ticket);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    // Each choice includes the full command for AI agents to execute
    const menuChoices = [
      { name: 'Create new ticket', value: 'create', command: 'prlt ticket create --json' },
      { name: 'List all tickets', value: 'list', command: 'prlt ticket list --format json' },
      { name: 'Edit ticket', value: 'edit', command: 'prlt ticket edit --json' },
      { name: 'Move ticket (status)', value: 'move', command: 'prlt ticket move --json' },
      { name: 'Show ticket details', value: 'show', command: 'prlt ticket show --json' },
      { name: 'Delete ticket', value: 'delete', command: 'prlt ticket delete --json' },
      { name: 'Cancel', value: 'cancel' },
    ];
    const message = 'Ticket Operations - What would you like to do?';

    // In JSON mode, output action selection prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('ticket', flags)
      );
      return;
    }

    // Show interactive menu
    const { action } = await this.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message: '🎫 ' + message,
      choices: [
        ...menuChoices.slice(0, -1),
        new inquirer.Separator('──────────────'),
        menuChoices[menuChoices.length - 1],
      ],
    }], null);

    if (action === 'cancel') {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'create':
        await this.config.runCommand('ticket:create', []);
        break;
      case 'list':
        await this.config.runCommand('ticket:list', []);
        break;
      case 'edit':
        await this.config.runCommand('ticket:edit', []);
        break;
      case 'move':
        await this.config.runCommand('ticket:move', []);
        break;
      case 'show':
        await this.config.runCommand('ticket:show', []);
        break;
      case 'delete':
        await this.config.runCommand('ticket:delete', []);
        break;
    }
  }
}
