import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { WorkAction } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

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
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
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
    const menuChoices = [
      { name: 'List all actions', value: 'list' },
      { name: 'View action details', value: 'show' },
      { name: 'Create custom action', value: 'create' },
      { name: 'Update action', value: 'update' },
      { name: 'Delete action', value: 'delete' },
      { name: 'Cancel', value: 'cancel' },
    ];
    const message = 'Work Actions - What would you like to do?';

    // In JSON mode, output menu prompt
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices),
        createMetadata('action', flags)
      );
      return;
    }

    // Show interactive menu (with separator after create)
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: '🎬 ' + message,
      choices: [
        menuChoices[0],
        menuChoices[1],
        menuChoices[2],
        new inquirer.Separator('──────────────'),
        menuChoices[3],
        menuChoices[4],
        menuChoices[5],
      ],
    }]);

    if (action === 'cancel') {
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
