import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class StatusCategory extends PMOCommand {
  static description = 'Manage status categories (backlog, started, completed, etc.)';

  static aliases = ['status:categories'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> create reviewing',
    '<%= config.bin %> <%= command.id %> rename reviewing in-review',
    '<%= config.bin %> <%= command.id %> delete reviewing',
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
    const { flags } = await this.parse(StatusCategory);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Show the action menu for status categories
    const menuChoices = [
      { id: 'list', name: 'List all status categories', command: 'prlt category list --type status' },
      { id: 'create', name: 'Create new status category', command: 'prlt category create --type status --json' },
      { id: 'rename', name: 'Rename status category', command: 'prlt category rename --type status --json' },
      { id: 'delete', name: 'Delete status category', command: 'prlt category delete --type status --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];

    const action = await this.selectFromList({
      message: '📊 Status Categories - What would you like to do?',
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'status category' } : null,
    });

    if (action === 'cancel' || !action) {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'list':
        await this.config.runCommand('category:list', ['--type', 'status']);
        break;
      case 'create':
        await this.config.runCommand('category:create', ['--type', 'status']);
        break;
      case 'rename':
        await this.config.runCommand('category:rename', ['--type', 'status']);
        break;
      case 'delete':
        await this.config.runCommand('category:delete', ['--type', 'status']);
        break;
    }
  }
}
