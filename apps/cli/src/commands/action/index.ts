import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { WorkAction } from '../../lib/pmo/types.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class Action extends PMOCommand {
  static description = 'Interactive menu for work action operations';

  static aliases = ['actions'];

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
    const { flags } = await this.parse(Action);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    // Each choice includes the full command for AI agents to execute
    const menuChoices = [
      { id: 'list', name: 'List all actions', command: 'prlt action list --format json' },
      { id: 'show', name: 'View action details', command: 'prlt action show --json' },
      { id: 'create', name: 'Create custom action', command: 'prlt action create --json' },
      { id: 'update', name: 'Update action', command: 'prlt action update --json' },
      { id: 'delete', name: 'Delete action', command: 'prlt action delete --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];
    const message = 'Work Actions - What would you like to do?';

    const action = await this.selectFromList({
      message: '🎬 ' + message,
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'action' } : null,
    });

    if (action === 'cancel' || !action) {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'list':
        await this.config.runCommand('action:list', []);
        break;
      case 'show': {
        const actionId = await this.selectAction(this.storage, 'Select action to view:');
        if (actionId) {
          await this.config.runCommand('action:show', [actionId]);
        }
        break;
      }
      case 'create':
        await this.config.runCommand('action:create', []);
        break;
      case 'update': {
        const actionId = await this.selectAction(this.storage, 'Select action to update:');
        if (actionId) {
          await this.config.runCommand('action:update', [actionId]);
        }
        break;
      }
      case 'delete': {
        const customActions = (await this.storage.listActions()).filter(a => !a.isBuiltin);
        if (customActions.length === 0) {
          this.log('No custom actions to delete. Built-in actions cannot be deleted.');
          return;
        }
        const actionId = await this.selectAction(this.storage, 'Select action to delete:', true);
        if (actionId) {
          await this.config.runCommand('action:delete', [actionId]);
        }
        break;
      }
    }
  }

  private async selectAction(storage: { listActions: () => Promise<WorkAction[]> }, message: string, customOnly = false): Promise<string | null> {
    let actions = await storage.listActions();
    if (customOnly) {
      actions = actions.filter(a => !a.isBuiltin);
    }

    if (actions.length === 0) {
      this.log('No actions found.');
      return null;
    }

    const { selected } = await inquirer.prompt([{
      type: 'list',
      name: 'selected',
      message,
      choices: [
        ...actions.map(a => ({
          name: `${a.name} (${a.id})${a.isBuiltin ? '' : ' [custom]'}`,
          value: a.id,
        })),
        new inquirer.Separator(),
        { name: 'Cancel', value: null },
      ],
    }]);

    return selected;
  }
}
