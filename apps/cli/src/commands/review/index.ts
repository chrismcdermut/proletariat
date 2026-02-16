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

export default class Review extends PMOCommand {
  static description = 'Interactive menu for review worktree operations';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --action list',
  ];

  static flags = {
    ...pmoBaseFlags,
    action: Flags.string({
      char: 'a',
      description: 'Action to perform (list, add, remove, checkout)',
      options: ['list', 'add', 'remove', 'checkout'],
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(Review);
    const jsonMode = shouldOutputJson(flags);

    if (!this.storage) {
      if (jsonMode) {
        outputErrorAsJson('PMO_NOT_FOUND', 'PMO not found. Run "prlt pmo init" first.', createMetadata('review', flags));
        this.exit(1);
      }
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    const resolver = new FlagResolver<{ action?: string }>({
      commandName: 'review',
      baseCommand: 'prlt review',
      jsonMode,
      flags: { action: flags.action },
    });

    resolver.addPrompt({
      flagName: 'action',
      type: 'list',
      message: 'Review Worktrees - What would you like to do?',
      choices: () => [
        { name: 'List review worktrees', value: 'list' },
        { name: 'Add a new review worktree', value: 'add' },
        { name: 'Checkout branch/PR into worktree', value: 'checkout' },
        { name: 'Remove a review worktree', value: 'remove' },
        { name: 'Cancel', value: 'cancel' },
      ],
      when: (ctx) => !ctx.flags.action,
    });

    const resolved = await resolver.resolve();

    if (!resolved.action || resolved.action === 'cancel') {
      return;
    }

    switch (resolved.action) {
      case 'list':
        await this.config.runCommand('review:list', []);
        break;
      case 'add':
        await this.config.runCommand('review:add', []);
        break;
      case 'remove':
        await this.config.runCommand('review:remove', []);
        break;
      case 'checkout':
        await this.config.runCommand('review:checkout', []);
        break;
    }
  }
}
