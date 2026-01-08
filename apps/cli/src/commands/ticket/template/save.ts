import { Command, Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class TicketTemplateSave extends Command {
  static description = 'Create a template from an existing ticket';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 "Bug Report Template"',
    '<%= config.bin %> <%= command.id %> TKT-042 "Feature Request" --description "Standard feature request template"',
  ];

  static args = {
    ticket: Args.string({
      description: 'Ticket ID to create template from',
      required: true,
    }),
    name: Args.string({
      description: 'Template name',
      required: true,
    }),
  };

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: current project)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TicketTemplateSave);

    const { storage, projectName } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Verify ticket exists
      const ticket = await storage.getTicket(args.ticket);
      if (!ticket) {
        await storage.close();
        this.error(`Ticket not found: ${args.ticket}\nRun 'prlt ticket list' to see available tickets.`);
      }

      // Create template from ticket
      const template = await storage.createTicketTemplateFromTicket(
        args.ticket,
        args.name,
        flags.description
      );

      await storage.close();

      this.log(styles.success(`\nCreated template "${styles.emphasis(template.name)}" from ticket ${args.ticket}`));
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
    } catch (error) {
      await storage.close();
      if (error instanceof Error && error.message.includes('already exists')) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
