import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { findPMO } from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class PR extends Command {
  static description = 'Interactive menu for pull request operations';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PR);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    const pmoPath = findPMO();
    if (!pmoPath) {
      if (jsonMode) {
        outputErrorAsJson('PMO_NOT_FOUND', 'PMO not found. Run "prlt pmo init" first.', createMetadata('pr', flags));
        this.exit(1);
      }
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { name: 'Create PR from current branch', value: 'create' },
      { name: 'Link existing PR to ticket', value: 'link' },
      { name: 'View PR status for ticket', value: 'status' },
      { name: 'Cancel', value: 'cancel' },
    ];
    const message = 'Pull Request Operations - What would you like to do?';

    // In JSON mode, output menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('pr', flags)
      );
      return;
    }

    // Show interactive menu (with separator before Cancel)
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message,
      choices: [
        ...menuChoices.slice(0, -1),
        new inquirer.Separator('──────────────'),
        menuChoices[menuChoices.length - 1],
      ],
    }]);

    if (action === 'cancel') {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'create':
        await this.config.runCommand('pr:create', []);
        break;
      case 'link':
        await this.config.runCommand('pr:link', []);
        break;
      case 'status':
        await this.config.runCommand('pr:status', []);
        break;
    }
  }
}
