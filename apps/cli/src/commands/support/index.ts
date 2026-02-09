import { Command } from '@oclif/core';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';

/**
 * Support URLs - centralized for consistency
 */
export const SUPPORT_URLS = {
  calcom: 'https://cal.com/chrismcdermut',
  discord: 'https://discord.gg/tmZyjNNSvw',
  issues: 'https://github.com/chrismcdermut/proletariat/issues',
  docs: 'https://github.com/chrismcdermut/proletariat#readme',
  npm: 'https://www.npmjs.com/package/@proletariat/cli',
};

export default class Support extends Command {
  static description = 'Get help, troubleshoot, and connect with the community';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> book',
    '<%= config.bin %> <%= command.id %> docs',
    '<%= config.bin %> <%= command.id %> discord',
    '<%= config.bin %> <%= command.id %> issues',
    '<%= config.bin %> <%= command.id %> logs',
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
      message: 'How can we help?',
      choices: () => [
        { name: 'Book a call', value: 'book', command: 'prlt support book --json' },
        { name: 'Documentation', value: 'docs', command: 'prlt support docs --json' },
        { name: 'Report a bug', value: 'bug', command: 'prlt feedback submit --category bug --json' },
        { name: 'Request a feature', value: 'feature', command: 'prlt feedback submit --category feature --json' },
        { name: 'Join Discord', value: 'discord', command: 'prlt support discord --json' },
        { name: 'Browse issues', value: 'issues', command: 'prlt support issues --json' },
        { name: 'Collect diagnostics', value: 'logs', command: 'prlt support logs --json' },
      ],
      skipAutoCommand: true,
    });

    // Resolve - in JSON mode this outputs the prompt and exits
    const resolved = await resolver.resolve();

    // Execute the selected action
    switch (resolved.action) {
      case 'book':
        await this.config.runCommand('support book');
        break;
      case 'docs':
        await this.config.runCommand('support docs');
        break;
      case 'bug':
        await this.config.runCommand('feedback submit', ['--category', 'bug']);
        break;
      case 'feature':
        await this.config.runCommand('feedback submit', ['--category', 'feature']);
        break;
      case 'discord':
        await this.config.runCommand('support discord');
        break;
      case 'issues':
        await this.config.runCommand('support issues');
        break;
      case 'logs':
        await this.config.runCommand('support logs');
        break;
    }
  }
}
