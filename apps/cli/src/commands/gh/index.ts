import { Command } from '@oclif/core';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';

export default class GH extends Command {
  static description = 'GitHub CLI setup and status for PR workflow';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> status',
    '<%= config.bin %> <%= command.id %> login',
    '<%= config.bin %> <%= command.id %> token',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GH);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Use FlagResolver for the menu selection
    const resolver = new FlagResolver<{ action?: string }>({
      commandName: 'gh',
      baseCommand: 'prlt gh',
      jsonMode,
      flags: {},  // No flags to resolve from CLI args for this menu command
    });

    // Add prompt for action selection
    resolver.addPrompt({
      flagName: 'action',
      type: 'list',
      message: 'GitHub CLI Setup',
      choices: () => [
        { name: 'Check status', value: 'status', command: 'prlt gh status --json' },
        { name: 'Login to GitHub', value: 'login', command: 'prlt gh login --json' },
        { name: 'Show GH_TOKEN setup', value: 'token', command: 'prlt gh token --json' },
      ],
      skipAutoCommand: true,  // Use our custom commands above
    });

    // Resolve - in JSON mode this outputs the prompt and exits
    const resolved = await resolver.resolve();

    // Execute the selected action
    switch (resolved.action) {
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
