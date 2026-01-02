import { Command, Args, Flags } from '@oclif/core';
import * as path from 'path';
import { styles } from '../../lib/styles.js';
import { findPMO } from '../../lib/pmo/find-pmo.js';
import { getWorkspaceDbPath } from '../../lib/pmo/sync-manager.js';
import { findWorkspaceFromPMO } from '../../lib/pmo/hooks-integration.js';
import {
  initializeHooks,
  HooksManager,
  HookEventName,
  HookEventPayload,
  TicketCreatedPayload,
  TicketMovedPayload,
  TicketStatusChangedPayload,
  HookExecutionResult,
} from '../../lib/hooks/index.js';
import { Ticket, TicketStatus } from '../../lib/pmo/types.js';
import Database from 'better-sqlite3';

export default class HooksTest extends Command {
  static description = 'Test hooks by simulating an event';

  static examples = [
    '<%= config.bin %> <%= command.id %> ticket.created',
    '<%= config.bin %> <%= command.id %> ticket.moved --from-column Backlog --to-column Ready',
    '<%= config.bin %> <%= command.id %> ticket.status_changed --to-status in_progress',
    '<%= config.bin %> <%= command.id %> ticket.moved --dry-run',
  ];

  static args = {
    event: Args.string({
      description: 'Event to simulate',
      required: true,
      options: [
        'ticket.created',
        'ticket.moved',
        'ticket.updated',
        'ticket.status_changed',
        'ticket.deleted',
        'ticket.completed',
        'epic.created',
        'epic.updated',
        'epic.status_changed',
        'epic.deleted',
        'work.started',
        'work.completed',
      ],
    }),
  };

