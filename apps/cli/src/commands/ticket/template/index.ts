import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { TicketTemplate } from '../../../lib/pmo/types.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class TicketTemplateIndex extends PMOCommand {
  static description = 'Interactive menu for ticket template operations';

  static aliases = ['ticket:templates'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(TicketTemplateIndex);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    const menuChoices = [
      { id: 'list', name: 'List available templates', command: 'prlt ticket template list --format json' },
      { id: 'create', name: 'Create new template', command: 'prlt ticket template create --json' },
      { id: 'apply', name: 'Create ticket from template', command: 'prlt ticket template apply --json' },
      { id: 'save', name: 'Save ticket as template', command: 'prlt ticket template save --json' },
      { id: 'delete', name: 'Delete template', command: 'prlt ticket template delete --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];
    const message = 'Ticket Templates - What would you like to do?';

    const action = await this.selectFromList({
      message: '📋 ' + message,
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'ticket template' } : null,
    });

    if (action === 'cancel' || !action) {
      return;
    }

    // Run the selected subcommand
    switch (action) {
      case 'list':
        await this.config.runCommand('ticket:template:list', []);
        break;
      case 'create':
        await this.config.runCommand('ticket:template:create', []);
        break;
      case 'apply': {
        const templateId = await this.selectTemplate('Select template to use:');
        if (templateId) {
          await this.config.runCommand('ticket:template:apply', [templateId, '--interactive']);
        }
        break;
      }
      case 'save': {
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
        const customTemplates = (await this.storage.listTicketTemplates()).filter(t => !t.isBuiltin);
        if (customTemplates.length === 0) {
          this.log(styles.muted('No custom templates to delete. Built-in templates cannot be deleted.'));
          return;
        }
        const templateId = await this.selectTemplate('Select template to delete:', true);
        if (templateId) {
          await this.config.runCommand('ticket:template:delete', [templateId]);
        }
        break;
      }
    }
  }

  private async selectTemplate(
    message: string,
    customOnly = false
  ): Promise<string | null> {
    let templates = await this.storage.listTicketTemplates();
    if (customOnly) {
      templates = templates.filter(t => !t.isBuiltin);
    }

    if (templates.length === 0) {
      this.log(styles.muted('No templates found.'));
      return null;
    }

    const templateChoices = templates.map(t => ({
      id: t.id,
      name: `${t.name} (${t.id})${t.isBuiltin ? '' : ' [custom]'}`,
    }));

    const selected = await this.selectFromList({
      message,
      items: templateChoices,
      getName: (t) => t.name,
      getValue: (t) => t.id,
      getCommand: (t) => `prlt ticket template apply ${t.id} --json`,
      allowCancel: true,
    });

    return selected;
  }
}
