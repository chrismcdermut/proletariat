import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../../lib/pmo/index.js';
import { PRIORITIES, PRIORITY_LABELS } from '../../../lib/pmo/types.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
  buildFormPromptConfig,
  FormField,
} from '../../../lib/prompt-json.js';

export default class TicketTemplateApply extends PMOCommand {
  static description = 'Create a new ticket from a template';

  static examples = [
    '<%= config.bin %> <%= command.id %> bug-report',
    '<%= config.bin %> <%= command.id %> feature-request --title "Add dark mode"',
    '<%= config.bin %> <%= command.id %> bug-report --project my-project',
    '<%= config.bin %> <%= command.id %> bug-report -t "Login fails" -c Backlog',
  ];

  static args = {
    template: Args.string({
      description: 'Template ID to use',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    title: Flags.string({
      char: 't',
      description: 'Ticket title (overrides template pattern)',
    }),
    column: Flags.string({
      char: 'c',
      description: 'Column to place the ticket in',
    }),
    priority: Flags.string({
      char: 'p',
      description: 'Priority (overrides template default)',
      options: [...PRIORITIES],
    }),
    category: Flags.string({
      description: 'Category (overrides template default)',
    }),
    assignee: Flags.string({
      char: 'a',
      description: 'Assignee (overrides template default)',
    }),
    owner: Flags.string({
      char: 'o',
      description: 'Owner (overrides template default)',
    }),
    status: Flags.string({
      char: 's',
      description: 'Status ID (overrides template default)',
    }),
    labels: Flags.string({
      char: 'l',
      description: 'Labels (comma-separated, overrides template default)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Description (overrides template)',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode - prompt for values',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-subtasks': Flags.boolean({
      description: 'Do not create suggested subtasks',
      default: false,
    }),
    epic: Flags.string({
      char: 'e',
      description: 'Link ticket to an epic',
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketTemplateApply);
    // This command requires project context - get projectId and board info
    const projectId = await this.requireProject();
    const board = await this.storage.getBoard(projectId);
    const columns = board.columns.map(col => col.name);
    const projectName = board.name;

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket template apply', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get the template - prompt for selection if not provided
    let templateId = args.template;
    if (!templateId) {
      const templates = await this.storage.listTicketTemplates();
      if (templates.length === 0) {
        return handleError('NO_TEMPLATES', `No ticket templates found.\nCreate one with: prlt ticket template save <ticket-id> "Template Name"`);
      }

      const { selectedTemplate } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedTemplate',
        message: 'Select a template:',
        choices: templates.map(t => ({
          name: `${t.name}${t.description ? ` - ${t.description}` : ''}`,
          value: t.id,
        })),
      }]);
      templateId = selectedTemplate;
    }

    const template = await this.storage.getTicketTemplate(templateId!);
    if (!template) {
      return handleError('TEMPLATE_NOT_FOUND', `Template not found: ${templateId}\nRun 'prlt ticket template list' to see available templates.`);
    }

    // Validate epic if provided
    if (flags.epic) {
      const epic = await this.storage.getEpic(flags.epic);
      if (!epic) {
        this.error(`Epic not found: ${flags.epic}. Use 'prlt epic list' to see available epics.`);
      }
    }

    // Determine ticket data
    let title = flags.title || template.titlePattern || '';
    let column = flags.column || columns[0];
    let priority = flags.priority || template.defaultPriority;
    let category = flags.category || template.defaultCategory;
    let assignee = flags.assignee || template.defaultAssignee;
    let owner = flags.owner || template.defaultOwner;
    let statusId = flags.status || template.defaultStatusId;
    let labels = flags.labels ? flags.labels.split(',').map(l => l.trim()).filter(l => l) : template.defaultLabels;
    let description = flags.description || template.descriptionTemplate;

    // Interactive mode - prompt for values
    if (flags.interactive || !title) {
      // Build choices once - single source of truth
      const columnChoices = columns.map(c => ({ name: c, value: c }));
      const priorityChoices = [
        { name: 'None', value: '' },
        ...PRIORITIES.map(p => ({ name: PRIORITY_LABELS[p], value: p })),
      ];

      // Define fields once - single source of truth for both JSON and interactive modes
      const fields: FormField[] = [
        { type: 'input', name: 'title', message: 'Ticket title:', default: title || undefined },
        { type: 'list', name: 'column', message: 'Column:', choices: columnChoices, default: column },
        { type: 'list', name: 'priority', message: 'Priority:', choices: priorityChoices, default: priority },
        { type: 'input', name: 'category', message: 'Category:', default: category },
        { type: 'input', name: 'assignee', message: 'Assignee:', default: assignee },
        { type: 'input', name: 'owner', message: 'Owner:', default: owner },
        { type: 'editor', name: 'description', message: 'Description:', default: description },
      ];

      // In JSON mode, output form prompts
      if (jsonMode) {
        outputPromptAsJson(
          buildFormPromptConfig(fields),
          createMetadata('ticket template apply', flags)
        );
      }

      // Build inquirer prompts from fields, adding validators and inquirer-specific options
      const answers = await inquirer.prompt<{
        title: string;
        column: string;
        priority?: string;
        category?: string;
        assignee?: string;
        owner?: string;
        description?: string;
      }>(fields.map(field => ({
        ...field,
        // Convert empty string to undefined for priority choices in inquirer
        choices: field.name === 'priority' && field.choices
          ? field.choices.map(c => ({ ...c, value: c.value || undefined }))
          : field.name === 'column'
          ? columns  // Use simple array for column in interactive mode
          : field.choices,
        // Add validator for title
        validate: field.name === 'title'
          ? ((input: string) => input.length > 0 || 'Title is required')
          : undefined,
        // Update editor message for interactive mode
        message: field.name === 'description' ? 'Description (opens editor):' : field.message,
        // Add waitForUseInput for editor
        waitForUseInput: field.type === 'editor' ? false : undefined,
      })));

      title = answers.title;
      column = answers.column;
      priority = answers.priority;
      category = answers.category || undefined;
      assignee = answers.assignee || undefined;
      owner = answers.owner || undefined;
      description = answers.description || undefined;
    }

    // Validate column
    if (!columns.includes(column)) {
      this.error(`Invalid column "${column}". Available columns: ${columns.join(', ')}`);
    }

    // Validate status ID if provided
    if (statusId) {
      const status = await this.storage.getStatus(statusId);
      if (!status) {
        // Get project's workflow to list available statuses
        const projectInfo = await this.storage.getProject(projectId);
        const workflowId = projectInfo?.workflowId;
        const statuses = workflowId ? await this.storage.listStatuses(workflowId) : [];
        const statusNames = statuses.map(s => `${s.id} (${s.name})`).join(', ');
        this.error(`Invalid status "${statusId}". Available statuses: ${statusNames}`);
      }
    }

    // Create the ticket
    const ticket = await this.storage.createTicket(projectId, {
      title,
      statusName: column,
      priority,
      category,
      assignee,
      owner,
      statusId,
      labels,
      description,
      epicId: flags.epic,
    });

    // Add subtasks from template (unless disabled)
    if (!flags['no-subtasks'] && template.suggestedSubtasks.length > 0) {
      for (const subtask of template.suggestedSubtasks) {
        await this.storage.addSubtask(ticket.id, subtask.title);
      }
    }

    // Auto-export to board.md
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\nCreated ticket ${styles.emphasis(ticket.id)} from template "${template.name}"`));
    this.log(styles.muted(`  Project: ${projectName}`));
    this.log(styles.muted(`  Title: ${ticket.title}`));
    this.log(styles.muted(`  Status: ${ticket.statusName}`));
    if (priority) {
      this.log(styles.muted(`  Priority: ${priority}`));
    }
    if (category) {
      this.log(styles.muted(`  Category: ${category}`));
    }
    if (assignee) {
      this.log(styles.muted(`  Assignee: ${assignee}`));
    }
    if (owner) {
      this.log(styles.muted(`  Owner: ${owner}`));
    }
    if (statusId) {
      this.log(styles.muted(`  Status: ${statusId}`));
    }
    if (labels && labels.length > 0) {
      this.log(styles.muted(`  Labels: ${labels.join(', ')}`));
    }
    if (flags.epic) {
      this.log(styles.muted(`  Epic: ${flags.epic}`));
    }
    if (!flags['no-subtasks'] && template.suggestedSubtasks.length > 0) {
      this.log(styles.muted(`  Subtasks: ${template.suggestedSubtasks.length} created`));
    }
    this.log('');
    this.log(styles.muted(`View ticket: prlt ticket view ${ticket.id}`));
  }
}
