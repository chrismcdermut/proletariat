import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { updateEpicTicketsSection } from '../../lib/pmo/epic-files.js';
import { TicketTemplate, PRIORITIES, PRIORITY_LABELS } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class TicketCreate extends PMOCommand {
  static description = 'Create a new ticket on the PMO board';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --title "Fix login bug" --column Backlog',
    '<%= config.bin %> <%= command.id %> -t "Add feature" -c "In Progress" -p HIGH',
    '<%= config.bin %> <%= command.id %> --project mobile-app -t "New feature"',
    '<%= config.bin %> <%= command.id %> --epic EPIC-001 -t "Implement auth flow"',
    '<%= config.bin %> <%= command.id %> --json  # Output column choices as JSON',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    title: Flags.string({
      char: 't',
      description: 'Ticket title',
    }),
    column: Flags.string({
      char: 'c',
      description: 'Column to place the ticket in',
    }),
    priority: Flags.string({
      char: 'p',
      description: 'Ticket priority',
      options: [...PRIORITIES],
    }),
    category: Flags.string({
      description: 'Ticket category (e.g., bug, feature, refactor)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Ticket description',
    }),
    id: Flags.string({
      description: 'Custom ticket ID (auto-generated if not provided)',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode',
      default: false,
    }),
    epic: Flags.string({
      char: 'e',
      description: 'Link ticket to an epic (e.g., EPIC-001)',
    }),
    template: Flags.string({
      char: 'T',
      description: 'Create from a template (e.g., bug-report, feature-request)',
    }),
    labels: Flags.string({
      char: 'l',
      description: 'Labels (comma-separated)',
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(TicketCreate);

    // Get project and board info (pass JSON mode config for AI agents)
    const projectId = await this.requireProject({
      jsonMode: {
        flags,
        commandName: 'ticket create',
        baseCommand: 'prlt ticket create',
      },
    });
    const board = await this.storage.getBoard(projectId);
    const columns = board.columns.map(c => c.name);
    const projectName = await this.getProjectName(projectId);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket create', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // In JSON mode without required data, output column selection prompt
    if (jsonMode && !flags.title && !flags.column) {
      // Build base command with project if specified
      const baseCmd = flags.project
        ? `prlt ticket create -P ${flags.project}`
        : 'prlt ticket create';
      const columnChoices = columns.map(c => ({
        name: c,
        value: c,
        command: `${baseCmd} --column "${c}" --json`,
      }));
      outputPromptAsJson(
        buildPromptConfig('list', 'column', 'Select column to place the ticket in:', columnChoices),
        createMetadata('ticket create', flags)
      );
      return;
    }

    // Validate epic if provided
    if (flags.epic) {
      const epic = await this.storage.getEpic(flags.epic);
      if (!epic) {
        return handleError('EPIC_NOT_FOUND', `Epic not found: ${flags.epic}. Use 'prlt epic list' to see available epics.`);
      }
    }

    // Load template if specified
    let template: TicketTemplate | null = null;
    if (flags.template) {
      template = await this.storage.getTicketTemplate(flags.template);
      if (!template) {
        this.error(`Template not found: ${flags.template}. Run 'prlt ticket template list' to see available templates.`);
      }
    }

    // Parse labels from flag
    const labelsFromFlag = flags.labels
      ? flags.labels.split(',').map(l => l.trim()).filter(l => l)
      : undefined;

    // Get ticket data (interactive or from flags)
    let ticketData: {
      title: string;
      statusName: string;
      priority?: string;
      category?: string;
      description?: string;
      id?: string;
      epicId?: string;
      labels?: string[];
    };

    // In JSON mode with column but no title, output required fields info
    if (jsonMode && flags.column && !flags.title) {
      const baseCmd = flags.project
        ? `prlt ticket create -P ${flags.project} --column "${flags.column}"`
        : `prlt ticket create --column "${flags.column}"`;
      outputPromptAsJson(
        {
          type: 'input',
          name: 'title',
          message: 'Enter ticket title:',
          context: {
            hint: `Provide title with: ${baseCmd} --title "Your title here"`,
            requiredFields: ['--title'],
            optionalFields: ['--priority', '--category', '--description', '--epic', '--labels'],
            example: `${baseCmd} --title "Fix login bug" --priority P1 --category bug`,
          },
        },
        createMetadata('ticket create', flags)
      );
      return;
    }

    if (flags.interactive || !flags.title) {
      ticketData = await this.promptTicketData(flags, this.storage, template, columns);
    } else {
      if (!flags.title && !template?.titlePattern) {
        this.error('Title is required. Use --title or -t flag, or use --interactive mode.');
      }
      ticketData = {
        title: flags.title || template?.titlePattern || '',
        statusName: flags.column || columns[0],
        priority: flags.priority || template?.defaultPriority,
        category: flags.category || template?.defaultCategory,
        description: flags.description || template?.descriptionTemplate,
        id: flags.id,
        epicId: flags.epic,
        labels: labelsFromFlag || template?.defaultLabels,
      };
    }

    // Validate status/column
    if (!columns.includes(ticketData.statusName)) {
      this.error(`Invalid column "${ticketData.statusName}". Available columns: ${columns.join(', ')}`);
    }

    const ticket = await this.storage.createTicket(projectId, {
      id: ticketData.id,
      title: ticketData.title,
      statusName: ticketData.statusName,
      priority: ticketData.priority,
      category: ticketData.category,
      description: ticketData.description,
      epicId: ticketData.epicId,
      labels: ticketData.labels,
    });

    // Add subtasks from template if applicable
    if (template && template.suggestedSubtasks.length > 0) {
      for (const subtask of template.suggestedSubtasks) {
        await this.storage.addSubtask(ticket.id, subtask.title);
      }
    }

    // Auto-export to board.md after write
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // If linked to an epic, update the epic's markdown file with ticket list
    if (ticketData.epicId) {
      const epic = await this.storage.getEpic(ticketData.epicId);
      if (epic) {
        const epicTickets = await this.storage.getTicketsForEpic(projectId, ticketData.epicId);
        const ticketInfos = epicTickets.map(t => ({
          id: t.id,
          title: t.title,
          status: t.statusName || 'Unknown',
          priority: t.priority,
        }));
        updateEpicTicketsSection(this.pmoPath, ticketData.epicId, epic.status, ticketInfos, projectId);
      }
    }

    this.log(styles.success(`\n✅ Created ticket ${styles.emphasis(ticket.id)} in project ${styles.emphasis(projectName)}`));
    if (template) {
      this.log(styles.muted(`   Template: ${template.name}`));
    }
    this.log(styles.muted(`   Title: ${ticket.title}`));
    this.log(styles.muted(`   Status: ${ticket.statusName}`));
    if (ticket.priority) {
      this.log(styles.muted(`   Priority: ${ticket.priority}`));
    }
    if (ticket.category) {
      this.log(styles.muted(`   Category: ${ticket.category}`));
    }
    if (ticketData.epicId) {
      this.log(styles.muted(`   Epic: ${ticketData.epicId}`));
    }
    if (ticketData.labels && ticketData.labels.length > 0) {
      this.log(styles.muted(`   Labels: ${ticketData.labels.join(', ')}`));
    }
    if (template && template.suggestedSubtasks.length > 0) {
      this.log(styles.muted(`   Subtasks: ${template.suggestedSubtasks.length} created`));
    }
    this.log(styles.muted(`\n   View board: prlt board`));
    this.log(styles.muted(`   List tickets: prlt ticket list`));
  }

  private async promptTicketData(
    flags: {
      title?: string;
      column?: string;
      priority?: string;
      category?: string;
      description?: string;
      id?: string;
      epic?: string;
      template?: string;
      labels?: string;
    },
    storage: { listTicketTemplates: () => Promise<TicketTemplate[]> },
    existingTemplate: TicketTemplate | null,
    columns: string[]
  ): Promise<{
    title: string;
    statusName: string;
    priority?: string;
    category?: string;
    description?: string;
    id?: string;
    epicId?: string;
    labels?: string[];
  }> {
    // If no template was specified via flag, offer to select one
    let template = existingTemplate;
    if (!template && !flags.template) {
      const templates = await storage.listTicketTemplates();
      if (templates.length > 0) {
        const { selectedTemplate } = await inquirer.prompt<{ selectedTemplate: string }>([
          {
            type: 'list',
            name: 'selectedTemplate',
            message: 'Start from a template?',
            choices: [
              { name: 'No template (blank ticket)', value: '' },
              new inquirer.Separator('── Templates ──'),
              ...templates.map(t => ({
                name: `${t.name}${t.isBuiltin ? '' : ' [custom]'} - ${t.description || ''}`,
                value: t.id,
              })),
            ],
          },
        ]);

        if (selectedTemplate) {
          template = templates.find(t => t.id === selectedTemplate) || null;
        }
      }
    }

    const answers = await inquirer.prompt<{
      title: string;
      column: string;
      priority?: string;
      categoryChoice: string;
      customCategory?: string;
    }>([
      {
        type: 'input',
        name: 'title',
        message: 'Ticket title:',
        default: flags.title || template?.titlePattern,
        validate: (input: string) => input.length > 0 || 'Title is required',
      },
      {
        type: 'list',
        name: 'column',
        message: 'Column:',
        choices: columns,
        default: flags.column || columns[0],
      },
      {
        type: 'list',
        name: 'priority',
        message: 'Priority:',
        choices: [
          { name: 'None', value: undefined },
          ...PRIORITIES.map(p => ({ name: PRIORITY_LABELS[p], value: p })),
        ],
        default: flags.priority || template?.defaultPriority,
      },
      {
        type: 'list',
        name: 'categoryChoice',
        message: 'Category:',
        choices: [
          { name: 'Skip (none)', value: '' },
          new inquirer.Separator('── Conventional Commits ──'),
          { name: 'feature     - New feature or capability', value: 'feature' },
          { name: 'bug         - Bug fix', value: 'bug' },
          { name: 'refactor    - Code refactoring', value: 'refactor' },
          { name: 'docs        - Documentation', value: 'docs' },
          { name: 'test        - Test additions/fixes', value: 'test' },
          { name: 'chore       - Maintenance tasks', value: 'chore' },
          { name: 'performance - Performance improvements', value: 'performance' },
          { name: 'ci          - CI/CD changes', value: 'ci' },
          { name: 'build       - Build system changes', value: 'build' },
          new inquirer.Separator('── Extended Types ──'),
          { name: 'security    - Security fixes', value: 'security' },
          { name: 'database    - Database migrations', value: 'database' },
          { name: 'release     - Release preparation', value: 'release' },
          new inquirer.Separator('── 5Tool Founder ──'),
          { name: 'ship        - Shipping and deployment', value: 'ship' },
          { name: 'growth      - Growth and marketing', value: 'growth' },
          { name: 'support     - Customer experience', value: 'support' },
          { name: 'strategy    - Strategy and planning', value: 'strategy' },
          { name: 'ops         - Business operations', value: 'ops' },
          new inquirer.Separator('───────────────────'),
          { name: 'Custom...', value: '__custom__' },
        ],
        default: flags.category || template?.defaultCategory || '',
      },
      {
        type: 'input',
        name: 'customCategory',
        message: 'Enter custom category:',
        when: (answers: { categoryChoice: string }) => answers.categoryChoice === '__custom__',
        validate: (input: string) => input.length > 0 || 'Category is required when choosing custom',
      },
    ]);

    // Resolve category from choice or custom input
    const category = answers.categoryChoice === '__custom__'
      ? answers.customCategory
      : answers.categoryChoice || undefined;

    // Prompt for structured description (use template description if available)
    const description = await this.promptStructuredDescription(
      flags.description || template?.descriptionTemplate
    );

    // Parse labels from flag or use template defaults
    const labels = flags.labels
      ? flags.labels.split(',').map(l => l.trim()).filter(l => l)
      : template?.defaultLabels;

    return {
      title: answers.title,
      statusName: answers.column,
      priority: answers.priority || undefined,
      category,
      description: description || undefined,
      id: flags.id,
      epicId: flags.epic,
      labels,
    };
  }

  private async promptStructuredDescription(existingDescription?: string): Promise<string> {
    // If description already provided via flag, use it
    if (existingDescription) {
      return existingDescription;
    }

    this.log(styles.muted('\n─── Ticket Description (for agent execution) ───'));

    const descAnswers = await inquirer.prompt<{
      what: string;
      doneWhen: string;
      context: string;
      notInScope: string;
    }>([
      {
        type: 'input',
        name: 'what',
        message: 'What is the concrete outcome? (one sentence):',
        validate: (input: string) => input.length > 0 || 'Outcome is required - what does success look like?',
      },
      {
        type: 'editor',
        name: 'doneWhen',
        message: 'Done when (acceptance criteria, opens editor):',
        default: '- [ ] \n- [ ] ',
        waitForUseInput: false,
      },
      {
        type: 'input',
        name: 'context',
        message: 'Context (files, patterns, hints - optional):',
        default: '',
      },
      {
        type: 'input',
        name: 'notInScope',
        message: 'Not in scope (explicit exclusions - optional):',
        default: '',
      },
    ]);

    // Build structured description
    const parts: string[] = [];

    parts.push(`## What\n${descAnswers.what}`);

    if (descAnswers.doneWhen.trim()) {
      // Ensure each line in doneWhen starts with - [ ] if it doesn't already
      const criteria = descAnswers.doneWhen
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
          if (line.startsWith('- [ ]') || line.startsWith('- [x]')) {
            return line;
          }
          if (line.startsWith('-')) {
            return `- [ ]${line.slice(1)}`;
          }
          return `- [ ] ${line}`;
        })
        .join('\n');
      parts.push(`## Done when\n${criteria}`);
    }

    if (descAnswers.context.trim()) {
      parts.push(`## Context\n${descAnswers.context}`);
    }

    if (descAnswers.notInScope.trim()) {
      parts.push(`## Not in scope\n${descAnswers.notInScope}`);
    }

    return parts.join('\n\n');
  }

}
