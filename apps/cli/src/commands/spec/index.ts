import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class Spec extends PMOCommand {
  static description = 'Interactive menu for spec operations';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Spec);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    // Each choice includes the full command for AI agents to execute
    const menuChoices = [
      { id: 'create', name: 'Create new spec', command: 'prlt spec create --json' },
      { id: 'list', name: 'List all specs', command: 'prlt spec list --format json' },
      { id: 'view', name: 'View spec', command: 'prlt spec view --json' },
      { id: 'generate', name: 'Generate tickets from spec', command: 'prlt spec plan --json' },
      { id: 'ticket', name: 'Assign ticket to spec', command: 'prlt spec ticket --json' },
      { id: 'link', name: 'Manage dependencies', command: 'prlt spec link --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];
    const message = 'Spec Operations - What would you like to do?';

    const action = await this.selectFromList({
      message: '📄 ' + message,
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'spec' } : null,
    });

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
