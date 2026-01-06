import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TicketSpec extends Command {
  static description = 'Assign a spec to a ticket';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 SPEC-001',
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TKT-001 --unlink',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID',
      required: false,
    }),
    specId: Args.string({
      description: 'Spec ID to link',
      required: false,
    }),
  };

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: current)',
    }),
    unlink: Flags.boolean({
      char: 'u',
      description: 'Remove spec from ticket instead of adding',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TicketSpec);

    const { storage, pmoPath } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Get all tickets
      const tickets = await storage.listTickets();
      if (tickets.length === 0) {
        this.log(styles.muted('\nNo tickets found. Create one with: prlt ticket create'));
        await storage.close();
        return;
      }

      let ticketId = args.ticketId;

      // If no ticket ID provided, prompt for selection
      if (!ticketId) {
        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select ticket:',
          choices: tickets.map(t => {
            const specLabel = t.specId ? ` [spec: ${t.specId}]` : '';
            return {
              name: `${t.id} - ${t.title}${specLabel}`,
              value: t.id,
            };
          }),
        }]);
        ticketId = selected;
      }

      // Validate ticket exists
      const ticket = tickets.find(t => t.id === ticketId);
      if (!ticket) {
        await storage.close();
        this.error(`Ticket not found: ${ticketId}`);
      }

      // Handle unlink
      if (flags.unlink) {
        if (!ticket.specId) {
          this.log(styles.muted(`\nTicket ${ticketId} is not linked to any spec.`));
        } else {
          const oldSpecId = ticket.specId;
          await storage.updateTicket(ticketId!, { specId: undefined });
          await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));
          this.log(styles.success(`\n✅ Unlinked spec "${styles.emphasis(oldSpecId)}" from ticket ${styles.emphasis(ticketId!)}`));
        }
        await storage.close();
        return;
      }

      // Get all specs
      const specs = await storage.listSpecs();
      if (specs.length === 0) {
        this.log(styles.muted('\nNo specs found.'));
        const { action } = await inquirer.prompt([{
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: 'Create a new spec', value: 'create' },
            { name: 'Cancel', value: 'cancel' },
          ],
        }]);

        await storage.close();

        if (action === 'create') {
          await this.config.runCommand('spec:create', []);
        }
        return;
      }

      let specId = args.specId;

      // If no spec ID provided, prompt for selection
      if (!specId) {
        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: `Select spec to link to ${ticketId}:`,
          choices: specs.map(s => ({
            name: `${s.id} - ${s.title} (${s.status})`,
            value: s.id,
          })),
        }]);
        specId = selected;
      }

      // Validate spec exists
      const spec = specs.find(s => s.id === specId);
      if (!spec) {
        await storage.close();
        this.error(`Spec not found: ${specId}`);
      }

      // Check if already linked
      if (ticket.specId === specId) {
        this.log(styles.muted(`\nTicket "${ticketId}" is already linked to spec "${specId}".`));
        await storage.close();
        return;
      }

      // Warn if ticket has different spec
      if (ticket.specId) {
        this.log(styles.warning(`Ticket "${ticketId}" is currently linked to spec "${ticket.specId}"`));
        this.log(styles.muted(`This will replace the existing spec link.`));
      }

      // Reconciliation: Check if ticket's epic has a different spec
      if (ticket.epicId) {
        const epic = await storage.getEpic(ticket.epicId);
        if (epic?.specId && epic.specId !== specId) {
          this.log(styles.warning(`\n⚠️  Epic "${ticket.epicId}" uses spec "${epic.specId}", but you're assigning "${specId}" to this ticket.`));
          const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: 'How to handle spec mismatch?',
            choices: [
              { name: `Proceed anyway (ticket will have different spec than epic)`, value: 'proceed' },
              { name: `Use epic's spec instead (${epic.specId})`, value: 'use_epic' },
              { name: 'Cancel', value: 'cancel' },
            ],
          }]);

          if (action === 'cancel') {
            await storage.close();
            return;
          }

          if (action === 'use_epic') {
            specId = epic.specId;
          }
        }
      }

      // Link spec to ticket
      await storage.updateTicket(ticketId!, { specId });
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));
      await storage.close();

      this.log(styles.success(`\n✅ Linked ticket ${styles.emphasis(ticketId!)} to spec ${styles.emphasis(specId!)}`));
      this.log(styles.muted(`   Spec: ${spec.title}`));
      this.log(styles.muted(`\nView ticket: prlt ticket view ${ticketId}`));

    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
