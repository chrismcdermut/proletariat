import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

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
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketTemplateSave);

    // Get ticket ID - prompt with picker if not provided
    let ticketId = args.ticket;
    if (!ticketId) {
      const projectId = await this.requireProject();
      const tickets = await this.storage.listTickets(projectId);
      if (tickets.length === 0) {
        this.error('No tickets found in this project.\nCreate a ticket first: prlt ticket create');
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
      this.error(`Ticket not found: ${ticketId}\nRun 'prlt ticket list' to see available tickets.`);
    }

    // Get template name - prompt if not provided
    let templateName = args.name;
    if (!templateName) {
      const { name } = await inquirer.prompt([{
        type: 'input',
        name: 'name',
        message: 'Template name:',
        default: ticket.category || ticket.title.split(' ')[0],
        validate: (input: string) => input.length > 0 || 'Name is required',
      }]);
      templateName = name;
    }

    // Get description if not provided
    let description = flags.description;
    if (description === undefined) {
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
