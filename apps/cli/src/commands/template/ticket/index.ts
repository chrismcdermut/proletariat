import { Command } from '@oclif/core';
import { styles } from '../../../lib/styles.js';
import { FlagResolver, shouldOutputJson } from '../../../lib/flags/index.js';
import { machineOutputFlags } from '../../../lib/pmo/index.js';

export default class TemplateTicket extends Command {
  static description = 'Manage ticket templates (for creating tickets from templates)';

  static aliases = ['template:tickets'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> apply bug-report',
    '<%= config.bin %> <%= command.id %> save TKT-001 "My Template"',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TemplateTicket);

    const jsonMode = shouldOutputJson(flags);

    // Create resolver for action selection
    const resolver = new FlagResolver<{ action?: string }>({
      commandName: 'template ticket',
      baseCommand: 'prlt template ticket',
      jsonMode,
      flags: {} as { action?: string },
    });

    resolver.addPrompt({
      flagName: 'action',
      type: 'list',
      message: 'What would you like to do?',
      choices: () => [
        { name: 'List ticket templates', value: 'list', command: 'prlt template ticket list --json' },
        { name: 'Create new template', value: 'create', command: 'prlt ticket template create --json' },
        { name: 'Create ticket from template', value: 'apply', command: 'prlt ticket template apply --json' },
        { name: 'Save ticket as template', value: 'save', command: 'prlt ticket template save --json' },
        { name: 'Delete ticket template', value: 'delete', command: 'prlt ticket template delete --json' },
      ],
    });

    // In JSON mode, this outputs the prompt and exits
    const resolved = await resolver.resolve();

    // Only reached in interactive mode
    this.log('');
    this.log(styles.header('Ticket Templates'));
    this.log('');

    switch (resolved.action) {
      case 'list':
        await this.config.runCommand('template:ticket:list', []);
        break;
      case 'create':
        await this.config.runCommand('ticket:template:create', []);
        break;
      case 'apply':
        await this.config.runCommand('ticket:template:apply', []);
        break;
      case 'save':
        await this.config.runCommand('ticket:template:save', []);
        break;
      case 'delete':
        await this.config.runCommand('ticket:template:delete', []);
        break;
    }
  }
}
