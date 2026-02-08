import { Command } from '@oclif/core';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';

export default class Support extends Command {
  static description = 'Support and help resources for prlt';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> docs',
    '<%= config.bin %> <%= command.id %> discord',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Support);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Use FlagResolver for the menu selection
    const resolver = new FlagResolver<{ action?: string }>({
      commandName: 'support',
      baseCommand: 'prlt support',
      jsonMode,
      flags: {},
    });

    // Add prompt for action selection
    resolver.addPrompt({
      flagName: 'action',
      type: 'list',
      message: 'Support Resources',
      choices: () => [
        { name: 'Open documentation', value: 'docs', command: 'prlt support docs --json' },
        { name: 'Join Discord', value: 'discord', command: 'prlt support discord --json' },
        { name: 'Report an issue', value: 'issues', command: 'prlt support issues --json' },
        { name: 'Book a call', value: 'call', command: 'prlt support call --json' },
      ],
      skipAutoCommand: true,
    });

    // Resolve - in JSON mode this outputs the prompt and exits
    const resolved = await resolver.resolve();

    // Execute the selected action
    switch (resolved.action) {
      case 'docs':
        await this.config.runCommand('support docs');
        break;
      case 'discord':
        await this.config.runCommand('support discord');
        break;
      case 'issues':
        await this.config.runCommand('support issues');
        break;
      case 'call':
        await this.config.runCommand('support call');
        break;
    }
  }
}
