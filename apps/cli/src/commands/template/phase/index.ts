import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class TemplatePhase extends Command {
  static description = 'Manage phase templates (project lifecycle phases)';

  static aliases = ['template:phases'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> apply agile',
    '<%= config.bin %> <%= command.id %> create "My Phases"',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TemplatePhase);

    const jsonMode = shouldOutputJson(flags);

    const menuChoices = [
      { name: 'List phase templates', value: 'list' },
      { name: 'Apply a phase template to project', value: 'apply' },
      { name: 'Create a new phase template', value: 'create' },
      { name: 'Update a phase template', value: 'update' },
      { name: 'Delete a phase template', value: 'delete' },
    ];
    const message = 'What would you like to do?';

    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('template phase', flags)
      );
      return;
    }

    this.log('');
    this.log(styles.header('Phase Templates'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message,
      choices: menuChoices.map(c => ({ name: c.name, value: c.value })),
    }]);

    switch (action) {
      case 'list':
        await this.config.runCommand('template:phase:list', []);
        break;
      case 'apply':
        await this.config.runCommand('phase:template:apply', []);
        break;
      case 'create':
        await this.config.runCommand('phase:template:create', []);
        break;
      case 'update':
        await this.config.runCommand('phase:template:update', []);
        break;
      case 'delete':
        await this.config.runCommand('phase:template:delete', []);
        break;
    }
  }
}
