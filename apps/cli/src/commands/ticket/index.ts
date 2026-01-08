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
        { name: 'Create from template', value: 'template' },
        { name: 'List all tickets', value: 'list' },
        { name: 'View ticket details', value: 'view' },
        { name: 'Edit ticket', value: 'edit' },
        { name: 'Move ticket (column)', value: 'move' },
        { name: 'Move to different project', value: 'project' },
        { name: 'Assign to epic', value: 'epic' },
        { name: 'Assign to spec', value: 'spec' },
        { name: 'Manage dependencies', value: 'link' },
        new inquirer.Separator('──────────────'),
        { name: 'Manage templates', value: 'templates' },
        { name: 'Delete ticket', value: 'delete' },
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
      case 'template':
        await this.config.runCommand('ticket:template:apply', []);
        break;
      case 'list':
        await this.config.runCommand('ticket:list', []);
        break;
      case 'view':
        await this.config.runCommand('ticket:view', []);
        break;
      case 'edit':
        await this.config.runCommand('ticket:edit', []);
        break;
      case 'move':
        await this.config.runCommand('ticket:move', []);
        break;
      case 'project':
        await this.config.runCommand('ticket:project', []);
        break;
      case 'epic':
        await this.config.runCommand('ticket:epic', []);
        break;
      case 'spec':
        await this.config.runCommand('ticket:spec', []);
        break;
      case 'link':
        await this.config.runCommand('ticket:link', []);
        break;
      case 'templates':
        await this.config.runCommand('ticket:template', []);
        break;
      case 'delete':
        await this.config.runCommand('ticket:delete', []);
        break;
    }
  }
}
