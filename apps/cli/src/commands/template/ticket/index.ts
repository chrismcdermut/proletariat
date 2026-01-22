import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class TemplateTicket extends Command {
  static description = 'Manage ticket templates (for creating tickets from templates)';

  static aliases = ['template:tickets'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> apply bug-report',
    '<%= config.bin %> <%= command.id %> save TKT-001 "My Template"',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TemplateTicket);

    const jsonMode = shouldOutputJson(flags);

    const menuChoices = [
      { name: 'List ticket templates', value: 'list' },
      { name: 'Create new template', value: 'create' },
      { name: 'Create ticket from template', value: 'apply' },
      { name: 'Save ticket as template', value: 'save' },
      { name: 'Delete ticket template', value: 'delete' },
    ];
    const message = 'What would you like to do?';

    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('template ticket', flags)
      );
      return;
    }

    this.log('');
    this.log(styles.header('Ticket Templates'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message,
      choices: menuChoices.map(c => ({ name: c.name, value: c.value })),
    }]);

    switch (action) {
      case 'list':
        await this.config.runCommand('template:ticket:list', []);
        break;
      case 'create':
        await this.config.runCommand('ticket:template:create', []);
        break;
      case 'apply':
        await this.config.runCommand('ticket:template:apply', []);
        break;
      case 'save':
        await this.config.runCommand('ticket:template:save', []);
        break;
      case 'delete':
        await this.config.runCommand('ticket:template:delete', []);
        break;
    }
  }
}
