import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Ticket } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class EpicTicket extends PMOCommand {
  static description = 'Assign tickets to an epic, or link epic to a spec (parent-child)';

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
    ...pmoBaseFlags,
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
    reconcile: Flags.string({
      description: 'How to handle spec mismatch: keep (keep ticket spec), epic (use epic spec), skip',
      options: ['keep', 'epic', 'skip'],
    }),
    'inherit-spec': Flags.boolean({
      description: 'Inherit spec from epic when ticket has no spec',
      allowNo: true,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags, argv } = await this.parse(EpicTicket);
    const filterProjectId = (flags as { project?: string }).project;

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('epic ticket', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const projectId = await this.requireProject();

    // Get all epics
    const epics = await this.storage.listEpics(projectId);
    if (epics.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_EPICS', 'No epics found.', createMetadata('epic ticket', flags));
        return;
      }
      this.log(styles.muted('\nNo epics found. Create one with: prlt epic create'));
      return;
    }

    // Get all tickets
    const allTickets = await this.storage.listTickets(filterProjectId);
    if (allTickets.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_TICKETS', 'No tickets found.', createMetadata('epic ticket', flags));
        return;
      }
      this.log(styles.muted('\nNo tickets found.'));
      return;
    }

    // Helper to get ticket's epic ID from the loaded ticket list
    const getTicketEpicId = (ticketId: string): string | null => {
      const ticket = allTickets.find((t: Ticket) => t.id === ticketId);
      return ticket?.epicId ?? null;
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

      const epicChoices = epics.map(e => ({
        name: `${e.id} ${e.title} (${e.status}) [${ticketCounts.get(e.id) || 0} tickets]`,
        value: e.id,
        command: `prlt epic ticket ${e.id} --json`,
      }));

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic ticket' } : null;
      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select epic to link tickets to:',
        choices: epicChoices,
      }], jsonModeConfig);
      epicId = selected;
    }

    // Validate epic exists
    const epic = epics.find(e => e.id === epicId);
    if (!epic) {
      return handleError('EPIC_NOT_FOUND', `Epic not found: ${epicId}`);
    }

    // Handle spec linking if --spec or --unlink-spec provided
    if (flags.spec || flags['unlink-spec']) {
      if (flags['unlink-spec']) {
        // Unlink spec from epic
        if (!epic.specId) {
          this.log(styles.muted(`\nEpic ${epicId} is not linked to any spec.`));
        } else {
          await this.storage.updateEpic(epicId!, { specId: undefined });
          this.log(styles.success(`\n✅ Unlinked spec from ${styles.emphasis(epicId!)} "${epic.title}"`));
        }
      } else {
        // Link spec to epic
        const spec = await this.storage.getSpec(flags.spec!);
        if (!spec) {
          this.error(`Spec not found: ${flags.spec}`);
        }

        await this.storage.updateEpic(epicId!, { specId: flags.spec });
        this.log(styles.success(`\n✅ Linked ${styles.emphasis(epicId!)} "${epic.title}" to spec ${styles.emphasis(flags.spec!)}`));
        this.log(styles.muted(`   Spec: ${spec.title}`));
      }

      // If only spec operation, exit here
      const argvStrings = argv as string[];
      if (argvStrings.length <= 1 && !flags.unlink) {
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
          command: `prlt epic ticket ${epicId} ${t.id} --json`,
        };
      });

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic ticket' } : null;
      const { selected } = await this.prompt<{ selected: string[] }>([{
        type: 'checkbox',
        name: 'selected',
        message: `Select tickets to ${flags.unlink ? 'unlink from' : 'link to'} ${epicId}:`,
        choices,
      }], jsonModeConfig);

      ticketIds = selected;
    }

    if (ticketIds.length === 0) {
      this.log(styles.muted('\nNo tickets selected.'));
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

    // Process tickets - may prompt user for spec reconciliation
    for (const ticketId of ticketIds) {
      const ticket = allTickets.find((t: Ticket) => t.id === ticketId)!;
      const currentEpicId = getTicketEpicId(ticketId);

      if (flags.unlink) {
        // Unlink: only if currently linked to this epic
        if (currentEpicId !== epicId) {
          this.log(styles.muted(`  ${ticketId} is not linked to ${epicId}, skipping`));
          continue;
        }

        await this.storage.unlinkTicketFromEpic(ticketId);
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

        // Reconciliation: Check spec consistency between ticket and epic
        const ticketSpecId = ticket.specId;
        const epicSpecId = epic.specId;

        if (ticketSpecId && epicSpecId && ticketSpecId !== epicSpecId) {
          // Both have specs but they differ - determine action
          let action: string;

          // Check if --reconcile flag was provided
          if (flags.reconcile) {
            action = flags.reconcile === 'keep' ? 'keep_ticket' : flags.reconcile === 'epic' ? 'use_epic' : 'skip';
          } else {
            if (!jsonMode) {
              this.log(styles.warning(`  ⚠️  Spec mismatch: ticket has "${ticketSpecId}", epic has "${epicSpecId}"`));
            }

            const specReconcileChoices = [
              { name: `Keep ticket spec (${ticketSpecId})`, value: 'keep_ticket', command: `prlt epic ticket ${epicId} ${ticketId} --reconcile keep --json` },
              { name: `Use epic spec (${epicSpecId})`, value: 'use_epic', command: `prlt epic ticket ${epicId} ${ticketId} --reconcile epic --json` },
              { name: 'Skip this ticket', value: 'skip', command: `prlt epic ticket ${epicId} ${ticketId} --reconcile skip --json` },
            ];

            const jsonModeConfig = jsonMode ? { flags, commandName: 'epic ticket' } : null;
            // eslint-disable-next-line no-await-in-loop
            const result = await this.prompt<{ action: string }>([{
              type: 'list',
              name: 'action',
              message: `Spec mismatch for ${ticketId}: ticket has "${ticketSpecId}", epic has "${epicSpecId}". How to reconcile?`,
              choices: specReconcileChoices,
            }], jsonModeConfig);
            action = result.action;
          }

          if (action === 'skip') {
            this.log(styles.muted(`  Skipping ${ticketId}`));
            continue;
          }

          if (action === 'use_epic') {
            // Update ticket to use epic's spec
            await this.storage.updateTicket(ticketId, { specId: epicSpecId });
            this.log(styles.muted(`  Updated ${ticketId} to use spec "${epicSpecId}"`));
          }
        } else if (!ticketSpecId && epicSpecId) {
          // Ticket has no spec but epic does - determine if should inherit
          let inherit: boolean;

          // Check if --inherit-spec flag was provided
          if (flags['inherit-spec'] !== undefined) {
            inherit = flags['inherit-spec'];
          } else {
            const inheritChoices = [
              { name: 'Yes', value: true, command: `prlt epic ticket ${epicId} ${ticketId} --inherit-spec --json` },
              { name: 'No', value: false, command: `prlt epic ticket ${epicId} ${ticketId} --no-inherit-spec --json` },
            ];

            const jsonModeConfig = jsonMode ? { flags, commandName: 'epic ticket' } : null;
            // eslint-disable-next-line no-await-in-loop
            const result = await this.prompt<{ inherit: boolean }>([{
              type: 'list',
              name: 'inherit',
              message: `${ticketId} has no spec. Inherit epic's spec "${epicSpecId}"?`,
              choices: inheritChoices,
            }], jsonModeConfig);
            inherit = result.inherit;
          }

          if (inherit) {
            await this.storage.updateTicket(ticketId, { specId: epicSpecId });
            this.log(styles.muted(`  Assigned spec "${epicSpecId}" to ${ticketId}`));
          }
        }

        await this.storage.linkTicketToEpic(ticketId, epicId!);
      }

      linkedTickets.push(`${ticketId}: ${ticket.title}`);
      successCount++;
    }

    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

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
  }
}
