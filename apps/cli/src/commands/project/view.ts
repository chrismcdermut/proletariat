import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags, Subtask } from '../../lib/pmo/index.js';
import { styles, getColumnStyle, getColumnEmoji, formatPriority, formatCategory } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ProjectView);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('project view', flags));
        this.exit(1);
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

      // In JSON mode, output project selection prompt
      if (jsonMode) {
        const projectChoices = projects.map(p => ({ name: `${p.id} - ${p.name}`, value: p.id }));
        outputPromptAsJson(
          buildPromptConfig('list', 'id', 'Select project to view:', projectChoices),
          createMetadata('project view', flags)
        );
        return;
      }

      const { selectedProjectId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedProjectId',
        message: 'Select project to view:',
        choices: projects.map(p => ({
          name: `${p.id} - ${p.name}`,
          value: p.id,
        })),
      }]);
      projectId = selectedProjectId;
    }

    const project = await this.storage.getProjectBoard(projectId!);
    if (!project) {
      return handleError('PROJECT_NOT_FOUND', `Project "${projectId}" not found.`);
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
