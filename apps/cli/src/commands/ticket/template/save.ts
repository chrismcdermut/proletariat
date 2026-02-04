import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../../lib/prompt-json.js';
import { FlagResolver } from '../../../lib/flags/index.js';

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

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket template save', flags));
        this.exit(1);
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

      const ticketResolver = new FlagResolver<{ ticket?: string }>({
        commandName: 'ticket template save',
        baseCommand: 'prlt ticket template save',
        jsonMode,
        flags: {},
      });

      ticketResolver.addPrompt({
        flagName: 'ticket',
        type: 'list',
        message: 'Select a ticket to save as template:',
        choices: () => tickets.slice(0, 20).map(t => ({
          name: `${t.id} - ${t.title}`,
          value: t.id,
        })),
        getCommand: (value) => {
          let cmd = `prlt ticket template save ${value}`;
          if (flags.project) cmd += ` -P ${flags.project}`;
          cmd += ' --json';
          return cmd;
        },
        when: () => true,
      });

      const ticketResolved = await ticketResolver.resolve();
      ticketId = ticketResolved.ticket;
    }

    // Verify ticket exists
    const ticket = await this.storage.getTicket(ticketId!);
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket not found: ${ticketId}\nRun 'prlt ticket list' to see available tickets.`);
    }

    // Get template name and description
    const nameDescResolver = new FlagResolver<{ name?: string; description?: string }>({
      commandName: 'ticket template save',
      baseCommand: `prlt ticket template save ${ticketId}`,
      jsonMode,
      flags: { name: args.name, description: flags.description },
    });

    nameDescResolver.addPrompt({
      flagName: 'name',
      type: 'input',
      message: 'Template name:',
      default: ticket.category || ticket.title.split(' ')[0],
      validate: (input: string) => (input as string).length > 0 || 'Name is required',
      when: (ctx) => !ctx.flags.name,
    });

    nameDescResolver.addPrompt({
      flagName: 'description',
      type: 'input',
      message: 'Description (optional):',
      when: (ctx) => ctx.flags.description === undefined,
    });

    const resolved = await nameDescResolver.resolve();

    const templateName = resolved.name!;
    const description = resolved.description || undefined;

    // Create template from ticket
    const template = await this.storage.createTicketTemplateFromTicket(
      ticketId!,
      templateName,
      description
    );

    if (jsonMode) {
      outputSuccessAsJson({
        id: template.id,
        name: template.name,
        description: template.description,
        ticketId,
        titlePattern: template.titlePattern,
        defaultPriority: template.defaultPriority,
        defaultCategory: template.defaultCategory,
        defaultStatusId: template.defaultStatusId,
        defaultAssignee: template.defaultAssignee,
        defaultOwner: template.defaultOwner,
        defaultLabels: template.defaultLabels,
        suggestedSubtasks: template.suggestedSubtasks.length,
      }, createMetadata('ticket template save', flags));
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
