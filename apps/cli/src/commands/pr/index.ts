import { Flags } from '@oclif/core';
import {
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class PR extends PMOCommand {
  static description = 'Interactive menu for pull request operations';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(PR);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('pr', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // PMOCommand base class ensures PMO context is available
    // Check if we have storage access
    if (!this.storage) {
      return handleError('PMO_NOT_FOUND', 'PMO not found. Run "prlt pmo init" first.');
    }

    // Define menu items
    const menuItems = [
      { id: 'create', label: 'Create PR from current branch' },
      { id: 'link', label: 'Link existing PR to ticket' },
      { id: 'status', label: 'View PR status for ticket' },
      { id: 'cancel', label: 'Cancel' },
    ];

    // Use selectFromList helper for JSON mode support
    const action = await this.selectFromList({
      message: 'Pull Request Operations - What would you like to do?',
      items: menuItems,
      getName: (item) => item.label,
      getValue: (item) => item.id,
      getCommand: (item) => `prlt pr ${item.id} --json`,
      jsonMode: jsonMode ? { flags, commandName: 'pr' } : null,
    });

    if (!action || action === 'cancel') {
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
