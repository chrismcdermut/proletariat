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
      description: 'Action to perform (list, create, merge, close, checks, link, status)',
      options: ['list', 'create', 'merge', 'close', 'checks', 'link', 'status'],
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(PR);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('pr', flags));
        return
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
        { name: 'List all open PRs', value: 'list' },
        { name: 'Create PR from current branch', value: 'create' },
        { name: 'Merge a PR', value: 'merge' },
        { name: 'Close a PR', value: 'close' },
        { name: 'View CI check status', value: 'checks' },
        { name: 'Link existing PR to ticket', value: 'link' },
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
      case 'list':
        await this.config.runCommand('pr:list', []);
        break;
      case 'create':
        await this.config.runCommand('pr:create', []);
        break;
      case 'link':
        await this.config.runCommand('pr:link', []);
        break;
      case 'merge':
        await this.config.runCommand('pr:merge', []);
        break;
      case 'close':
        await this.config.runCommand('pr:close', []);
        break;
      case 'checks':
        await this.config.runCommand('pr:checks', []);
        break;
      case 'status':
        await this.config.runCommand('pr:status', []);
        break;
    }
  }
}
