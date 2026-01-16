import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Template extends Command {
  static description = 'Manage workflow templates (list, delete) or access status/phase template management';

  static aliases = ['templates'];

  static examples = [
    '<%= config.bin %> template',
    '<%= config.bin %> template list',
    '<%= config.bin %> template list --builtin',
    '<%= config.bin %> template delete',
    '<%= config.bin %> template status',
    '<%= config.bin %> template phase',
  ];

  static flags = {
    json: Flags.boolean({ description: 'Output prompt configuration as JSON (for AI agents/scripts)', default: false }),
    'no-interactive': Flags.boolean({ description: 'Alias for --json flag', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Template);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // In JSON mode, output menu prompt
    if (jsonMode) {
      const menuChoices = [
        { name: 'List all workflow templates', value: 'list' },
        { name: 'Delete workflow templates', value: 'delete' },
        { name: 'Manage Status Templates (ticket workflow states)', value: 'status' },
        { name: 'Manage Phase Templates (project lifecycle phases)', value: 'phase' },
      ];
      outputPromptAsJson(
        buildPromptConfig('list', 'action', 'What would you like to do?', menuChoices),
        createMetadata('template', flags)
      );
      return;
    }

    this.log('');
    this.log(styles.header('📋 Templates'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        {
          name: '📋 List all workflow templates',
          value: 'list',
        },
        {
          name: '🗑️  Delete workflow templates',
          value: 'delete',
        },
        new inquirer.Separator(),
        {
          name: '📊 Manage Status Templates (ticket workflow states)',
          value: 'status',
        },
        {
          name: '🔄 Manage Phase Templates (project lifecycle phases)',
          value: 'phase',
        },
      ],
    }]);

    switch (action) {
      case 'list':
        await this.config.runCommand('template:list', []);
        break;
      case 'delete':
        await this.config.runCommand('template:delete', []);
        break;
      case 'status':
        await this.config.runCommand('status:template', []);
        break;
      case 'phase':
        await this.config.runCommand('phase:template', []);
        break;
    }
  }
}
