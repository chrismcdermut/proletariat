import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags, Subtask } from '../../lib/pmo/index.js';
import { styles, getColumnStyle, getColumnEmoji, formatPriority, formatCategory } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class ProjectView extends PMOCommand {
  static description = 'View a project\'s board';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project',
    '<%= config.bin %> <%= command.id %>  # Views default project',
  ];

  static args = {
    id: Args.string({
      description: 'Project ID to view - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ProjectView);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('project view', flags));
        return
      }
      this.error(message);
    };

    // Get project ID - prompt if not provided
    let projectId = args.id;

    if (!projectId) {
      const projects = await this.storage.listProjects();

      if (projects.length === 0) {
        return handleError('NO_PROJECTS', 'No projects found. Create a project first with "prlt project create".');
      }

      // Use selectFromList helper (handles JSON mode automatically)
      const selected = await this.selectFromList({
        message: 'Select project to view:',
        items: projects,
        getName: (p) => `${p.id} - ${p.name}`,
        getValue: (p) => p.id,
        getCommand: (p) => `prlt project view ${p.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'project view' } : null,
      });

      if (!selected) {
        return; // Cancelled or JSON mode (already exited)
      }
      projectId = selected;
    }

    const project = await this.storage.getProjectBoard(projectId!);
    if (!project) {
      return handleError('PROJECT_NOT_FOUND', `Project "${projectId}" not found.`);
    }

    // In JSON mode, output project board as structured data
    if (jsonMode) {
      outputSuccessAsJson(
        {
          id: project.id,
          name: project.name,
          columns: project.columns.map(col => ({
            name: col.name,
            ticketCount: col.tickets.length,
            tickets: col.tickets.map(t => ({
              id: t.id,
              title: t.title,
              priority: t.priority,
              category: t.category,
              subtasksDone: t.subtasks.filter((s: Subtask) => s.done).length,
              subtasksTotal: t.subtasks.length,
            })),
          })),
        },
        createMetadata('project view', flags)
      );
      return;
    }

    this.log(styles.title(`\n${project.name}`));
    this.log(styles.muted(`Project: ${project.id}\n`));

    for (const column of project.columns) {
      const emoji = getColumnEmoji(column.name);
      const columnStyle = getColumnStyle(column.name);

      this.log(columnStyle(`${emoji} ${column.name} (${column.tickets.length})`));

      if (column.tickets.length === 0) {
        this.log(styles.muted('    (empty)'));
      } else {
        for (const ticket of column.tickets) {
          const priority = formatPriority(ticket.priority);
          const category = formatCategory(ticket.category);
          const badges = [priority, category].filter(Boolean).join(' ');

          this.log(`    ${styles.code(ticket.id)} ${ticket.title}${badges ? ' ' + badges : ''}`);

          // Show subtasks if any
          if (ticket.subtasks.length > 0) {
            const done = ticket.subtasks.filter((s: Subtask) => s.done).length;
            const total = ticket.subtasks.length;
            this.log(styles.muted(`      [${done}/${total}] subtasks`));
          }
        }
      }
      this.log('');
    }
  }
}
