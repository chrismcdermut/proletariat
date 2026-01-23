import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Ticket extends PMOCommand {
  static description = 'Interactive menu for ticket operations';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Ticket);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    // Each choice includes the full command for AI agents to execute
    const menuChoices = [
      { name: 'Create new ticket', value: 'create', command: 'prlt ticket create --json' },
      { name: 'Create from template', value: 'template', command: 'prlt ticket template apply --json' },
      { name: 'List all tickets', value: 'list', command: 'prlt ticket list --format json' },
      { name: 'View ticket details', value: 'view', command: 'prlt ticket view --json' },
      { name: 'Edit ticket', value: 'edit', command: 'prlt ticket edit --json' },
      { name: 'Move ticket (column)', value: 'move', command: 'prlt ticket move --json' },
      { name: 'Move to different project', value: 'project', command: 'prlt ticket project --json' },
      { name: 'Assign to epic', value: 'epic', command: 'prlt ticket epic --json' },
      { name: 'Assign to spec', value: 'spec', command: 'prlt ticket spec --json' },
      { name: 'Manage dependencies', value: 'link', command: 'prlt ticket link --json' },
      { name: 'Manage templates', value: 'templates', command: 'prlt ticket template --json' },
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
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: '🎫 ' + message,
      choices: [
        ...menuChoices.slice(0, 10),
        new inquirer.Separator('──────────────'),
        menuChoices[10],
        menuChoices[11],
        menuChoices[12],
      ],
    }]);

    if (action === 'cancel') {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'create':
        await this.config.runCommand('ticket:create', []);
        break;
      case 'template':
        await this.config.runCommand('ticket:template:apply', []);
        break;
      case 'list':
        await this.config.runCommand('ticket:list', []);
        break;
      case 'view':
        await this.config.runCommand('ticket:view', []);
        break;
      case 'edit':
        await this.config.runCommand('ticket:edit', []);
        break;
      case 'move':
        await this.config.runCommand('ticket:move', []);
        break;
      case 'project':
        await this.config.runCommand('ticket:project', []);
        break;
      case 'epic':
        await this.config.runCommand('ticket:epic', []);
        break;
      case 'spec':
        await this.config.runCommand('ticket:spec', []);
        break;
      case 'link':
        await this.config.runCommand('ticket:link', []);
        break;
      case 'templates':
        await this.config.runCommand('ticket:template', []);
        break;
      case 'delete':
        await this.config.runCommand('ticket:delete', []);
        break;
    }
  }
}
