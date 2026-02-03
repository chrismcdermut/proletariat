import { Command } from '@oclif/core';
import { styles } from '../../lib/styles.js';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';

export default class Template extends Command {
  static description = 'Manage templates (ticket and phase)';

  static aliases = ['templates'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> list --type ticket',
    '<%= config.bin %> <%= command.id %> ticket',
    '<%= config.bin %> <%= command.id %> phase',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Template);

    const jsonMode = shouldOutputJson(flags);

    // Create resolver for action selection
    const resolver = new FlagResolver<{ action?: string }>({
      commandName: 'template',
      baseCommand: 'prlt template',
      jsonMode,
      flags: {} as { action?: string },
    });

    resolver.addPrompt({
      flagName: 'action',
      type: 'list',
      message: 'What would you like to do?',
      choices: () => [
        { name: 'List all templates', value: 'list', command: 'prlt template list --json' },
        { name: 'Ticket templates (ticket presets)', value: 'ticket', command: 'prlt template ticket --json' },
        { name: 'Phase templates (project phases)', value: 'phase', command: 'prlt template phase --json' },
      ],
    });

    // In JSON mode, this outputs the prompt and exits
    // In interactive mode, this prompts and returns the value
    const resolved = await resolver.resolve();

    // Only reached in interactive mode
    this.log('');
    this.log(styles.header('Templates'));
    this.log('');

    switch (resolved.action) {
      case 'list':
        await this.config.runCommand('template:list', []);
        break;
      case 'ticket':
        await this.config.runCommand('template:ticket', []);
        break;
      case 'phase':
        await this.config.runCommand('template:phase', []);
        break;
    }
  }
}
