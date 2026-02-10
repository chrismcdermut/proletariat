import { Flags } from '@oclif/core';
import * as fs from 'node:fs';
import inquirer from 'inquirer';
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
// Note: inquirer import kept for inquirer.Separator usage in interactive mode
import { styles } from '../../lib/styles.js';
import { updateEpicTicketsSection } from '../../lib/pmo/epic-files.js';
import { TicketTemplate, PRIORITIES, PRIORITY_LABELS } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputDryRunSuccessAsJson,
  outputDryRunErrorsAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';
import { multiLineInput } from '../../lib/multiline-input.js';

export default class TicketCreate extends PMOCommand {
  static description = 'Create a new ticket on the PMO board';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --title "Fix login bug" --column Backlog',
    '<%= config.bin %> <%= command.id %> -t "Add feature" -c "In Progress" -p P1',
    '<%= config.bin %> <%= command.id %> --project mobile-app -t "New feature"',
    '<%= config.bin %> <%= command.id %> --epic EPIC-001 -t "Implement auth flow"',
    '<%= config.bin %> <%= command.id %> --title "My ticket" --description-file ./ticket-desc.md',
    '<%= config.bin %> <%= command.id %> --title "My ticket" --description-file -  # Read from stdin',
    '<%= config.bin %> <%= command.id %> --json  # Output column choices as JSON',
    '<%= config.bin %> <%= command.id %> --title "Test" -P PROJ-001 --dry-run --json  # Validate without creating',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    title: Flags.string({
      char: 't',
      description: 'Ticket title [required for non-interactive]',
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
    'description-file': Flags.string({
      char: 'D',
      description: 'Path to a markdown file for the ticket description (use - for stdin)',
      exclusive: ['description'],
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
      aliases: ['label'],
      description: 'Labels (comma-separated)',
    }),
    'dry-run': Flags.boolean({
      description: 'Validate inputs without creating ticket (use with --json for structured output)',
      default: false,
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

    // Read description from file if --description-file is provided
    if (flags['description-file']) {
      const filePath = flags['description-file'];
      try {
        if (filePath === '-') {
          // Guard: prevent hanging when no input is piped
          if (process.stdin.isTTY) {
            return handleError('DESCRIPTION_FILE_ERROR', 'Cannot read from stdin: no input piped. Use --description-file <path> with a file path instead, or pipe content via: echo "desc" | prlt ticket create --description-file -');
          }
          // Read from stdin
          flags.description = fs.readFileSync(0, 'utf-8');
        } else {
          flags.description = fs.readFileSync(filePath, 'utf-8');
        }
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return handleError('DESCRIPTION_FILE_ERROR', `Failed to read description file "${filePath}": ${errMsg}`);
      }
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
      ? flags.labels.split(',').map(l => l.trim()).filter(Boolean)
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

    // Use FlagResolver to handle both JSON mode and interactive prompts
    // This unifies the two code paths into one pattern
    if (!flags.interactive) {
      // In JSON mode, default column to first backlog status if not provided
      // This prevents prompting for column in non-interactive mode
      if (jsonMode && !flags.column) {
        // Prefer "Backlog" column, fall back to first column
        const backlogColumn = columns.find(c => c.toLowerCase() === 'backlog') || columns[0];
        flags.column = backlogColumn;
      }

      const resolver = new FlagResolver<typeof flags>({
        commandName: 'ticket create',
        baseCommand: 'prlt ticket create',
        jsonMode,
        flags,
        context: { projectId },
      });

      // Column selection - prompted first if missing
      resolver.addPrompt({
        flagName: 'column',
        type: 'list',
        message: 'Select column to place the ticket in:',
        choices: () => columns.map(c => ({ name: c, value: c })),
        when: (ctx) => !ctx.flags.column,
      });

      // Title input - prompted after column is set
      resolver.addPrompt({
        flagName: 'title',
        type: 'input',
        message: 'Enter ticket title:',
        when: (ctx) => !ctx.flags.title && ctx.flags.column !== undefined,
        validate: (value) => (value as string).trim() ? true : 'Title cannot be empty',
        context: (ctx) => ({
          hint: `Provide title with: ${ctx.baseCommand}${ctx.projectId ? ` -P ${ctx.projectId}` : ''} --column "${ctx.flags.column}" --title "Your title here"`,
          requiredFields: ['--title'],
          optionalFields: ['--priority', '--category', '--description', '--epic', '--labels'],
          example: `${ctx.baseCommand}${ctx.projectId ? ` -P ${ctx.projectId}` : ''} --column "${ctx.flags.column}" --title "Fix login bug" --priority P1 --category bug`,
        }),
      });

      // Resolve missing flags (in JSON mode, outputs prompt and exits; in interactive mode, prompts user)
      const resolvedFlags = await resolver.resolve();

      // If we get here, we have both column and title
      if (!resolvedFlags.title && !template?.titlePattern) {
        this.error('Title is required. Use --title or -t flag, or use --interactive mode.');
      }

      ticketData = {
        title: resolvedFlags.title || template?.titlePattern || '',
        statusName: resolvedFlags.column || columns[0],
        priority: resolvedFlags.priority || template?.defaultPriority,
        category: resolvedFlags.category || template?.defaultCategory,
        description: resolvedFlags.description || template?.descriptionTemplate,
        id: resolvedFlags.id,
        epicId: resolvedFlags.epic,
        labels: labelsFromFlag || template?.defaultLabels,
      };
    } else {
      // Full interactive mode - use the detailed prompts
      ticketData = await this.promptTicketData(flags, this.storage, template, columns);
    }

    // Validate status/column
    if (!columns.includes(ticketData.statusName)) {
      if (flags['dry-run']) {
        if (jsonMode) {
          outputDryRunErrorsAsJson(
            [{ field: 'column', error: `Invalid column "${ticketData.statusName}". Available: ${columns.join(', ')}` }],
            createMetadata('ticket create', flags)
          );
        }
        this.error(`Invalid column "${ticketData.statusName}". Available columns: ${columns.join(', ')}`);
      }
      this.error(`Invalid column "${ticketData.statusName}". Available columns: ${columns.join(', ')}`);
    }

    // Handle dry-run: show what would be created without actually creating
    if (flags['dry-run']) {
      const wouldCreate = {
        title: ticketData.title,
        project: projectId,
        column: ticketData.statusName,
        ...(ticketData.priority && { priority: ticketData.priority }),
        ...(ticketData.category && { category: ticketData.category }),
        ...(ticketData.description && { description: ticketData.description }),
        ...(ticketData.epicId && { epic: ticketData.epicId }),
        ...(ticketData.labels && ticketData.labels.length > 0 && { labels: ticketData.labels }),
      };

      if (jsonMode) {
        outputDryRunSuccessAsJson('ticket', wouldCreate, createMetadata('ticket create', flags));
      }

      // Human-readable dry-run output
      this.log(styles.warning('\n[DRY RUN] Would create ticket:'));
      this.log(styles.muted(`   Title: ${ticketData.title}`));
      this.log(styles.muted(`   Project: ${projectName}`));
      this.log(styles.muted(`   Column: ${ticketData.statusName}`));
      if (ticketData.priority) {
        this.log(styles.muted(`   Priority: ${ticketData.priority}`));
      }
      if (ticketData.category) {
        this.log(styles.muted(`   Category: ${ticketData.category}`));
      }
      if (ticketData.epicId) {
        this.log(styles.muted(`   Epic: ${ticketData.epicId}`));
      }
      if (ticketData.labels && ticketData.labels.length > 0) {
        this.log(styles.muted(`   Labels: ${ticketData.labels.join(', ')}`));
      }
      if (template) {
        this.log(styles.muted(`   Template: ${template.name}`));
        if (template.suggestedSubtasks.length > 0) {
          this.log(styles.muted(`   Subtasks: ${template.suggestedSubtasks.length} would be created`));
        }
      }
      this.log(styles.muted('\n(No ticket was created)'));
      return;
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
      // Sequential subtask creation for consistent ordering
      for (const subtask of template.suggestedSubtasks) {
        // eslint-disable-next-line no-await-in-loop
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
        const { selectedTemplate } = await this.prompt<{ selectedTemplate: string }>([
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
        ], null);

        if (selectedTemplate) {
          template = templates.find(t => t.id === selectedTemplate) || null;
        }
      }
    }

    // Prompt for title
    const { title: answerTitle } = await this.prompt<{ title: string }>([
      {
        type: 'input',
        name: 'title',
        message: 'Ticket title:',
        default: flags.title || template?.titlePattern,
        validate: (input: unknown) => (input as string).trim() ? true : 'Title cannot be empty',
      },
    ], null);

    // Prompt for column
    const { column: answerColumn } = await this.prompt<{ column: string }>([
      {
        type: 'list',
        name: 'column',
        message: 'Column:',
        choices: columns.map(c => ({ name: c, value: c })),
        default: flags.column || columns[0],
      },
    ], null);

    // Prompt for priority
    const { priority: answerPriority } = await this.prompt<{ priority?: string }>([
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
    ], null);

    // Prompt for category
    const { categoryChoice } = await this.prompt<{ categoryChoice: string }>([
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
    ], null);

    // Custom category prompt if needed
    let customCategory: string | undefined;
    if (categoryChoice === '__custom__') {
      const result = await this.prompt<{ customCategory: string }>([{
        type: 'input',
        name: 'customCategory',
        message: 'Enter custom category:',
        validate: (input: unknown) => (input as string).trim() ? true : 'Category cannot be empty',
      }], null);
      customCategory = result.customCategory;
    }

    const answers = { title: answerTitle, column: answerColumn, priority: answerPriority, categoryChoice, customCategory };

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
      ? flags.labels.split(',').map(l => l.trim()).filter(Boolean)
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

    // Prompt for "What" - the main outcome
    const { what } = await this.prompt<{ what: string }>([
      {
        type: 'input',
        name: 'what',
        message: 'What is the concrete outcome? (one sentence):',
        validate: (input: unknown) => (input as string).trim() ? true : 'Outcome cannot be empty - what does success look like?',
      },
    ], null);

    // Prompt for acceptance criteria using multiline input
    const doneWhenResult = await multiLineInput({
      message: 'Done when (acceptance criteria):',
      hint: 'Enter each criterion on a new line. Ctrl+D to finish, Ctrl+C to cancel',
    });

    if (doneWhenResult.cancelled) {
      throw new Error('Ticket creation cancelled');
    }

    // Continue with remaining prompts
    const { context } = await this.prompt<{ context: string }>([
      {
        type: 'input',
        name: 'context',
        message: 'Context (files, patterns, hints - optional):',
        default: '',
      },
    ], null);

    const { notInScope } = await this.prompt<{ notInScope: string }>([
      {
        type: 'input',
        name: 'notInScope',
        message: 'Not in scope (explicit exclusions - optional):',
        default: '',
      },
    ], null);

    // Build structured description
    const parts: string[] = [];

    parts.push(`## What\n${what}`);

    if (doneWhenResult.value.trim()) {
      // Ensure each line in doneWhen starts with - [ ] if it doesn't already
      const criteria = doneWhenResult.value
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

    if (context.trim()) {
      parts.push(`## Context\n${context}`);
    }

    if (notInScope.trim()) {
      parts.push(`## Not in scope\n${notInScope}`);
    }

    return parts.join('\n\n');
  }

}
