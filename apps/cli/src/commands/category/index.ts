import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';
import { CategoryType } from '../../lib/pmo/types.js';

export default class CategoryIndex extends PMOCommand {
  static description = 'Interactive menu for category operations (ticket and status categories)';

  static aliases = ['categories'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --type ticket',
    '<%= config.bin %> <%= command.id %> --type status',
  ];

  static flags = {
    ...pmoBaseFlags,
    type: Flags.string({
      char: 't',
      description: 'Category type to manage',
      options: ['ticket', 'status'],
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(CategoryIndex);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // First, determine the category type
    let categoryType: CategoryType | null = flags.type as CategoryType | null;

    if (!categoryType) {
      const typeChoices = [
        { id: 'ticket', name: 'Ticket Categories (feature, bug, etc.)', command: 'prlt category --type ticket' },
        { id: 'status', name: 'Status Categories (backlog, started, etc.)', command: 'prlt category --type status' },
        { id: 'cancel', name: 'Cancel', command: '' },
      ];

      const selectedType = await this.selectFromList({
        message: '📁 Which category type would you like to manage?',
        items: typeChoices,
        getName: (c) => c.name,
        getValue: (c) => c.id,
        getCommand: (c) => c.command,
        jsonMode: jsonMode ? { flags, commandName: 'category' } : null,
      });

      if (selectedType === 'cancel' || !selectedType) {
        return;
      }

      categoryType = selectedType as CategoryType;
    }

    // Now show the action menu
    const menuChoices = [
      { id: 'list', name: 'List all categories', command: `prlt category list --type ${categoryType}` },
      { id: 'create', name: 'Create new category', command: `prlt category create --type ${categoryType} --json` },
      { id: 'rename', name: 'Rename category', command: `prlt category rename --type ${categoryType} --json` },
      { id: 'delete', name: 'Delete category', command: `prlt category delete --type ${categoryType} --json` },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];

    const action = await this.selectFromList({
      message: `📁 ${categoryType.charAt(0).toUpperCase() + categoryType.slice(1)} Categories - What would you like to do?`,
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags: { ...flags, type: categoryType }, commandName: 'category' } : null,
    });

    if (action === 'cancel' || !action) {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'list':
        await this.config.runCommand('category:list', ['--type', categoryType]);
        break;
      case 'create':
        await this.config.runCommand('category:create', ['--type', categoryType]);
        break;
      case 'rename':
        await this.config.runCommand('category:rename', ['--type', categoryType]);
        break;
      case 'delete':
        await this.config.runCommand('category:delete', ['--type', categoryType]);
        break;
    }
  }
}
