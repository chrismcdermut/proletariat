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
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
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
    const menuChoices = [
      { name: 'Create new ticket', value: 'create' },
      { name: 'Create from template', value: 'template' },
      { name: 'List all tickets', value: 'list' },
      { name: 'View ticket details', value: 'view' },
      { name: 'Edit ticket', value: 'edit' },
      { name: 'Move ticket (column)', value: 'move' },
      { name: 'Move to different project', value: 'project' },
      { name: 'Assign to epic', value: 'epic' },
      { name: 'Assign to spec', value: 'spec' },
      { name: 'Manage dependencies', value: 'link' },
      { name: 'Manage templates', value: 'templates' },
      { name: 'Delete ticket', value: 'delete' },
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
