import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
  buildFormPromptConfig,
  FormField,
} from '../../../lib/prompt-json.js';

export default class TicketTemplateSave extends PMOCommand {
  static description = 'Create a template from an existing ticket';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 "Bug Report Template"',
    '<%= config.bin %> <%= command.id %> TKT-042 "Feature Request" --description "Standard feature request template"',
  ];

  static args = {
    ticket: Args.string({
      description: 'Ticket ID to create template from',
      required: false,
    }),
    name: Args.string({
      description: 'Template name',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    'template-name': Flags.string({
      char: 'n',
      description: 'Template name (alternative to positional arg, required in non-TTY/JSON mode)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketTemplateSave);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket template save', flags));
      }
      this.error(message);
    };

    // Get ticket ID - prompt with picker if not provided
    let ticketId = args.ticket;
    if (!ticketId) {
      const projectId = await this.requireProject();
      const tickets = await this.storage.listTickets(projectId);
      if (tickets.length === 0) {
        return handleError('NO_TICKETS', 'No tickets found in this project.\nCreate a ticket first: prlt ticket create');
      }

      // In JSON mode, output prompt config for ticket selection
      if (jsonMode) {
        const choices = tickets.slice(0, 20).map(t => ({
          name: `${t.id} - ${t.title}`,
          value: t.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'ticket', 'Select a ticket to save as template:', choices),
          createMetadata('ticket template save', flags)
        );
      }

      const { selectedTicket } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedTicket',
        message: 'Select a ticket to save as template:',
        choices: tickets.slice(0, 20).map(t => ({
          name: `${t.id} - ${t.title}`,
          value: t.id,
        })),
      }]);
      ticketId = selectedTicket;
    }

    // Verify ticket exists
    const ticket = await this.storage.getTicket(ticketId!);
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket not found: ${ticketId}\nRun 'prlt ticket list' to see available tickets.`);
    }

    // Get template name - prefer flag over positional arg
    let templateName = flags['template-name'] || args.name;
    if (!templateName) {
      const defaultName = ticket.category || ticket.title.split(' ')[0];

      // In JSON mode, output prompt config for template name
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('input', 'name', 'Template name:', undefined, defaultName),
          createMetadata('ticket template save', flags)
        );
      }

      const { name } = await inquirer.prompt([{
        type: 'input',
        name: 'name',
        message: 'Template name:',
        default: defaultName,
        validate: (input: string) => input.length > 0 || 'Name is required',
      }]);
      templateName = name;
    }

    // Get description if not provided - only prompt interactively (not in JSON mode)
    let description = flags.description;
    if (description === undefined && !jsonMode) {
      const { desc } = await inquirer.prompt([{
        type: 'input',
        name: 'desc',
        message: 'Description (optional):',
      }]);
      description = desc || undefined;
    }

    // Create template from ticket
    const template = await this.storage.createTicketTemplateFromTicket(
      ticketId!,
      templateName!,
      description
    );

    // In JSON mode, output success as JSON
    if (jsonMode) {
      outputSuccessAsJson(
        {
          template: {
            id: template.id,
            name: template.name,
            description: template.description,
            titlePattern: template.titlePattern,
            defaultPriority: template.defaultPriority,
            defaultCategory: template.defaultCategory,
            defaultStatusId: template.defaultStatusId,
            defaultAssignee: template.defaultAssignee,
            defaultOwner: template.defaultOwner,
            defaultLabels: template.defaultLabels,
            suggestedSubtasks: template.suggestedSubtasks,
          },
          sourceTicketId: ticketId,
        },
        createMetadata('ticket template save', flags)
      );
      return;
    }

    this.log(styles.success(`\nCreated template "${styles.emphasis(template.name)}" from ticket ${ticketId}`));
    this.log(styles.muted(`  ID: ${template.id}`));
    if (template.description) {
      this.log(styles.muted(`  Description: ${template.description}`));
    }
    if (template.titlePattern) {
      this.log(styles.muted(`  Title pattern: ${template.titlePattern}`));
    }
    if (template.defaultPriority) {
      this.log(styles.muted(`  Default priority: ${template.defaultPriority}`));
    }
    if (template.defaultCategory) {
      this.log(styles.muted(`  Default category: ${template.defaultCategory}`));
    }
    if (template.defaultStatusId) {
      this.log(styles.muted(`  Default status: ${template.defaultStatusId}`));
    }
    if (template.defaultAssignee) {
      this.log(styles.muted(`  Default assignee: ${template.defaultAssignee}`));
    }
    if (template.defaultOwner) {
      this.log(styles.muted(`  Default owner: ${template.defaultOwner}`));
    }
    if (template.defaultLabels && template.defaultLabels.length > 0) {
      this.log(styles.muted(`  Default labels: ${template.defaultLabels.join(', ')}`));
    }
    if (template.suggestedSubtasks.length > 0) {
      this.log(styles.muted(`  Subtasks: ${template.suggestedSubtasks.length}`));
    }
    this.log('');
    this.log(styles.muted(`Create ticket from template: prlt ticket template apply ${template.id}`));
  }
}
