import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { findPMO } from '../../lib/pmo/index.js';

export default class Epic extends Command {
  static description = 'Interactive menu for epic operations';

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
      message: '🎯 Epic Operations - What would you like to do?',
      choices: [
        { name: 'Create new epic', value: 'create' },
        { name: 'List all epics', value: 'list' },
        { name: 'View epic', value: 'view' },
        { name: 'Show progress', value: 'progress' },
        { name: 'Link tickets to epic', value: 'link' },
        new inquirer.Separator(),
        { name: 'Archive epic (complete)', value: 'archive' },
        { name: 'Activate epic', value: 'activate' },
        { name: 'Move epic', value: 'move' },
        new inquirer.Separator(),
        { name: 'Cancel', value: 'cancel' },
      ],
    }]);

    if (action === 'cancel') {
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
    }
  }
}
