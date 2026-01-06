import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { findPMO } from '../../lib/pmo/index.js';

export default class Status extends Command {
  static description = 'Interactive menu for workflow status operations';

  static aliases = ['statuses'];

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
      message: '📊 Workflow Statuses - What would you like to do?',
      choices: [
        { name: 'List all statuses', value: 'list' },
        { name: 'Create new status', value: 'create' },
        { name: 'Update status', value: 'update' },
        { name: 'Move status (change order)', value: 'move' },
        new inquirer.Separator('──────────────'),
        { name: 'Delete status', value: 'delete' },
        { name: 'Cancel', value: 'cancel' },
      ],
    }]);

    if (action === 'cancel') {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'list':
        await this.config.runCommand('status:list', []);
        break;
      case 'create':
        await this.config.runCommand('status:create', ['--interactive']);
        break;
      case 'update': {
        // First list statuses, then prompt for selection
        await this.config.runCommand('status:list', []);
        const { statusId } = await inquirer.prompt([{
          type: 'input',
          name: 'statusId',
          message: 'Status ID to update:',
          validate: (input: string) => input.length > 0 || 'Status ID is required',
        }]);
        await this.config.runCommand('status:update', [statusId]);
        break;
      }
      case 'move': {
        await this.config.runCommand('status:list', []);
        const { statusId } = await inquirer.prompt([{
          type: 'input',
          name: 'statusId',
          message: 'Status ID to move:',
          validate: (input: string) => input.length > 0 || 'Status ID is required',
        }]);
        await this.config.runCommand('status:move', [statusId]);
        break;
      }
      case 'delete': {
        await this.config.runCommand('status:list', []);
        const { statusId } = await inquirer.prompt([{
          type: 'input',
          name: 'statusId',
          message: 'Status ID to delete:',
          validate: (input: string) => input.length > 0 || 'Status ID is required',
        }]);
        await this.config.runCommand('status:delete', [statusId]);
        break;
      }
    }
  }
}
