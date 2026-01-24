import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class Epic extends PMOCommand {
  static description = 'Interactive menu for epic operations';

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
    const { flags } = await this.parse(Epic);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    // Each choice includes the full command for AI agents to execute
    const menuChoices = [
      { id: 'create', name: 'Create new epic', command: 'prlt epic create --json' },
      { id: 'list', name: 'List all epics', command: 'prlt epic list --format json' },
      { id: 'view', name: 'View epic', command: 'prlt epic view --json' },
      { id: 'progress', name: 'Show progress', command: 'prlt epic progress --json' },
      { id: 'ticket', name: 'Assign tickets to epic', command: 'prlt epic ticket --json' },
      { id: 'spec', name: 'Assign spec to epic', command: 'prlt epic spec --json' },
      { id: 'link', name: 'Manage dependencies', command: 'prlt epic link --json' },
      { id: 'archive', name: 'Archive epic (complete)', command: 'prlt epic archive --json' },
      { id: 'activate', name: 'Activate epic', command: 'prlt epic activate --json' },
      { id: 'move', name: 'Reorder epic', command: 'prlt epic move --json' },
      { id: 'project', name: 'Move to different project', command: 'prlt epic project --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];
    const message = 'Epic Operations - What would you like to do?';

    const action = await this.selectFromList({
      message: '🎯 ' + message,
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'epic' } : null,
    });

    if (action === 'cancel' || !action) {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'create':
        await this.config.runCommand('epic:create', []);
        break;
      case 'list':
        await this.config.runCommand('epic:list', []);
        break;
      case 'view':
        await this.config.runCommand('epic:view', []);
        break;
      case 'progress':
        await this.config.runCommand('epic:progress', []);
        break;
      case 'ticket':
        await this.config.runCommand('epic:ticket', []);
        break;
      case 'spec':
        await this.config.runCommand('epic:spec', []);
        break;
      case 'link':
        await this.config.runCommand('epic:link', []);
        break;
      case 'archive':
        await this.config.runCommand('epic:archive', []);
        break;
      case 'activate':
        await this.config.runCommand('epic:activate', []);
        break;
      case 'move':
        await this.config.runCommand('epic:move', []);
        break;
      case 'project':
        await this.config.runCommand('epic:project', []);
        break;
    }
  }
}
