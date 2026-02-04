import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class Spec extends PMOCommand {
  static description = 'Interactive menu for spec operations';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Spec);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices for the menu
    const menuChoices = [
      { name: 'Create new spec', value: 'create' },
      { name: 'List all specs', value: 'list' },
      { name: 'View spec', value: 'view' },
      { name: 'Generate tickets from spec', value: 'generate' },
      { name: 'Assign ticket to spec', value: 'ticket' },
      { name: 'Manage dependencies', value: 'link' },
      { name: 'Cancel', value: 'cancel' },
    ];

    // Use FlagResolver for action selection
    const resolver = new FlagResolver<{ action?: string }>({
      commandName: 'spec',
      baseCommand: 'prlt spec',
      jsonMode,
      flags: {},
    });

    resolver.addPrompt({
      flagName: 'action',
      type: 'list',
      message: '📄 Spec Operations - What would you like to do?',
      choices: () => menuChoices,
      // Custom command builder for menu items
      getCommand: (value) => {
        const commands: Record<string, string> = {
          create: 'prlt spec create --json',
          list: 'prlt spec list --json',
          view: 'prlt spec view --json',
          generate: 'prlt spec plan --json',
          ticket: 'prlt spec ticket --json',
          link: 'prlt spec link --json',
          cancel: '',
        };
        return commands[value as string] || '';
      },
    });

    const resolved = await resolver.resolve();
    const action = resolved.action;

    if (action === 'cancel' || !action) {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'create':
        await this.config.runCommand('spec:create', []);
        break;
      case 'list':
        await this.config.runCommand('spec:list', []);
        break;
      case 'view':
        await this.config.runCommand('spec:view', []);
        break;
      case 'generate':
        await this.config.runCommand('spec:generate-tickets', []);
        break;
      case 'ticket':
        await this.config.runCommand('spec:ticket', []);
        break;
      case 'link':
        await this.config.runCommand('spec:link', []);
        break;
    }
  }
}
