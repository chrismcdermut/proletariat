import { Command } from '@oclif/core';
import { styles } from '../../../lib/styles.js';
import { FlagResolver, shouldOutputJson } from '../../../lib/flags/index.js';
import { machineOutputFlags } from '../../../lib/pmo/index.js';

export default class TemplatePhase extends Command {
  static description = 'Manage phase templates (project lifecycle phases)';

  static aliases = ['template:phases'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> apply agile',
    '<%= config.bin %> <%= command.id %> create "My Phases"',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TemplatePhase);

    const jsonMode = shouldOutputJson(flags);

    // Create resolver for action selection
    const resolver = new FlagResolver<{ action?: string }>({
      commandName: 'template phase',
      baseCommand: 'prlt template phase',
      jsonMode,
      flags: {} as { action?: string },
    });

    resolver.addPrompt({
      flagName: 'action',
      type: 'list',
      message: 'What would you like to do?',
      choices: () => [
        { name: 'List phase templates', value: 'list', command: 'prlt template phase list --json' },
        { name: 'Apply a phase template to project', value: 'apply', command: 'prlt phase template apply --json' },
        { name: 'Create a new phase template', value: 'create', command: 'prlt phase template create --json' },
        { name: 'Update a phase template', value: 'update', command: 'prlt phase template update --json' },
        { name: 'Delete a phase template', value: 'delete', command: 'prlt phase template delete --json' },
      ],
    });

    // In JSON mode, this outputs the prompt and exits
    const resolved = await resolver.resolve();

    // Only reached in interactive mode
    this.log('');
    this.log(styles.header('Phase Templates'));
    this.log('');

    switch (resolved.action) {
      case 'list':
        await this.config.runCommand('template:phase:list', []);
        break;
      case 'apply':
        await this.config.runCommand('phase:template:apply', []);
        break;
      case 'create':
        await this.config.runCommand('phase:template:create', []);
        break;
      case 'update':
        await this.config.runCommand('phase:template:update', []);
        break;
      case 'delete':
        await this.config.runCommand('phase:template:delete', []);
        break;
    }
  }
}
