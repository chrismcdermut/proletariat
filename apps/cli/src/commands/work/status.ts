import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles, formatPriority } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { ExecutionStorage } from '../../lib/execution/storage.js';

export default class WorkStatus extends PMOCommand {
  static description = 'Show current work status (in-progress tickets and execution counts)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(WorkStatus);
    const projectId = (flags as { project?: string }).project;

    const jsonMode = shouldOutputJson(flags);

    // List all tickets, optionally filtered by project
    const tickets = await this.storage.listTickets(projectId, { allProjects: !projectId });
    const inProgress = tickets.filter(t => t.statusCategory === 'started' && t.assignee);

    // PRLT-1337: Query agent_work for execution status counts
    const executionCounts = this.getExecutionCounts();

    if (jsonMode) {
      outputSuccessAsJson(
        {
          inProgressCount: inProgress.length,
          executions: executionCounts,
          tickets: inProgress.map(t => ({
            id: t.id,
            title: t.title,
            assignee: t.assignee,
            statusName: t.statusName,
            priority: t.priority,
            projectId: t.projectId,
            branch: t.branch,
          })),
        },
        createMetadata('work status', flags),
      );
      return;
    }

    // Interactive mode — show execution summary first
    if (executionCounts) {
      this.log('');
      this.log(styles.title('Execution Summary'));
      this.log(styles.muted('─'.repeat(60)));
      const parts = [
        executionCounts.running > 0 ? `${executionCounts.running} running` : null,
        executionCounts.completed > 0 ? `${executionCounts.completed} completed` : null,
        executionCounts.failed > 0 ? `${executionCounts.failed} failed` : null,
        executionCounts.stopped > 0 ? `${executionCounts.stopped} stopped` : null,
      ].filter(Boolean);
      if (parts.length > 0) {
        this.log(`  ${parts.join(' | ')}`);
      } else {
        this.log(styles.muted('  No executions recorded'));
      }
    }

    if (inProgress.length === 0) {
      this.log('');
      this.log(styles.info('No in-progress work found.'));
      this.log('');
      return;
    }

    this.log('');
    this.log(styles.title(`Work In Progress (${inProgress.length})`));
    this.log(styles.muted('─'.repeat(60)));

    for (const ticket of inProgress) {
      const priority = formatPriority(ticket.priority);
      this.log(`  ${styles.code(ticket.id)} ${ticket.title} ${priority}`);
      const details = [
        ticket.assignee ? `Assignee: ${ticket.assignee}` : null,
        ticket.statusName ? `Status: ${ticket.statusName}` : null,
        ticket.projectId ? `Project: ${ticket.projectId}` : null,
        ticket.branch ? `Branch: ${ticket.branch}` : null,
      ].filter(Boolean).join(' | ');
      if (details) {
        this.log(styles.muted(`     ${details}`));
      }
    }

    this.log('');
  }

  /**
   * PRLT-1337: Get execution status counts from agent_work table.
   * Returns null if DB is not available.
   */
  private getExecutionCounts(): { running: number; completed: number; failed: number; stopped: number } | null {
    if (!this.db) return null;

    try {
      const executionStorage = new ExecutionStorage(this.db);
      const running = executionStorage.listExecutions({ status: 'running' }).length
        + executionStorage.listExecutions({ status: 'starting' }).length;
      const completed = executionStorage.listExecutions({ status: 'completed' }).length;
      const failed = executionStorage.listExecutions({ status: 'failed' }).length;
      const stopped = executionStorage.listExecutions({ status: 'stopped' }).length;

      return { running, completed, failed, stopped };
    } catch {
      return null;
    }
  }
}
