import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Project extends PMOCommand {
  static description = 'Interactive menu for project operations';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({ description: 'Output prompt configuration as JSON (for AI agents/scripts)', default: false }),
    'no-interactive': Flags.boolean({ description: 'Alias for --json flag', default: false }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Project);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // In JSON mode, output menu prompt
    if (jsonMode) {
      const menuChoices = [
        { name: 'Create new project', value: 'create' },
        { name: 'List all projects', value: 'list' },
        { name: 'View project board', value: 'view' },
        { name: 'Manage project specs', value: 'spec' },
        { name: 'Delete project', value: 'delete' },
        { name: 'Cancel', value: 'cancel' },
      ];
      outputPromptAsJson(
        buildPromptConfig('list', 'action', 'Project Operations - What would you like to do?', menuChoices),
        createMetadata('project', flags)
      );
      return;
    }

    // Show interactive menu
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Project Operations - What would you like to do?',
      choices: [
        { name: 'Create new project', value: 'create' },
        { name: 'List all projects', value: 'list' },
        { name: 'View project board', value: 'view' },
        { name: 'Manage project specs', value: 'spec' },
        { name: 'Delete project', value: 'delete' },
        new inquirer.Separator(),
        { name: 'Cancel', value: 'cancel' },
      ],
    }]);

    if (action === 'cancel') {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'create':
        await this.config.runCommand('project:create', []);
        break;
      case 'list':
        await this.config.runCommand('project:list', []);
        break;
      case 'view':
        await this.config.runCommand('project:view', []);
        break;
      case 'spec':
        await this.config.runCommand('project:spec', []);
        break;
      case 'delete':
        await this.config.runCommand('project:delete', []);
        break;
    }
  }
}
