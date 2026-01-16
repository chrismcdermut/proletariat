import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Epic extends PMOCommand {
  static description = 'Interactive menu for epic operations';

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
    const { flags } = await this.parse(Epic);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'Create new epic', value: 'create' },
      { name: 'List all epics', value: 'list' },
      { name: 'View epic', value: 'view' },
      { name: 'Show progress', value: 'progress' },
      { name: 'Assign tickets to epic', value: 'ticket' },
      { name: 'Assign spec to epic', value: 'spec' },
      { name: 'Manage dependencies', value: 'link' },
      { name: 'Archive epic (complete)', value: 'archive' },
      { name: 'Activate epic', value: 'activate' },
      { name: 'Reorder epic', value: 'move' },
      { name: 'Move to different project', value: 'project' },
      { name: 'Cancel', value: 'cancel' },
    ];
    const message = 'Epic Operations - What would you like to do?';

    // In JSON mode, output menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('epic', flags)
      );
      return;
    }

    // Show interactive menu
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: '🎯 ' + message,
      choices: [
        ...menuChoices.slice(0, 7),
        new inquirer.Separator(),
        ...menuChoices.slice(7, 11),
        new inquirer.Separator(),
        menuChoices[11],
      ],
    }]);

    if (action === 'cancel') {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'create':
        await this.config.runCommand('epic:create', []);
        break;
      case 'list':
        await this.config.runCommand('epic:list', []);
        break;
      case 'view':
        await this.config.runCommand('epic:view', []);
        break;
      case 'progress':
        await this.config.runCommand('epic:progress', []);
        break;
      case 'ticket':
        await this.config.runCommand('epic:ticket', []);
        break;
      case 'spec':
        await this.config.runCommand('epic:spec', []);
        break;
      case 'link':
        await this.config.runCommand('epic:link', []);
        break;
      case 'archive':
        await this.config.runCommand('epic:archive', []);
        break;
      case 'activate':
        await this.config.runCommand('epic:activate', []);
        break;
      case 'move':
        await this.config.runCommand('epic:move', []);
        break;
      case 'project':
        await this.config.runCommand('epic:project', []);
        break;
    }
  }
}
