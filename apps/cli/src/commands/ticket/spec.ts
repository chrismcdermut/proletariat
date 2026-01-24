import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class TicketSpec extends PMOCommand {
  static description = 'Assign a spec to ticket(s)';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 SPEC-001',
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> TKT-001 --unlink',
    '<%= config.bin %> <%= command.id %> --bulk --spec SPEC-001',
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
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    unlink: Flags.boolean({
      char: 'u',
      description: 'Remove spec from ticket instead of adding',
      default: false,
    }),
    bulk: Flags.boolean({
      char: 'b',
      description: 'Enable bulk mode to assign spec to multiple tickets',
      default: false,
    }),
    spec: Flags.string({
      char: 's',
      description: 'Spec ID to assign (for bulk mode)',
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketSpec);
    const projectId = (flags as { project?: string }).project;

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Bulk mode
    if (flags.bulk) {
      await this.executeBulk(flags, projectId);
      return;
    }

    // Get all tickets
    const tickets = await this.storage.listTickets(projectId);
    if (tickets.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_TICKETS', 'No tickets found.', createMetadata('ticket spec', flags));
        return;
      }
      this.log(styles.muted('\nNo tickets found. Create one with: prlt ticket create'));
      return;
    }

    let ticketId = args.ticketId;

    // If no ticket ID provided, prompt for selection
    if (!ticketId) {
      const ticketChoices = tickets.map(t => {
        const specLabel = t.specId ? ` [spec: ${t.specId}]` : '';
        return {
          id: t.id,
          name: `${t.id} - ${t.title}${specLabel}`,
        };
      });

      const selected = await this.selectFromList({
        message: 'Select ticket:',
        items: ticketChoices,
        getName: (t) => t.name,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket spec ${t.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket spec' } : null,
      });

      if (!selected) {
        return;
      }
      ticketId = selected;
    }

    // Validate ticket exists
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) {
      this.error(`Ticket not found: ${ticketId}`);
    }

    // Handle unlink
    if (flags.unlink) {
      if (!ticket.specId) {
        this.log(styles.muted(`\nTicket ${ticketId} is not linked to any spec.`));
      } else {
        const oldSpecId = ticket.specId;
        await this.storage.updateTicket(ticketId!, { specId: undefined });
        await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));
        this.log(styles.success(`\n✅ Unlinked spec "${styles.emphasis(oldSpecId)}" from ticket ${styles.emphasis(ticketId!)}`));
      }
      return;
    }

    // Get all specs
    const specs = await this.storage.listSpecs();
    if (specs.length === 0) {
      this.log(styles.muted('\nNo specs found.'));
      const actionChoices = [
        { id: 'create', name: 'Create a new spec' },
        { id: 'cancel', name: 'Cancel' },
      ];

      const action = await this.selectFromList({
        message: 'What would you like to do?',
        items: actionChoices,
        getName: (a) => a.name,
        getValue: (a) => a.id,
        getCommand: (a) => a.id === 'create' ? 'prlt spec create --json' : '',
        jsonMode: jsonMode ? { flags, commandName: 'ticket spec' } : null,
      });

      if (action === 'create') {
        await this.config.runCommand('spec:create', []);
      }
      return;
    }

    let specId = args.specId;

    // If no spec ID provided, prompt for selection
    if (!specId) {
      const selected = await this.selectFromList({
        message: `Select spec to link to ${ticketId}:`,
        items: specs,
        getName: (s) => `${s.id} - ${s.title} (${s.status})`,
        getValue: (s) => s.id,
        getCommand: (s) => `prlt ticket spec ${ticketId} ${s.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket spec' } : null,
      });

      if (!selected) {
        return;
      }
      specId = selected;
    }

    // Validate spec exists
    const spec = specs.find(s => s.id === specId);
    if (!spec) {
      this.error(`Spec not found: ${specId}`);
    }

    // Check if already linked
    if (ticket.specId === specId) {
      this.log(styles.muted(`\nTicket "${ticketId}" is already linked to spec "${specId}".`));
      return;
    }

    // Warn if ticket has different spec
    if (ticket.specId) {
      this.log(styles.warning(`Ticket "${ticketId}" is currently linked to spec "${ticket.specId}"`));
      this.log(styles.muted(`This will replace the existing spec link.`));
    }

    // Reconciliation: Check if ticket's epic has a different spec
    if (ticket.epicId) {
      const epic = await this.storage.getEpic(ticket.epicId);
      if (epic?.specId && epic.specId !== specId) {
        this.log(styles.warning(`\n⚠️  Epic "${ticket.epicId}" uses spec "${epic.specId}", but you're assigning "${specId}" to this ticket.`));

        const actionChoices = [
          { id: 'proceed', name: `Proceed anyway (ticket will have different spec than epic)` },
          { id: 'use_epic', name: `Use epic's spec instead (${epic.specId})` },
          { id: 'cancel', name: 'Cancel' },
        ];

        const action = await this.selectFromList({
          message: 'How to handle spec mismatch?',
          items: actionChoices,
          getName: (a) => a.name,
          getValue: (a) => a.id,
          getCommand: (a) => a.id === 'use_epic' ? `prlt ticket spec ${ticketId} ${epic.specId} --json` : `prlt ticket spec ${ticketId} ${specId} --json`,
          jsonMode: jsonMode ? { flags, commandName: 'ticket spec' } : null,
        });

        if (action === 'cancel' || !action) {
          return;
        }

        if (action === 'use_epic') {
          specId = epic.specId;
        }
      }
    }

    // Link spec to ticket
    await this.storage.updateTicket(ticketId!, { specId });
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\n✅ Linked ticket ${styles.emphasis(ticketId!)} to spec ${styles.emphasis(specId!)}`));
    this.log(styles.muted(`   Spec: ${spec.title}`));
    this.log(styles.muted(`\nView ticket: prlt ticket view ${ticketId}`));
  }

  private async executeBulk(flags: { spec?: string; unlink: boolean }, projectId?: string): Promise<void> {
    this.log(styles.emphasis('📄 Bulk Assign Spec to Tickets\n'));

    // Get all tickets
    const tickets = await this.storage.listTickets(projectId);
    if (tickets.length === 0) {
      this.log(styles.muted('\nNo tickets found.'));
      return;
    }

    // Select tickets
    const { selectedTickets } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedTickets',
      message: 'Select tickets to update:',
      choices: tickets.map(t => {
        const specLabel = t.specId ? ` [spec: ${t.specId}]` : '';
        return {
          name: `${t.id} - ${t.title}${specLabel}`,
          value: t.id,
        };
      }),
    }]);

    if (selectedTickets.length === 0) {
      this.log(styles.muted('No tickets selected.'));
      return;
    }

    // Handle unlink - sequential for clear logging
    if (flags.unlink) {
      for (const ticketId of selectedTickets) {
        // eslint-disable-next-line no-await-in-loop
        await this.storage.updateTicket(ticketId, { specId: undefined });
        this.log(styles.success(`  Unlinked spec from ${ticketId}`));
      }
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));
      this.log(styles.success(`\n✅ Unlinked spec from ${selectedTickets.length} ticket(s)`));
      return;
    }

    // Get spec to assign
    let specId = flags.spec;

    if (!specId) {
      const specs = await this.storage.listSpecs();
      if (specs.length === 0) {
        this.log(styles.muted('\nNo specs found. Create one with: prlt spec create'));
        return;
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select spec to assign:',
        choices: specs.map(s => ({
          name: `${s.id} - ${s.title} (${s.status})`,
          value: s.id,
        })),
      }]);
      specId = selected;
    }

    // Validate spec
    const spec = await this.storage.getSpec(specId!);
    if (!spec) {
      this.error(`Spec not found: ${specId}`);
    }

    // Assign spec to all selected tickets - sequential for clear logging
    for (const ticketId of selectedTickets) {
      // eslint-disable-next-line no-await-in-loop
      await this.storage.updateTicket(ticketId, { specId });
      this.log(styles.success(`  Linked ${ticketId} to ${specId}`));
    }

    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\n✅ Linked ${selectedTickets.length} ticket(s) to spec "${spec.title}"`));
  }
}
