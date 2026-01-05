import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { findPMO } from '../../lib/pmo/index.js';

export default class Template extends Command {
  static description = 'Interactive menu for workflow template operations';

  static aliases = ['templates'];

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
      message: '📋 Workflow Templates - What would you like to do?',
      choices: [
        { name: 'List available templates', value: 'list' },
        { name: 'Apply template to project', value: 'apply' },
        { name: 'Save current workflow as template', value: 'save' },
        { name: 'Cancel', value: 'cancel' },
      ],
    }]);

    if (action === 'cancel') {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'list':
        await this.config.runCommand('template:list', []);
        break;
      case 'apply': {
        // First list templates, then prompt for selection
        await this.config.runCommand('template:list', []);
        const { templateId } = await inquirer.prompt([{
          type: 'input',
          name: 'templateId',
          message: 'Template ID to apply:',
          validate: (input: string) => input.length > 0 || 'Template ID is required',
        }]);
        await this.config.runCommand('template:apply', [templateId]);
        break;
      }
      case 'save': {
        const { name } = await inquirer.prompt([{
          type: 'input',
          name: 'name',
          message: 'Template name:',
          validate: (input: string) => input.length > 0 || 'Name is required',
        }]);
        await this.config.runCommand('template:save', ['--name', name]);
        break;
      }
    }
  }
}
