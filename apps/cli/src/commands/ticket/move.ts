import { Args, Flags } from '@oclif/core';
import {
  autoExportToBoard,
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js';
import { Ticket, PMOError } from '../../lib/pmo/types.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class TicketMove extends PMOCommand {
  static description = 'Move ticket(s) to a different column';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-ticket "In Progress"',
    '<%= config.bin %> <%= command.id %> implement-auth Done',
    '<%= config.bin %> <%= command.id %> fix-bug "In Review" --position 0',
    '<%= config.bin %> <%= command.id %> TKT-123 --to-project PROJ-002',
    '<%= config.bin %> <%= command.id %> --bulk',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID - prompts with dropdown if not provided',
      required: false,
    }),
    column: Args.string({
      description: 'Target column - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    position: Flags.integer({
      description: 'Position within the column (0 = top)',
    }),
    'to-project': Flags.string({
      description: 'Move ticket to a different project (uses Backlog/default column)',
    }),
    bulk: Flags.boolean({
      char: 'b',
      description: 'Enable bulk mode to move multiple tickets',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt (bulk mode only)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketMove);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket move', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Cross-project move: if ticketId and --to-project are provided, skip project context
    // The source project is determined from the ticket itself
    if (args.ticketId && flags['to-project']) {
      const ticket = await this.storage.getTicket(args.ticketId);
      if (!ticket) {
        return handleError('TICKET_NOT_FOUND', `Ticket "${args.ticketId}" not found.`);
      }
      await this.executeCrossProjectMove(ticket, flags['to-project'], args.column, jsonMode, flags);
      return;
    }

    // This command requires project context - get projectId (with JSON mode support)
    const projectId = await this.requireProject({
      jsonMode: {
        flags,
        commandName: 'ticket move',
        baseCommand: 'prlt ticket move',
      },
    });

    // Get all tickets
    const allTickets = await this.storage.listTickets(projectId);

    if (allTickets.length === 0) {
      return handleError('NO_TICKETS', 'No tickets found. Create a ticket first with "prlt ticket create".');
    }

    // Bulk mode
    if (flags.bulk) {
      await this.executeBulk(allTickets, flags, projectId);
      return;
    }

    // Single ticket mode
    let ticketId = args.ticketId;

    if (!ticketId) {
      // Use helper for ticket selection (handles JSON mode automatically)
      const selected = await this.selectFromList({
        message: 'Select ticket to move:',
        items: allTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket move ${t.id} -P ${projectId} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket move' } : null,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      ticketId = selected;
    }

    // Get ticket
    const ticket = await this.storage.getTicket(ticketId!);
    if (!ticket) {
      this.error(`Ticket "${ticketId}" not found.`);
    }

    // Cross-project move (when --to-project flag is provided)
    if (flags['to-project']) {
      await this.executeCrossProjectMove(ticket, flags['to-project'], args.column, jsonMode, flags);
      return;
    }

    // Get target column - prompt if not provided
    let targetColumn = args.column;

    if (!targetColumn) {
      // Check if there are other projects to move to
      const allProjects = await this.storage.listProjects();
      const otherProjects = allProjects.filter(p => p.id !== projectId);

      // If there are other projects, ask user what type of move they want
      if (otherProjects.length > 0) {
        const moveTypeChoices = [
          { id: 'column', name: 'Different column (same project)' },
          { id: 'project', name: 'Different project' },
        ];

        const moveType = await this.selectFromList({
          message: 'Move to:',
          items: moveTypeChoices,
          getName: (choice) => choice.name,
          getValue: (choice) => choice.id,
          getCommand: (choice) => choice.id === 'column'
            ? `prlt ticket move ${ticketId} -P ${projectId} --json`
            : `prlt ticket project ${ticketId} -P ${projectId} --json`,
          jsonMode: jsonMode ? { flags, commandName: 'ticket move' } : null,
        });

        if (!moveType) {
          return; // Cancelled or JSON mode
        }

        // If user chose different project, handle cross-project move
        if (moveType === 'project') {
          const targetProjectId = await this.selectFromList({
            message: 'Select target project:',
            items: otherProjects,
            getName: (p) => `${p.name} (${p.id})`,
            getValue: (p) => p.id,
            getCommand: (p) => `prlt ticket move ${ticketId} --to-project ${p.id} --json`,
            jsonMode: jsonMode ? { flags, commandName: 'ticket move' } : null,
          });

          if (!targetProjectId) {
            return; // Cancelled or JSON mode
          }

          // Get columns from target project and ask which column to move to
          const targetProjectBoard = await this.storage.getProjectBoard(targetProjectId);
          if (!targetProjectBoard) {
            this.error('Target project not found.');
          }

          const targetColumnName = await this.selectFromList({
            message: 'Move to column:',
            items: targetProjectBoard.columns as { name: string }[],
            getName: (col) => col.name,
            getValue: (col) => col.name,
            getCommand: (col) => `prlt ticket move ${ticketId} "${col.name}" --to-project ${targetProjectId} --json`,
            jsonMode: jsonMode ? { flags, commandName: 'ticket move' } : null,
          });

          if (!targetColumnName) {
            return; // Cancelled or JSON mode
          }

          await this.executeCrossProjectMove(ticket, targetProjectId, targetColumnName, jsonMode, flags);
          return;
        }
      }

      // Get columns from the database (not config.json) to ensure accuracy
      const project = await this.storage.getProjectBoard(projectId);
      if (!project) {
        this.error('Project not found.');
      }

      // Use helper for column selection (handles JSON mode automatically)
      const selected = await this.selectFromList({
        message: 'Move to column:',
        items: project.columns as { name: string }[],
        getName: (col) => col.name === ticket.statusName ? `${col.name} (current)` : col.name,
        getValue: (col) => col.name,
        getCommand: (col) => `prlt ticket move ${ticketId} "${col.name}" -P ${projectId} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket move' } : null,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      targetColumn = selected;
    }

    // Column validation happens in storage.moveTicket()

    // Check if actually moving
    if (targetColumn === ticket.statusName && flags.position === undefined) {
      this.log(styles.warning(`Ticket "${ticketId}" is already in "${targetColumn}".`));
      return;
    }

    // Move ticket (targetColumn is guaranteed to be string after validation above)
    const moved = await this.storage.moveTicket(projectId, ticketId!, targetColumn!, flags.position);

    // Auto-export to board.md after write
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\n✅ Moved ticket ${styles.emphasis(moved.id)}`));
    if (targetColumn !== ticket.statusName) {
      this.log(styles.muted(`   From: ${ticket.statusName}`));
      this.log(styles.muted(`   To: ${moved.statusName}`));
    }
    if (flags.position !== undefined) {
      this.log(styles.muted(`   Position: ${flags.position}`));
    }
  }

  private async executeBulk(
    allTickets: Awaited<ReturnType<typeof this.storage.listTickets>>,
    flags: { force: boolean; json: boolean; machine: boolean; bulk: boolean; position?: number; project?: string },
    projectId: string
  ): Promise<void> {
    // Only show header in interactive mode
    if (!shouldOutputJson(flags)) {
      this.log(styles.emphasis('📦 Move Multiple Tickets\n'));
    }

    // Get columns
    const board = await this.storage.getProjectBoard(projectId);
    if (!board) {
      this.error(`Project "${projectId}" not found. The ticket may belong to an orphaned project.`);
    }
    const columns = board.columns.map(col => col.name);

    // Agent mode config for prompts
    const jsonModeConfig = shouldOutputJson(flags) ? { flags, commandName: 'ticket move --bulk' } : null;

    // Select tickets to move (now agent-compatible!)
    const { selectedTickets } = await this.prompt<{ selectedTickets: string[] }>([{
      type: 'checkbox',
      name: 'selectedTickets',
      message: 'Select tickets to move:',
      choices: allTickets.map(t => ({
        name: `${t.id} - ${t.title} (${t.statusName})`,
        value: t.id,
        command: `prlt ticket move ${t.id} -P ${projectId} --json`,  // For agent: select single ticket
      })),
    }], jsonModeConfig);

    if (selectedTickets.length === 0) {
      this.log(styles.muted('No tickets selected.'));
      return;
    }

    // Select target column (now agent-compatible!)
    const { targetColumn } = await this.prompt<{ targetColumn: string }>([{
      type: 'list',
      name: 'targetColumn',
      message: 'Move selected tickets to:',
      choices: columns.map(c => ({
        name: c,
        value: c,
        command: `prlt ticket move ${selectedTickets.join(' ')} "${c}" -P ${projectId} --json`,
      })),
    }], jsonModeConfig);

    // Confirmation
    if (!flags.force) {
      this.log(styles.warning('\nThis will move:'));
      for (const ticketId of selectedTickets) {
        const ticket = allTickets.find(t => t.id === ticketId);
        this.log(styles.primary(`  • ${ticketId}: ${ticket?.title}`));
      }
      this.log(styles.primary(`  → to column: ${targetColumn}\n`));

      const { confirm } = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: 'Continue?',
        choices: [
          { name: 'No, cancel', value: 'false', command: '' },
          { name: 'Yes, move tickets', value: 'true', command: `prlt ticket move ${selectedTickets.join(' ')} "${targetColumn}" -P ${projectId} --force --json` }
        ],
      }], jsonModeConfig);

      if (!confirm) {
        this.log(styles.muted('Move cancelled.'));
        return;
      }
    }

    this.log('');

    // Move each ticket
    let successCount = 0;
    let failCount = 0;

    // Process sequentially for clear success/failure logging
    for (const ticketId of selectedTickets) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.storage.moveTicket(projectId, ticketId, targetColumn);
        this.log(styles.success(`Moved ${ticketId} to ${targetColumn}`));
        successCount++;
      } catch (error) {
        this.log(styles.error(`Failed to move ${ticketId}: ${error instanceof Error ? error.message : String(error)}`));
        failCount++;
      }
    }

    // Auto-export to kanban.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // Summary
    this.log('');
    if (successCount > 0) {
      this.log(styles.success(`Moved ${successCount} ticket(s)`));
    }
    if (failCount > 0) {
      this.log(styles.error(`Failed to move ${failCount} ticket(s)`));
    }
  }

  /**
   * Move a ticket to a different project.
   * If a target column is specified and exists in the target project, move to that column.
   * Otherwise, use the default/backlog column.
   */
  private async executeCrossProjectMove(
    ticket: Ticket,
    targetProjectId: string,
    targetColumn: string | undefined,
    jsonMode: boolean,
    flags: Record<string, unknown>
  ): Promise<void> {
    const ticketId = ticket.id;
    const sourceProjectId = ticket.projectId;

    // Check if target project exists
    const projects = await this.storage.listProjects();
    const targetProject = projects.find(p =>
      p.id === targetProjectId ||
      p.id.toLowerCase() === targetProjectId.toLowerCase() ||
      p.name.toLowerCase() === targetProjectId.toLowerCase()
    );

    if (!targetProject) {
      if (jsonMode) {
        outputErrorAsJson('PROJECT_NOT_FOUND', `Project not found: ${targetProjectId}`, createMetadata('ticket move', flags));
        this.exit(1);
      }
      this.error(`Project not found: ${targetProjectId}`);
    }

    // Check if moving to the same project
    if (targetProject.id === sourceProjectId) {
      this.log(styles.warning(`Ticket "${ticketId}" is already in project "${targetProject.id}".`));
      this.log(styles.muted(`To move to a different column, use: prlt ticket move ${ticketId} <column>`));
      return;
    }

    // Move ticket to the new project
    const movedTicket = await this.storage.moveTicketToProject(ticketId, targetProject.id);

    // If a target column was specified, try to move to that column in the new project
    if (targetColumn) {
      try {
        await this.storage.moveTicket(targetProject.id, ticketId, targetColumn);
        // Refresh ticket to get updated status
        const updatedTicket = await this.storage.getTicket(ticketId);

        await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

        this.log(styles.success(`\n✅ Moved ticket ${styles.emphasis(ticketId)} to project ${styles.emphasis(targetProject.id)}`));
        this.log(styles.muted(`   From project: ${sourceProjectId}`));
        this.log(styles.muted(`   To project: ${targetProject.id}`));
        this.log(styles.muted(`   Column: ${updatedTicket?.statusName || targetColumn}`));
        return;
      } catch (error) {
        // Only catch "status not found" errors - re-throw unexpected errors
        if (error instanceof PMOError && error.code === 'NOT_FOUND') {
          this.log(styles.muted(`Note: Column "${targetColumn}" not found in target project, using default column.`));
        } else {
          throw error;
        }
      }
    }

    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\n✅ Moved ticket ${styles.emphasis(ticketId)} to project ${styles.emphasis(targetProject.id)}`));
    this.log(styles.muted(`   From project: ${sourceProjectId}`));
    this.log(styles.muted(`   To project: ${targetProject.id}`));
    this.log(styles.muted(`   Column: ${movedTicket.statusName || 'default'}`));
  }
}
