import { Command, Flags } from '@oclif/core';
import {
  isMachineOutput,
  createMetadata,
} from '../../lib/prompt-json.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class Feedback extends Command {
  static description = 'Interactive menu for feedback and issue operations';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --action submit',
  ];

  static flags = {
    ...machineOutputFlags,
    action: Flags.string({
      char: 'a',
      description: 'Action to perform (submit, list, view)',
      options: ['submit', 'list', 'view'],
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Feedback);

    // Check if JSON output mode is active
    const jsonMode = isMachineOutput(flags);

    // Use FlagResolver for action selection
    const resolver = new FlagResolver<{ action?: string }>({
      commandName: 'feedback',
      baseCommand: 'prlt feedback',
      jsonMode,
      flags: { action: flags.action },
    });

    resolver.addPrompt({
      flagName: 'action',
      type: 'list',
      message: 'Feedback & Issues - What would you like to do?',
      choices: () => [
        { name: 'Submit feedback', value: 'submit', command: 'prlt feedback submit --json' },
        { name: 'View my submissions', value: 'list', command: 'prlt feedback list --json' },
        { name: 'Browse issues', value: 'view', command: 'prlt feedback list --json' },
        { name: 'Cancel', value: 'cancel' },
      ],
      when: (ctx) => !ctx.flags.action,
      skipAutoCommand: true,
    });

    const resolved = await resolver.resolve();

    if (!resolved.action || resolved.action === 'cancel') {
      return;
    }

    // Run the selected subcommand
    switch (resolved.action) {
      case 'submit':
        await this.config.runCommand('feedback:submit', []);
        break;
      case 'list':
        await this.config.runCommand('feedback:list', []);
        break;
      case 'view':
        await this.config.runCommand('feedback:list', []);
        break;
    }
  }
}
