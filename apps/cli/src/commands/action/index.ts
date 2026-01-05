import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { WorkAction } from '../../lib/pmo/types.js';

export default class Action extends Command {
  static description = 'Interactive menu for work action operations';

  static aliases = ['actions'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    const { storage } = await getPMOContext(
      undefined,
      () => {},
      false
    );

    try {
      // Show interactive menu
      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: '🎬 Work Actions - What would you like to do?',
        choices: [
          { name: 'List all actions', value: 'list' },
          { name: 'View action details', value: 'show' },
          { name: 'Create custom action', value: 'create' },
          new inquirer.Separator('──────────────'),
          { name: 'Update action', value: 'update' },
          { name: 'Delete action', value: 'delete' },
          { name: 'Cancel', value: 'cancel' },
        ],
      }]);

      if (action === 'cancel') {
        await storage.close();
        return;
      }

      // Run the selected subcommand
      switch (action) {
        case 'list':
          await storage.close();
          await this.config.runCommand('action:list', []);
          break;
        case 'show': {
          const actionId = await this.selectAction(storage, 'Select action to view:');
          await storage.close();
          if (actionId) {
            await this.config.runCommand('action:show', [actionId]);
          }
          break;
        }
        case 'create':
          await storage.close();
          await this.config.runCommand('action:create', []);
          break;
        case 'update': {
          const actionId = await this.selectAction(storage, 'Select action to update:');
          await storage.close();
          if (actionId) {
            await this.config.runCommand('action:update', [actionId]);
          }
          break;
        }
        case 'delete': {
          const customActions = (await storage.listActions()).filter(a => !a.isBuiltin);
          if (customActions.length === 0) {
            this.log('No custom actions to delete. Built-in actions cannot be deleted.');
            await storage.close();
            return;
          }
          const actionId = await this.selectAction(storage, 'Select action to delete:', true);
          await storage.close();
          if (actionId) {
            await this.config.runCommand('action:delete', [actionId]);
          }
          break;
        }
      }
    } catch (error) {
      await storage.close();
      throw error;
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
