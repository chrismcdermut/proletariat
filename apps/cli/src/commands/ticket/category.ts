import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class TicketCategory extends PMOCommand {
  static description = 'Manage ticket categories (feature, bug, refactor, etc.)';

  static aliases = ['ticket:categories'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> create spike',
    '<%= config.bin %> <%= command.id %> rename spike investigation',
    '<%= config.bin %> <%= command.id %> delete spike',
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
    const { flags } = await this.parse(TicketCategory);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Show the action menu for ticket categories
    const menuChoices = [
      { id: 'list', name: 'List all ticket categories', command: 'prlt category list --type ticket' },
      { id: 'create', name: 'Create new ticket category', command: 'prlt category create --type ticket --json' },
      { id: 'rename', name: 'Rename ticket category', command: 'prlt category rename --type ticket --json' },
      { id: 'delete', name: 'Delete ticket category', command: 'prlt category delete --type ticket --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];

    const action = await this.selectFromList({
      message: '🏷️ Ticket Categories - What would you like to do?',
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'ticket category' } : null,
    });

    if (action === 'cancel' || !action) {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'list':
        await this.config.runCommand('category:list', ['--type', 'ticket']);
        break;
      case 'create':
        await this.config.runCommand('category:create', ['--type', 'ticket']);
        break;
      case 'rename':
        await this.config.runCommand('category:rename', ['--type', 'ticket']);
        break;
      case 'delete':
        await this.config.runCommand('category:delete', ['--type', 'ticket']);
        break;
    }
  }
}
