import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { findPMO } from '../../lib/pmo/index.js';

export default class Spec extends Command {
  static description = 'Interactive menu for spec operations';

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
      message: '📄 Spec Operations - What would you like to do?',
      choices: [
        { name: 'Create new spec', value: 'create' },
        { name: 'List all specs', value: 'list' },
        { name: 'View spec', value: 'view' },
        { name: 'Generate tickets from spec', value: 'generate' },
        { name: 'Assign ticket to spec', value: 'ticket' },
        { name: 'Manage dependencies', value: 'link' },
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
        await this.config.runCommand('spec:create', []);
        break;
      case 'list':
        await this.config.runCommand('spec:list', []);
        break;
      case 'view':
        await this.config.runCommand('spec:view', []);
        break;
      case 'generate':
        await this.config.runCommand('spec:generate-tickets', []);
        break;
      case 'ticket':
        await this.config.runCommand('spec:ticket', []);
        break;
      case 'link':
        await this.config.runCommand('spec:link', []);
        break;
    }
  }
}
