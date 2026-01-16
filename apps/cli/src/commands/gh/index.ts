import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class GH extends Command {
  static description = 'GitHub CLI setup and status for PR workflow';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> status',
    '<%= config.bin %> <%= command.id %> login',
    '<%= config.bin %> <%= command.id %> token',
  ];

  static flags = {
    json: Flags.boolean({ description: 'Output prompt configuration as JSON (for AI agents/scripts)', default: false }),
    'no-interactive': Flags.boolean({ description: 'Alias for --json flag', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GH);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // In JSON mode, output menu prompt
    if (jsonMode) {
      const menuChoices = [
        { name: 'Check status', value: 'status' },
        { name: 'Login to GitHub', value: 'login' },
        { name: 'Show GH_TOKEN setup', value: 'token' },
      ];
      outputPromptAsJson(
        buildPromptConfig('list', 'action', 'GitHub CLI Setup', menuChoices),
        createMetadata('gh', flags)
      );
      return;
    }

    // Interactive menu when no subcommand provided
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'GitHub CLI Setup',
      choices: [
        { name: 'Check status', value: 'status' },
        { name: 'Login to GitHub', value: 'login' },
        { name: 'Show GH_TOKEN setup', value: 'token' },
      ],
    }]);

    switch (action) {
      case 'status':
        await this.config.runCommand('gh status');
        break;
      case 'login':
        await this.config.runCommand('gh login');
        break;
      case 'token':
        await this.config.runCommand('gh token');
        break;
    }
  }
}
