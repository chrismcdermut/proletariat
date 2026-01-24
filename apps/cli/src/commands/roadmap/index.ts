import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class Roadmap extends PMOCommand {
  static description = 'Interactive menu for roadmap operations';

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
    const { flags } = await this.parse(Roadmap);
    const jsonMode = shouldOutputJson(flags);

    const menuChoices = [
      { id: 'create', name: 'Create new roadmap', command: 'prlt roadmap create --json' },
      { id: 'list', name: 'List all roadmaps', command: 'prlt roadmap list --json' },
      { id: 'view', name: 'View roadmap details', command: 'prlt roadmap view --json' },
      { id: 'generate', name: 'Generate roadmap markdown', command: 'prlt roadmap generate --json' },
      { id: 'update', name: 'Update roadmap', command: 'prlt roadmap update --json' },
      { id: 'delete', name: 'Delete roadmap', command: 'prlt roadmap delete --json' },
      { id: 'add-project', name: 'Add project to roadmap', command: 'prlt roadmap add-project --json' },
      { id: 'remove-project', name: 'Remove project from roadmap', command: 'prlt roadmap remove-project --json' },
      { id: 'reorder', name: 'Reorder projects in roadmap', command: 'prlt roadmap reorder --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];
    const message = 'Roadmap Operations - What would you like to do?';

    const action = await this.selectFromList({
      message,
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'roadmap' } : null,
    });

    if (action === 'cancel' || !action) {
      return;
    }

    const commandMap: Record<string, string> = {
      'create': 'roadmap:create',
      'list': 'roadmap:list',
      'view': 'roadmap:view',
      'generate': 'roadmap:generate',
      'update': 'roadmap:update',
      'delete': 'roadmap:delete',
      'add-project': 'roadmap:add-project',
      'remove-project': 'roadmap:remove-project',
      'reorder': 'roadmap:reorder',
    };

    if (commandMap[action]) {
      await this.config.runCommand(commandMap[action], []);
    }
  }
}
