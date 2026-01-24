import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class Project extends PMOCommand {
  static description = 'Interactive menu for project operations';

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
    const { flags } = await this.parse(Project);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    // Each choice includes the full command for AI agents to execute
    const menuChoices = [
      { id: 'create', name: 'Create new project', command: 'prlt project create --json' },
      { id: 'list', name: 'List all projects', command: 'prlt project list --format json' },
      { id: 'view', name: 'View project board', command: 'prlt project view --json' },
      { id: 'spec', name: 'Manage project specs', command: 'prlt project spec --json' },
      { id: 'delete', name: 'Delete project', command: 'prlt project delete --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];
    const message = 'Project Operations - What would you like to do?';

    const action = await this.selectFromList({
      message,
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'project' } : null,
    });

    if (action === 'cancel' || !action) {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'create':
        await this.config.runCommand('project:create', []);
        break;
      case 'list':
        await this.config.runCommand('project:list', []);
        break;
      case 'view':
        await this.config.runCommand('project:view', []);
        break;
      case 'spec':
        await this.config.runCommand('project:spec', []);
        break;
      case 'delete':
        await this.config.runCommand('project:delete', []);
        break;
    }
  }
}
