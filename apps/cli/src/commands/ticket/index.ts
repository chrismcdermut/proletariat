import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { findPMO } from '../../lib/pmo/index.js';

export default class Ticket extends Command {
  static description = 'Interactive menu for ticket operations';

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
      message: '🎫 Ticket Operations - What would you like to do?',
      choices: [
        { name: 'Create new ticket', value: 'create' },
        { name: 'List all tickets', value: 'list' },
        { name: 'View ticket details', value: 'view' },
        { name: 'Move ticket', value: 'move' },
        { name: 'Link ticket to epic', value: 'link' },
        new inquirer.Separator(),
        { name: 'Assign ticket', value: 'assign' },
        { name: 'Claim ticket', value: 'claim' },
        { name: 'Delete ticket', value: 'delete' },
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
        await this.config.runCommand('ticket:create', []);
        break;
      case 'list':
        await this.config.runCommand('ticket:list', []);
        break;
      case 'view':
        await this.config.runCommand('ticket:view', []);
        break;
      case 'move':
        await this.config.runCommand('ticket:move', []);
        break;
      case 'link':
        await this.config.runCommand('ticket:link', []);
        break;
      case 'assign':
        await this.config.runCommand('ticket:assign', []);
        break;
      case 'claim':
        await this.config.runCommand('ticket:claim', []);
        break;
      case 'delete':
        await this.config.runCommand('ticket:delete', []);
        break;
    }
  }
}