  static flags = {
    'ticket-id': Flags.string({
      description: 'Ticket ID for the simulated event',
      default: 'TEST-001',
    }),
    'ticket-title': Flags.string({
      description: 'Ticket title for the simulated event',
      default: 'Test Ticket',
    }),
    'from-column': Flags.string({
      description: 'Source column (for ticket.moved)',
      default: 'Backlog',
    }),
    'to-column': Flags.string({
      description: 'Target column (for ticket.moved)',
      default: 'Ready',
    }),
    'from-status': Flags.string({
      description: 'Previous status (for ticket.status_changed)',
      options: ['backlog', 'ready', 'in_progress', 'blocked', 'review', 'done', 'cancelled'],
    }),
    'to-status': Flags.string({
      description: 'New status (for ticket.status_changed)',
      options: ['backlog', 'ready', 'in_progress', 'blocked', 'review', 'done', 'cancelled'],
      default: 'in_progress',
    }),
    project: Flags.string({
      description: 'Project ID for the event',
      default: 'default',
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would happen without executing actions',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed output',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(HooksTest);
    const event = args.event as HookEventName;

    // Find PMO and workspace
    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    const workspacePath = findWorkspaceFromPMO(pmoPath);
    const dbPath = getWorkspaceDbPath(pmoPath);

    // Load hooks
    let db: Database.Database | undefined;
    try {
      db = new Database(dbPath);
    } catch {
      // Database not available
    }

    const manager = initializeHooks({
      workspacePath,
      pmoPath,
      db,
      log: (msg) => this.log(styles.muted(`  ${msg}`)),
    });

    db?.close();

    // Build mock payload
    const payload = this.buildMockPayload(event, flags);

    this.log(styles.header(`\nSimulating event: ${event}`));
    this.log('');

    if (flags.verbose) {
      this.log(styles.muted('Payload:'));
      this.log(styles.muted(JSON.stringify(payload, null, 2)));
      this.log('');
    }

    // Get hooks that would match
    const hooks = manager.getHooksForEvent(event);
    const enabledHooks = hooks.filter(h => h.enabled);

    this.log(`Found ${enabledHooks.length} enabled hooks for this event:`);
    for (const hook of enabledHooks) {
      const matches = manager.evaluateConditions(hook.conditions || [], payload);
      const matchStatus = matches ? styles.success('✓ matches') : styles.warning('✗ conditions not met');
      this.log(`  - ${hook.name}: ${matchStatus}`);
    }
    this.log('');

    if (flags['dry-run']) {
      this.log(styles.warning('Dry run - no actions executed'));
      return;
    }

    // Execute hooks
    this.log(styles.header('Executing hooks...'));
    this.log('');

    const results = await manager.emit(event, payload);

    // Show results
    this.printResults(results, flags.verbose);
  }

  private buildMockPayload(event: HookEventName, flags: Record<string, unknown>): HookEventPayload {
    const now = new Date();
    const projectId = flags.project as string;

    // Build mock ticket
    const mockTicket: Ticket = {
      id: flags['ticket-id'] as string,
      title: flags['ticket-title'] as string,
      description: 'Test ticket description',
      status: (flags['to-status'] as TicketStatus) || 'backlog',
      column: flags['to-column'] as string,
      priority: 'MEDIUM',
      category: 'test',
      subtasks: [],
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };

    // Build payload based on event type
    switch (event) {
      case 'ticket.created':
        return {
          timestamp: now,
          projectId,
          ticket: mockTicket,
        } as TicketCreatedPayload;

      case 'ticket.moved':
        return {
          timestamp: now,
          projectId,
          ticket: mockTicket,
          fromColumn: flags['from-column'] as string,
          toColumn: flags['to-column'] as string,
        } as TicketMovedPayload;

      case 'ticket.status_changed':
        return {
          timestamp: now,
          projectId,
          ticket: mockTicket,
          fromStatus: flags['from-status'] as TicketStatus | undefined,
          toStatus: flags['to-status'] as TicketStatus,
        } as TicketStatusChangedPayload;

      case 'ticket.updated':
        return {
          timestamp: now,
          projectId,
          ticket: mockTicket,
          changes: { status: flags['to-status'] as TicketStatus },
          previousValues: { status: flags['from-status'] as TicketStatus | undefined },
        };

      case 'ticket.deleted':
        return {
          timestamp: now,
          projectId,
          ticketId: mockTicket.id,
          ticket: mockTicket,
        };

      case 'ticket.completed':
        return {
          timestamp: now,
          projectId,
          ticket: { ...mockTicket, status: 'done' as TicketStatus },
        };

      case 'work.started':
        return {
          timestamp: now,
          projectId,
          ticketId: mockTicket.id,
          agentName: 'test-agent',
          executionId: 'test-execution-001',
        };

      case 'work.completed':
        return {
          timestamp: now,
          projectId,
          ticketId: mockTicket.id,
          agentName: 'test-agent',
          executionId: 'test-execution-001',
          success: true,
        };

      default:
        // Generic payload for epic events
        return {
          timestamp: now,
          projectId,
          epic: {
            id: 'TEST-EPIC-001',
            projectId,
            title: 'Test Epic',
            status: 'active' as const,
            position: 0,
            createdAt: now,
            updatedAt: now,
          },
        } as HookEventPayload;
    }
  }

  private printResults(results: HookExecutionResult[], verbose: boolean): void {
    if (results.length === 0) {
      this.log(styles.muted('No hooks executed.'));
      return;
    }

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const result of results) {
      if (result.skipped) {
        skippedCount++;
        if (verbose) {
          this.log(`${styles.muted('○')} ${result.hook.name} (skipped)`);
        }
        continue;
      }

      const icon = result.success ? styles.success('✓') : styles.error('✗');
      const duration = `${result.duration}ms`;

      this.log(`${icon} ${result.hook.name} (${duration})`);

      if (result.success) {
        successCount++;
      } else {
        failedCount++;
      }

      // Show action results
      for (const actionResult of result.actionResults) {
        const actionIcon = actionResult.success
          ? styles.success('  ✓')
          : styles.error('  ✗');
        this.log(`${actionIcon} ${actionResult.action.type}`);

        if (!actionResult.success && actionResult.error) {
          this.log(styles.error(`    Error: ${actionResult.error}`));
        }

        if (verbose && actionResult.output) {
          this.log(styles.muted(`    Output: ${JSON.stringify(actionResult.output)}`));
        }
      }
    }

    this.log('');
    this.log(styles.header('Summary:'));
    this.log(`  Executed: ${successCount + failedCount}`);
    this.log(`  ${styles.success('Success')}: ${successCount}`);
    this.log(`  ${styles.error('Failed')}: ${failedCount}`);
    this.log(`  ${styles.muted('Skipped')}: ${skippedCount}`);
  }
}
