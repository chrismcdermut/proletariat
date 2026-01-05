import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../../lib/pmo/index.js';
import { PhaseTemplate } from '../../../lib/pmo/types.js';

export default class PhaseTemplateMenu extends Command {
  static description = 'Interactive menu for project phase template operations';

  static aliases = ['phase:templates'];

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
        message: '📊 Phase Templates - What would you like to do?',
        choices: [
          { name: 'List available templates', value: 'list' },
          { name: 'Apply template to workspace', value: 'apply' },
          { name: 'Save current phases as template', value: 'create' },
          new inquirer.Separator('──────────────'),
          { name: 'Update template', value: 'update' },
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
          await this.config.runCommand('phase:template:list', []);
          break;
        case 'apply': {
          const templateId = await this.selectTemplate(storage, 'Select template to apply:');
          await storage.close();
          if (templateId) {
            await this.config.runCommand('phase:template:apply', [templateId]);
          }
          break;
        }
        case 'create': {
          await storage.close();
          const { name } = await inquirer.prompt([{
            type: 'input',
            name: 'name',
            message: 'Template name:',
            validate: (input: string) => input.length > 0 || 'Name is required',
          }]);
          await this.config.runCommand('phase:template:create', [name]);
          break;
        }
        case 'update': {
          const customTemplates = (await storage.listPhaseTemplates()).filter(t => !t.isBuiltin);
          if (customTemplates.length === 0) {
            this.log('No custom templates to update. Built-in templates cannot be modified.');
            await storage.close();
            return;
          }
          const templateId = await this.selectTemplate(storage, 'Select template to update:', true);
          await storage.close();
          if (templateId) {
            await this.config.runCommand('phase:template:update', [templateId]);
          }
          break;
        }
        case 'delete': {
          const customTemplates = (await storage.listPhaseTemplates()).filter(t => !t.isBuiltin);
          if (customTemplates.length === 0) {
            this.log('No custom templates to delete. Built-in templates cannot be deleted.');
            await storage.close();
            return;
          }
          const templateId = await this.selectTemplate(storage, 'Select template to delete:', true);
          await storage.close();
          if (templateId) {
            await this.config.runCommand('phase:template:delete', [templateId]);
          }
          break;
        }
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private async selectTemplate(storage: { listPhaseTemplates: () => Promise<PhaseTemplate[]> }, message: string, customOnly = false): Promise<string | null> {
    let templates = await storage.listPhaseTemplates();
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
