import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { findPMO } from '../../lib/pmo/index.js';

export default class Project extends Command {
  static description = 'Interactive menu for project operations';

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
      message: '📁 Project Operations - What would you like to do?',
      choices: [
        { name: 'Create new project', value: 'create' },
        { name: 'List all projects', value: 'list' },
        { name: 'View project board', value: 'view' },
        { name: 'Manage project specs', value: 'spec' },
        { name: 'Delete project', value: 'delete' },
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
