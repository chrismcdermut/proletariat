import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { findPMO } from '../../lib/pmo/index.js';

export default class PR extends Command {
  static description = 'Interactive menu for pull request operations';

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
      message: 'Pull Request Operations - What would you like to do?',
      choices: [
        { name: 'Create PR from current branch', value: 'create' },
        { name: 'Link existing PR to ticket', value: 'link' },
        { name: 'View PR status for ticket', value: 'status' },
        new inquirer.Separator('──────────────'),
        { name: 'Cancel', value: 'cancel' },
      ],
    }]);

    if (action === 'cancel') {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'create':
        await this.config.runCommand('pr:create', []);
        break;
      case 'link':
        await this.config.runCommand('pr:link', []);
        break;
      case 'status':
        await this.config.runCommand('pr:status', []);
        break;
    }
  }
}
