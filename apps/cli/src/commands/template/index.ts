import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { styles } from '../../lib/styles.js';

export default class Template extends Command {
  static description = 'Manage templates for statuses (ticket workflows) or phases (project lifecycle)';

  static aliases = ['templates'];

  static examples = [
    '<%= config.bin %> template',
    '<%= config.bin %> status template',
    '<%= config.bin %> phase template',
  ];

  async run(): Promise<void> {
    this.log('');
    this.log(styles.header('📋 Templates'));
    this.log('');

    const { templateType } = await inquirer.prompt([{
      type: 'list',
      name: 'templateType',
      message: 'What type of template?',
      choices: [
        {
          name: 'Status Templates (ticket workflow states)',
          value: 'status',
        },
        {
          name: 'Phase Templates (project lifecycle phases)',
          value: 'phase',
        },
      ],
    }]);

    if (templateType === 'status') {
      await this.config.runCommand('status:template', []);
    } else {
      await this.config.runCommand('phase:template', []);
    }
  }
}
