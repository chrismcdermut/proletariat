import { Flags } from '@oclif/core';
import { styles } from '../../lib/styles.js';
import { shouldOutputJson, outputPromptAsJson, buildPromptConfig, createMetadata } from '../../lib/prompt-json.js';
import { PromptCommand } from '../../lib/prompt-command.js';

export default class Template extends PromptCommand {
  static description = 'Manage templates (ticket and phase)';

  static aliases = ['templates'];

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> list --type ticket',
    '<%= config.bin %> <%= command.id %> create --type ticket "Bug Report"',
    '<%= config.bin %> <%= command.id %> apply --type phase agile',
  ];

  static flags = {
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output as JSON for AI agents/scripts',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Template);
    const jsonMode = shouldOutputJson(flags);

    const menuChoices = [
      { name: 'List templates', value: 'list', command: 'prlt template list --json' },
      { name: 'Create template', value: 'create', command: 'prlt template create --json' },
      { name: 'Apply template', value: 'apply', command: 'prlt template apply --json' },
      { name: 'Save ticket as template', value: 'save', command: 'prlt template save --json' },
      { name: 'Update phase template', value: 'update', command: 'prlt template update --json' },
      { name: 'Delete template', value: 'delete', command: 'prlt template delete --json' },
      { name: 'Cancel', value: 'cancel', command: '' },
    ];

    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', 'What would you like to do?', menuChoices),
        createMetadata('template', flags)
      );
      return;
    }

    this.log(`\n${styles.emphasis('Templates')}`);
    this.log(styles.muted('Manage ticket and phase templates\n'));

    const { action } = await this.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: menuChoices.map(c => ({ name: c.name, value: c.value, command: c.command })),
    }], null);

    if (action === 'cancel') return;

    switch (action) {
      case 'list':
        await this.config.runCommand('template:list', []);
        break;
      case 'create':
        await this.config.runCommand('template:create', []);
        break;
      case 'apply':
        await this.config.runCommand('template:apply', []);
        break;
      case 'save':
        await this.config.runCommand('template:save', []);
        break;
      case 'update':
        await this.config.runCommand('template:update', []);
        break;
      case 'delete':
        await this.config.runCommand('template:delete', []);
        break;
    }
  }
}
