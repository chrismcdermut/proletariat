import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { findPMO } from '../../lib/pmo/index.js';

export default class Action extends Command {
  static description = 'Interactive menu for work action operations';

  static aliases = ['actions'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

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
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'list':
        await this.config.runCommand('action:list', []);
        break;
      case 'show': {
        // Prompt for action ID
        const { actionId } = await inquirer.prompt([{
          type: 'input',
          name: 'actionId',
          message: 'Action ID:',
          validate: (input: string) => input.length > 0 || 'Action ID is required',
        }]);
        await this.config.runCommand('action:show', [actionId]);
        break;
      }
      case 'create':
        await this.config.runCommand('action:create', []);
        break;
      case 'update': {
        const { actionId } = await inquirer.prompt([{
          type: 'input',
          name: 'actionId',
          message: 'Action ID to update:',
          validate: (input: string) => input.length > 0 || 'Action ID is required',
        }]);
        await this.config.runCommand('action:update', [actionId]);
        break;
      }
      case 'delete': {
        const { actionId } = await inquirer.prompt([{
          type: 'input',
          name: 'actionId',
          message: 'Action ID to delete:',
          validate: (input: string) => input.length > 0 || 'Action ID is required',
        }]);
        await this.config.runCommand('action:delete', [actionId]);
        break;
      }
    }
  }
}
