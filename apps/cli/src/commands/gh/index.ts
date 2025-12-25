import { Command } from '@oclif/core';
import inquirer from 'inquirer';

export default class GH extends Command {
  static description = 'GitHub CLI setup and status for PR workflow';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> status',
    '<%= config.bin %> <%= command.id %> login',
    '<%= config.bin %> <%= command.id %> token',
  ];

  async run(): Promise<void> {
    // Interactive menu when no subcommand provided
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'GitHub CLI Setup',
      choices: [
        { name: 'Check status', value: 'status' },
        { name: 'Login to GitHub', value: 'login' },
        { name: 'Show GH_TOKEN setup', value: 'token' },
      ],
    }]);

    switch (action) {
      case 'status':
        await this.config.runCommand('gh status');
        break;
      case 'login':
        await this.config.runCommand('gh login');
        break;
      case 'token':
        await this.config.runCommand('gh token');
        break;
    }
  }
}
