import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class TemplateSave extends PMOCommand {
  static description = 'Create a ticket template from an existing ticket';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 "Bug Report Template"',
    '<%= config.bin %> <%= command.id %> TKT-042 "Feature Request" -d "Standard feature request"',
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
      description: 'Template name (alternative to positional arg)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output as JSON for AI agents/scripts',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TemplateSave);
    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('template save', flags));
      }
      this.error(message);
    };

    // Get ticket ID
    let ticketId = args.ticket;
    if (!ticketId) {
      const projectId = await this.requireProject();
      const tickets = await this.storage.listTickets(projectId);
      if (tickets.length === 0) {
        return handleError('NO_TICKETS', 'No tickets found. Create a ticket first.');
      }

      if (jsonMode) {
        const choices = tickets.slice(0, 20).map(t => ({ name: `${t.id} - ${t.title}`, value: t.id }));
        outputPromptAsJson(buildPromptConfig('list', 'ticket', 'Select ticket:', choices), createMetadata('template save', flags));
        return;
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select ticket:',
        choices: tickets.slice(0, 20).map(t => ({ name: `${t.id} - ${t.title}`, value: t.id })),
      }]);
      ticketId = selected;
    }

    const ticket = await this.storage.getTicket(ticketId!);
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket not found: ${ticketId}`);
    }

    // Get template name
    let templateName = flags['template-name'] || args.name;
    if (!templateName) {
      if (jsonMode) {
        outputPromptAsJson(buildPromptConfig('input', 'name', 'Template name:', undefined, ticket.category || ticket.title.split(' ')[0]), createMetadata('template save', flags));
        return;
      }

      const { name } = await inquirer.prompt([{
        type: 'input',
        name: 'name',
        message: 'Template name:',
        default: ticket.category || ticket.title.split(' ')[0],
        validate: (i: string) => i.length > 0 || 'Required',
      }]);
      templateName = name;
    }

    // Get description
    let description = flags.description;
    if (description === undefined && !jsonMode) {
      const { desc } = await inquirer.prompt([{ type: 'input', name: 'desc', message: 'Description (optional):' }]);
      description = desc || undefined;
    }

    const template = await this.storage.createTicketTemplateFromTicket(ticketId!, templateName!, description);

    if (jsonMode) {
      outputSuccessAsJson({ template, sourceTicketId: ticketId }, createMetadata('template save', flags));
      return;
    }

    this.log(styles.success(`\nCreated template "${styles.emphasis(template.name)}" from ${ticketId}`));
    this.log(styles.muted(`  ID: ${template.id}`));
    this.log(styles.muted(`\nApply with: prlt template apply --type ticket ${template.id}`));
  }
}
