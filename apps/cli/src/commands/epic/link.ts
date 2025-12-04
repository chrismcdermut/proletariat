import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Ticket } from '../../lib/pmo/types.js';

export default class EpicLink extends Command {
  static description = 'Link tickets to an epic, or link epic to a spec';

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001 TKT-001 TKT-002',
    '<%= config.bin %> <%= command.id %> EPIC-001',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> EPIC-001 --unlink TKT-001',
    '<%= config.bin %> <%= command.id %> EPIC-001 --spec SPEC-001',
  ];

  static args = {
    id: Args.string({
      description: 'Epic ID',
      required: false,
    }),
    tickets: Args.string({
      description: 'Ticket IDs to link (space-separated)',
      required: false,
      multiple: true,
    }),
  };

  static strict = false; // Allow multiple ticket arguments

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
    unlink: Flags.boolean({
      char: 'u',
      description: 'Remove tickets from this epic instead of adding',
      default: false,
    }),
    spec: Flags.string({
      char: 's',
      description: 'Link epic to a spec (design document)',
    }),
    'unlink-spec': Flags.boolean({
      description: 'Remove spec link from epic',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags, argv } = await this.parse(EpicLink);

    const { storage, pmoPath } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Get all epics
      const epics = await storage.listEpics();
      if (epics.length === 0) {
        this.log(styles.muted('\nNo epics found. Create one with: prlt epic create'));
        await storage.close();
        return;
      }

      // Get all tickets
      const allTickets = await storage.listTickets();
      if (allTickets.length === 0) {
        this.log(styles.muted('\nNo tickets found.'));
        await storage.close();
        return;
      }

      // Get epic_id for each ticket via direct DB query
      const db = (storage as unknown as { db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown; run: (...args: unknown[]) => void } } }).db;
      const getTicketEpicId = (ticketId: string): string | null => {
        const row = db.prepare(`SELECT epic_id FROM pmo_tickets WHERE id = ?`).get(ticketId) as { epic_id: string | null } | undefined;
        return row?.epic_id || null;
      };

      let epicId = args.id;

      // If no epic ID provided, prompt for selection
      if (!epicId) {
        // Count tickets per epic
        const ticketCounts = new Map<string, number>();
        for (const ticket of allTickets) {
          const tid = getTicketEpicId(ticket.id);
          if (tid) {
            ticketCounts.set(tid, (ticketCounts.get(tid) || 0) + 1);
          }
        }

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select epic to link tickets to:',
          choices: epics.map(e => ({
            name: `${e.id} ${e.title} (${e.status}) [${ticketCounts.get(e.id) || 0} tickets]`,
            value: e.id,
          })),
        }]);
        epicId = selected;
      }

      // Validate epic exists
      const epic = epics.find(e => e.id === epicId);
      if (!epic) {
        this.error(`Epic not found: ${epicId}`);
      }

      // Handle spec linking if --spec or --unlink-spec provided
      if (flags.spec || flags['unlink-spec']) {
        if (flags['unlink-spec']) {
          // Unlink spec from epic
          if (!epic.specId) {
            this.log(styles.muted(`\nEpic ${epicId} is not linked to any spec.`));
          } else {
            await storage.updateEpic(epicId!, { specId: undefined });
            this.log(styles.success(`\n✅ Unlinked spec from ${styles.emphasis(epicId!)} "${epic.title}"`));
          }
        } else {
          // Link spec to epic
          const spec = await storage.getSpec(flags.spec!);
          if (!spec) {
            await storage.close();
            this.error(`Spec not found: ${flags.spec}`);
          }

          await storage.updateEpic(epicId!, { specId: flags.spec });
          this.log(styles.success(`\n✅ Linked ${styles.emphasis(epicId!)} "${epic.title}" to spec ${styles.emphasis(flags.spec!)}`));
          this.log(styles.muted(`   Spec: ${spec.title || spec.path}`));
        }

        // If only spec operation, exit here
        const argvStrings = argv as string[];
        if (argvStrings.length <= 1 && !flags.unlink) {
          await storage.close();
          return;
        }
      }

      // Get ticket IDs from remaining argv (after epic ID)
      let ticketIds: string[] = [];
      const argvStrings = argv as string[];
      if (argvStrings.length > 1) {
        ticketIds = argvStrings.slice(1);
      }

      // If no ticket IDs provided, prompt with multi-select
      if (ticketIds.length === 0) {
        const choices = allTickets.map((t: Ticket) => {
          const currentEpicId = getTicketEpicId(t.id);
          let epicLabel = 'No epic';
          if (currentEpicId === epicId) {
            epicLabel = `${epicId} ← current`;
          } else if (currentEpicId) {
            const currentEpic = epics.find(e => e.id === currentEpicId);
            epicLabel = currentEpic?.title || currentEpicId;
          }
          return {
            name: `${t.id} - ${t.title} [${epicLabel}]`,
            value: t.id,
            checked: false,
          };
        });

        const { selected } = await inquirer.prompt([{
          type: 'checkbox',
          name: 'selected',
          message: `Select tickets to ${flags.unlink ? 'unlink from' : 'link to'} ${epicId}:`,
          choices,
        }]);

        ticketIds = selected;
      }

      if (ticketIds.length === 0) {
        this.log(styles.muted('\nNo tickets selected.'));
        await storage.close();
        return;
      }

      // Validate all tickets exist
      const invalidTickets = ticketIds.filter(id => !allTickets.find((t: Ticket) => t.id === id));
      if (invalidTickets.length > 0) {
        this.error(`Tickets not found: ${invalidTickets.join(', ')}`);
      }

      // Process each ticket
      let successCount = 0;
      const linkedTickets: string[] = [];

      for (const ticketId of ticketIds) {
        const ticket = allTickets.find((t: Ticket) => t.id === ticketId)!;
        const currentEpicId = getTicketEpicId(ticketId);

        if (flags.unlink) {
          // Unlink: only if currently linked to this epic
          if (currentEpicId !== epicId) {
            this.log(styles.muted(`  ${ticketId} is not linked to ${epicId}, skipping`));
            continue;
          }

          db.prepare(`
            UPDATE pmo_tickets
            SET epic_id = NULL, updated_at = ?
            WHERE id = ?
          `).run(Date.now(), ticketId);
        } else {
          // Link: check if already linked to same epic
          if (currentEpicId === epicId) {
            this.log(styles.muted(`  ${ticketId} already linked to ${epicId}, skipping`));
            continue;
          }

          // Warn if linked to different epic
          if (currentEpicId) {
            const currentEpic = epics.find(e => e.id === currentEpicId);
            this.log(styles.warning(`  ${ticketId} was linked to ${currentEpic?.title || currentEpicId}, reassigning`));
          }

          db.prepare(`
            UPDATE pmo_tickets
            SET epic_id = ?, updated_at = ?
            WHERE id = ?
          `).run(epicId, Date.now(), ticketId);
        }

        linkedTickets.push(`${ticketId}: ${ticket.title}`);
        successCount++;
      }

      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));
      await storage.close();

      if (successCount === 0) {
        this.log(styles.muted('\nNo changes made.'));
        return;
      }

      const action = flags.unlink ? 'Unlinked' : 'Linked';
      this.log(styles.success(`\n✅ ${action} ${successCount} ticket${successCount === 1 ? '' : 's'} ${flags.unlink ? 'from' : 'to'} ${styles.emphasis(epicId!)} "${epic.title}"`));
      for (const t of linkedTickets) {
        this.log(styles.muted(`   ${t}`));
      }
      this.log(styles.muted(`\nView epic: prlt epic view ${epicId}`));

    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
