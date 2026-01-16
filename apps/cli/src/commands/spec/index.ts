import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Spec extends PMOCommand {
  static description = 'Interactive menu for spec operations';

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
    const { flags } = await this.parse(Spec);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'Create new spec', value: 'create' },
      { name: 'List all specs', value: 'list' },
      { name: 'View spec', value: 'view' },
      { name: 'Generate tickets from spec', value: 'generate' },
      { name: 'Assign ticket to spec', value: 'ticket' },
      { name: 'Manage dependencies', value: 'link' },
      { name: 'Cancel', value: 'cancel' },
    ];
    const message = 'Spec Operations - What would you like to do?';

    // In JSON mode, output action menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('spec', flags)
      );
      return;
    }

    // Show interactive menu
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: '📄 ' + message,
      choices: [
        ...menuChoices.slice(0, -1),
        new inquirer.Separator(),
        menuChoices[menuChoices.length - 1],
      ],
    }]);

    if (action === 'cancel') {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'create':
        await this.config.runCommand('spec:create', []);
        break;
      case 'list':
        await this.config.runCommand('spec:list', []);
        break;
      case 'view':
        await this.config.runCommand('spec:view', []);
        break;
      case 'generate':
        await this.config.runCommand('spec:generate-tickets', []);
        break;
      case 'ticket':
        await this.config.runCommand('spec:ticket', []);
        break;
      case 'link':
        await this.config.runCommand('spec:link', []);
        break;
    }
  }
}
