import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class TemplateWorkflow extends Command {
  static description = 'Manage workflow templates (status configurations)';

  static aliases = ['template:workflows'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> apply kanban',
    '<%= config.bin %> <%= command.id %> save "My Workflow"',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TemplateWorkflow);

    const jsonMode = shouldOutputJson(flags);

    const menuChoices = [
      { name: 'List workflow templates', value: 'list' },
      { name: 'Create a new workflow template', value: 'create' },
      { name: 'Apply a workflow template to project', value: 'apply' },
      { name: 'Save current workflow as template', value: 'save' },
      { name: 'Delete workflow templates', value: 'delete' },
    ];
    const message = 'What would you like to do?';

    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('template workflow', flags)
      );
      return;
    }

    this.log('');
    this.log(styles.header('Workflow Templates'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message,
      choices: menuChoices.map(c => ({ name: c.name, value: c.value })),
    }]);

    switch (action) {
      case 'list':
        await this.config.runCommand('template:workflow:list', []);
        break;
      case 'create':
        await this.config.runCommand('status:template:create', []);
        break;
      case 'apply':
        await this.config.runCommand('status:template:apply', []);
        break;
      case 'save':
        await this.config.runCommand('status:template:save', []);
        break;
      case 'delete':
        await this.config.runCommand('status:template:delete', []);
        break;
    }
  }
}
