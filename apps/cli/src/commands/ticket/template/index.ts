import { Command } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../../lib/pmo/index.js';
import { TicketTemplate } from '../../../lib/pmo/types.js';
import { styles } from '../../../lib/styles.js';

export default class TicketTemplateIndex extends Command {
  static description = 'Interactive menu for ticket template operations';

  static aliases = ['ticket:templates'];

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
        message: '📋 Ticket Templates - What would you like to do?',
        choices: [
          { name: 'List available templates', value: 'list' },
          { name: 'Create ticket from template', value: 'apply' },
          { name: 'Save ticket as template', value: 'save' },
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
          await this.config.runCommand('ticket:template:list', []);
          break;
        case 'apply': {
          const templateId = await this.selectTemplate(storage, 'Select template to use:');
          await storage.close();
          if (templateId) {
            await this.config.runCommand('ticket:template:apply', [templateId, '--interactive']);
          }
          break;
        }
        case 'save': {
          await storage.close();
          // Prompt for ticket ID and template name
          const saveAnswers = await inquirer.prompt([
            {
              type: 'input',
              name: 'ticketId',
              message: 'Ticket ID to save as template:',
              validate: (input: string) => input.length > 0 || 'Ticket ID is required',
            },
            {
              type: 'input',
              name: 'name',
              message: 'Template name:',
              validate: (input: string) => input.length > 0 || 'Name is required',
            },
          ]);
          await this.config.runCommand('ticket:template:save', [saveAnswers.ticketId, saveAnswers.name]);
          break;
        }
        case 'delete': {
          const customTemplates = (await storage.listTicketTemplates()).filter(t => !t.isBuiltin);
          if (customTemplates.length === 0) {
            this.log(styles.muted('No custom templates to delete. Built-in templates cannot be deleted.'));
            await storage.close();
            return;
          }
          const templateId = await this.selectTemplate(storage, 'Select template to delete:', true);
          await storage.close();
          if (templateId) {
            await this.config.runCommand('ticket:template:delete', [templateId]);
          }
          break;
        }
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private async selectTemplate(
    storage: { listTicketTemplates: () => Promise<TicketTemplate[]> },
    message: string,
    customOnly = false
  ): Promise<string | null> {
    let templates = await storage.listTicketTemplates();
    if (customOnly) {
      templates = templates.filter(t => !t.isBuiltin);
    }

    if (templates.length === 0) {
      this.log(styles.muted('No templates found.'));
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
