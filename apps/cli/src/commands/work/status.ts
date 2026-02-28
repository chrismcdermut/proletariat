import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles, formatPriority } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class WorkStatus extends PMOCommand {
  static description = 'Show current work status (in-progress tickets)';

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

    if (jsonMode) {
      outputSuccessAsJson(
        {
          inProgressCount: inProgress.length,
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

    // Interactive mode
    if (inProgress.length === 0) {
      this.log(styles.info('No in-progress work found.'));
      return;
    }

    this.log(styles.title(`\nWork In Progress (${inProgress.length})`));
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
}
