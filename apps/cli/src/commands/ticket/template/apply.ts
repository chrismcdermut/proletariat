import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

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
      required: true,
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
      options: ['URGENT', 'HIGH', 'MEDIUM', 'LOW'],
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

    // Get the template
    const template = await this.storage.getTicketTemplate(args.template);
    if (!template) {
      this.error(`Template not found: ${args.template}\nRun 'prlt ticket template list' to see available templates.`);
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
    let column = flags.column || this.columns[0];
    let priority = flags.priority || template.defaultPriority;
    let category = flags.category || template.defaultCategory;
    let assignee = flags.assignee || template.defaultAssignee;
    let owner = flags.owner || template.defaultOwner;
    let statusId = flags.status || template.defaultStatusId;
    let labels = flags.labels ? flags.labels.split(',').map(l => l.trim()).filter(l => l) : template.defaultLabels;
    let description = flags.description || template.descriptionTemplate;

    // Interactive mode - prompt for values
    if (flags.interactive || !title) {
      const answers = await inquirer.prompt<{
        title: string;
        column: string;
        priority?: string;
        category?: string;
        assignee?: string;
        owner?: string;
        description?: string;
      }>([
        {
          type: 'input',
          name: 'title',
          message: 'Ticket title:',
          default: title || undefined,
          validate: (input: string) => input.length > 0 || 'Title is required',
        },
        {
          type: 'list',
          name: 'column',
          message: 'Column:',
          choices: this.columns,
          default: column,
        },
        {
          type: 'list',
          name: 'priority',
          message: 'Priority:',
          choices: [
            { name: 'None', value: undefined },
            { name: 'URGENT', value: 'URGENT' },
            { name: 'HIGH', value: 'HIGH' },
            { name: 'MEDIUM', value: 'MEDIUM' },
            { name: 'LOW', value: 'LOW' },
          ],
          default: priority,
        },
        {
          type: 'input',
          name: 'category',
          message: 'Category:',
          default: category,
        },
        {
          type: 'input',
          name: 'assignee',
          message: 'Assignee:',
          default: assignee,
        },
        {
          type: 'input',
          name: 'owner',
          message: 'Owner:',
          default: owner,
        },
        {
          type: 'editor',
          name: 'description',
          message: 'Description (opens editor):',
          default: description,
          waitForUseInput: false,
        },
      ]);

      title = answers.title;
      column = answers.column;
      priority = answers.priority;
      category = answers.category || undefined;
      assignee = answers.assignee || undefined;
      owner = answers.owner || undefined;
      description = answers.description || undefined;
    }

    // Validate column
    if (!this.columns.includes(column)) {
      this.error(`Invalid column "${column}". Available columns: ${this.columns.join(', ')}`);
    }

    // Validate status ID if provided
    if (statusId) {
      const status = await this.storage.getStatus(statusId);
      if (!status) {
        const statuses = await this.storage.listStatuses(this.projectId);
        const statusNames = statuses.map(s => `${s.id} (${s.name})`).join(', ');
        this.error(`Invalid status "${statusId}". Available statuses: ${statusNames}`);
      }
    }

    // Create the ticket
    const ticket = await this.storage.createTicket({
      title,
      column,
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
    this.log(styles.muted(`  Project: ${this.projectName}`));
    this.log(styles.muted(`  Title: ${ticket.title}`));
    this.log(styles.muted(`  Column: ${ticket.column}`));
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
