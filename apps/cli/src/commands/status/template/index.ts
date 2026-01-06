import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../../lib/pmo/index.js';
import { WorkflowTemplate } from '../../../lib/pmo/types.js';

export default class StatusTemplate extends Command {
  static description = 'Interactive menu for workflow status template operations';

  static aliases = ['status:templates'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    const { storage } = await getPMOContext(
      undefined,
      () => {},
      false
    );

    try {
      // Show interactive menu
      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: '📋 Status Templates - What would you like to do?',
        choices: [
          { name: 'List available templates', value: 'list' },
          { name: 'Apply template to project', value: 'apply' },
          { name: 'Save current workflow as template', value: 'save' },
          new inquirer.Separator('──────────────'),
          { name: 'Delete template', value: 'delete' },
          { name: 'Cancel', value: 'cancel' },
        ],
      }]);

      if (action === 'cancel') {
        await storage.close();
        return;
      }

      // Run the selected subcommand
      switch (action) {
        case 'list':
          await storage.close();
          await this.config.runCommand('status:template:list', []);
          break;
        case 'apply': {
          const templateId = await this.selectTemplate(storage, 'Select template to apply:');
          await storage.close();
          if (templateId) {
            await this.config.runCommand('status:template:apply', [templateId]);
          }
          break;
        }
        case 'save': {
          await storage.close();
          const { name } = await inquirer.prompt([{
            type: 'input',
            name: 'name',
            message: 'Template name:',
            validate: (input: string) => input.length > 0 || 'Name is required',
          }]);
          await this.config.runCommand('status:template:save', [name]);
          break;
        }
        case 'delete': {
          const customTemplates = (await storage.listTemplates()).filter(t => !t.isBuiltin);
          if (customTemplates.length === 0) {
            this.log('No custom templates to delete. Built-in templates cannot be deleted.');
            await storage.close();
            return;
          }
          const templateId = await this.selectTemplate(storage, 'Select template to delete:', true);
          await storage.close();
          if (templateId) {
            await this.config.runCommand('status:template:delete', [templateId]);
          }
          break;
        }
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private async selectTemplate(storage: { listTemplates: () => Promise<WorkflowTemplate[]> }, message: string, customOnly = false): Promise<string | null> {
    let templates = await storage.listTemplates();
    if (customOnly) {
      templates = templates.filter(t => !t.isBuiltin);
    }

    if (templates.length === 0) {
      this.log('No templates found.');
      return null;
    }

    const { selected } = await inquirer.prompt([{
      type: 'list',
      name: 'selected',
      message,
      choices: [
        ...templates.map(t => ({
          name: `${t.name} (${t.id})${t.isBuiltin ? '' : ' [custom]'}`,
          value: t.id,
        })),
        new inquirer.Separator(),
        { name: 'Cancel', value: null },
      ],
    }]);

    return selected;
  }
}
