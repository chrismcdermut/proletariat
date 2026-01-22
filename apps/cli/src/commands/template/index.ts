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
  static description = 'Manage templates (ticket and phase)';

  static aliases = ['templates'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> list --type ticket',
    '<%= config.bin %> <%= command.id %> ticket',
    '<%= config.bin %> <%= command.id %> phase',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Template);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'List all templates', value: 'list' },
      new inquirer.Separator(),
      { name: 'Ticket templates (ticket presets)', value: 'ticket' },
      { name: 'Phase templates (project phases)', value: 'phase' },
    ];
    const message = 'What would you like to do?';

    // In JSON mode, output menu prompt (without separators)
    if (jsonMode) {
      const jsonChoices = [
        { name: 'List all templates', value: 'list' },
        { name: 'Ticket templates (ticket presets)', value: 'ticket' },
        { name: 'Phase templates (project phases)', value: 'phase' },
      ];
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, jsonChoices),
        createMetadata('template', flags)
      );
      return;
    }

    this.log('');
    this.log(styles.header('Templates'));
    this.log('');

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message,
      choices: menuChoices,
    }]);

    switch (action) {
      case 'list':
        await this.config.runCommand('template:list', []);
        break;
      case 'ticket':
        await this.config.runCommand('template:ticket', []);
        break;
      case 'phase':
        await this.config.runCommand('template:phase', []);
        break;
    }
  }
}
