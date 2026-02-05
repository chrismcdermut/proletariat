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
import { FlagResolver } from '../../lib/flags/index.js';

export default class PR extends PMOCommand {
  static description = 'Interactive menu for pull request operations';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
    action: Flags.string({
      char: 'a',
      description: 'Action to perform (create, link, status, view)',
      options: ['create', 'link', 'status', 'view'],
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
    if (!this.storage) {
      return handleError('PMO_NOT_FOUND', 'PMO not found. Run "prlt pmo init" first.');
    }

    // Use FlagResolver for action selection
    const resolver = new FlagResolver<{ action?: string }>({
      commandName: 'pr',
      baseCommand: 'prlt pr',
      jsonMode,
      flags: { action: flags.action },
    });

    resolver.addPrompt({
      flagName: 'action',
      type: 'list',
      message: 'Pull Request Operations - What would you like to do?',
      choices: () => [
        { name: 'Create PR from current branch', value: 'create' },
        { name: 'Link existing PR to ticket', value: 'link' },
        { name: 'View PR details', value: 'view' },
        { name: 'View PR status for ticket', value: 'status' },
        { name: 'Cancel', value: 'cancel' },
      ],
      when: (ctx) => !ctx.flags.action,
    });

    const resolved = await resolver.resolve();

    if (!resolved.action || resolved.action === 'cancel') {
      return;
    }

    // Run the selected subcommand
    switch (resolved.action) {
      case 'create':
        await this.config.runCommand('pr:create', []);
        break;
      case 'link':
        await this.config.runCommand('pr:link', []);
        break;
      case 'view':
        await this.config.runCommand('pr:view', []);
        break;
      case 'status':
        await this.config.runCommand('pr:status', []);
        break;
    }
  }
}
