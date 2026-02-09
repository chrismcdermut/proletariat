import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { PRIORITIES, PRIORITY_LABELS } from '../../lib/pmo/types.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildFormPromptConfig,
  buildPromptConfig,
  FormField,
} from '../../lib/prompt-json.js';

type TemplateType = 'ticket' | 'phase';

export default class TemplateApply extends PMOCommand {
  static description = 'Apply a template';

  static examples = [
    '<%= config.bin %> <%= command.id %> --type ticket bug-report',
    '<%= config.bin %> <%= command.id %> --type ticket bug-report --title "Login fails"',
    '<%= config.bin %> <%= command.id %> --type phase agile',
    '<%= config.bin %> <%= command.id %> --type phase default --force',
  ];

  static args = {
    template: Args.string({
      description: 'Template ID to apply',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    type: Flags.string({
      char: 't',
      description: 'Template type',
      options: ['ticket', 'phase'],
    }),
    // Ticket-specific flags
    title: Flags.string({
      description: 'Ticket title (ticket only)',
    }),
    column: Flags.string({
      char: 'c',
      description: 'Column to place ticket (ticket only)',
    }),
    priority: Flags.string({
      char: 'p',
      description: 'Priority override (ticket only)',
      options: [...PRIORITIES],
    }),
    category: Flags.string({
      description: 'Category override (ticket only)',
    }),
    assignee: Flags.string({
      char: 'a',
      description: 'Assignee (ticket only)',
    }),
    owner: Flags.string({
      char: 'o',
      description: 'Owner (ticket only)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Description override (ticket only)',
    }),
    epic: Flags.string({
      char: 'e',
      description: 'Link to epic (ticket only)',
    }),
    'no-subtasks': Flags.boolean({
      description: 'Skip creating subtasks (ticket only)',
      default: false,
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode (ticket only)',
      default: false,
    }),
    // Phase-specific flags
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation (phase only)',
      default: false,
    }),
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output as JSON for AI agents/scripts',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TemplateApply);
    const jsonMode = shouldOutputJson(flags);

    // Determine template type
    let templateType = flags.type as TemplateType | undefined;

    if (!templateType) {
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'type', 'What type of template?', [
            { name: 'Ticket template', value: 'ticket' },
            { name: 'Phase template', value: 'phase' },
          ]),
          createMetadata('template apply', flags)
        );
        return;
      }

      const { selectedType } = await this.prompt<{ selectedType: TemplateType }>([{
        type: 'list',
        name: 'selectedType',
        message: 'What type of template?',
        choices: [
          { name: 'Ticket template', value: 'ticket' },
          { name: 'Phase template', value: 'phase' },
        ],
      }], null);
      templateType = selectedType;
    }

    if (templateType === 'ticket') {
      await this.applyTicketTemplate(args.template, flags, jsonMode);
    } else {
      await this.applyPhaseTemplate(args.template, flags, jsonMode);
    }
  }

  private async applyTicketTemplate(
    templateId: string | undefined,
    flags: Record<string, unknown>,
    jsonMode: boolean
  ): Promise<void> {
    const projectId = await this.requireProject();
    const board = await this.storage.getBoard(projectId);
    const columns = board.columns.map(col => col.name);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('template apply', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get template
    if (!templateId) {
      const templates = await this.storage.listTicketTemplates();
      if (templates.length === 0) {
        return handleError('NO_TEMPLATES', 'No ticket templates. Create with: prlt template create --type ticket');
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select template:',
        choices: templates.map(t => ({ name: `${t.name}${t.description ? ` - ${t.description}` : ''}`, value: t.id })),
      }], null);
      templateId = selected;
    }

    const template = await this.storage.getTicketTemplate(templateId!);
    if (!template) {
      return handleError('TEMPLATE_NOT_FOUND', `Template not found: ${templateId}`);
    }

    // Determine ticket data
    let title = (flags.title as string) || template.titlePattern || '';
    let column = (flags.column as string) || columns[0];
    let priority = (flags.priority as string) || template.defaultPriority;
    let category = (flags.category as string) || template.defaultCategory;
    let assignee = (flags.assignee as string) || template.defaultAssignee;
    let owner = (flags.owner as string) || template.defaultOwner;
    let description = (flags.description as string) || template.descriptionTemplate;
    const labels = template.defaultLabels;

    // Interactive mode
    if (flags.interactive || !title) {
      const fields: FormField[] = [
        { type: 'input', name: 'title', message: 'Title:', default: title || undefined },
        { type: 'list', name: 'column', message: 'Column:', choices: columns.map(c => ({ name: c, value: c })), default: column },
        { type: 'list', name: 'priority', message: 'Priority:', choices: [{ name: 'None', value: '' }, ...PRIORITIES.map(p => ({ name: PRIORITY_LABELS[p], value: p }))], default: priority },
      ];

      if (jsonMode) {
        outputPromptAsJson(buildFormPromptConfig(fields), createMetadata('template apply', flags));
        return;
      }

      const answers = await this.prompt<{ title: string; column: string; priority: string }>(fields.map(f => ({
        ...f,
        validate: f.name === 'title' ? ((i: unknown) => (i as string).length > 0 || 'Required') : undefined,
      })), null);

      title = answers.title;
      column = answers.column;
      priority = answers.priority || undefined;
    }

    // Validate epic if provided
    if (flags.epic) {
      const epic = await this.storage.getEpic(flags.epic as string);
      if (!epic) this.error(`Epic not found: ${flags.epic}`);
    }

    // Create ticket
    const ticket = await this.storage.createTicket(projectId, {
      title,
      statusName: column,
      priority,
      category,
      assignee,
      owner,
      labels,
      description,
      epicId: flags.epic as string,
    });

    // Add subtasks
    if (!flags['no-subtasks'] && template.suggestedSubtasks.length > 0) {
      for (const subtask of template.suggestedSubtasks) {
        await this.storage.addSubtask(ticket.id, subtask.title);
      }
    }

    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\nCreated ticket ${styles.emphasis(ticket.id)} from template "${template.name}"`));
    this.log(styles.muted(`  Title: ${ticket.title}`));
    this.log(styles.muted(`  Status: ${ticket.statusName}`));
    if (priority) this.log(styles.muted(`  Priority: ${priority}`));
    if (template.suggestedSubtasks.length > 0 && !flags['no-subtasks']) {
      this.log(styles.muted(`  Subtasks: ${template.suggestedSubtasks.length} created`));
    }
  }

  private async applyPhaseTemplate(
    templateId: string | undefined,
    flags: Record<string, unknown>,
    jsonMode: boolean
  ): Promise<void> {
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('template apply', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get template
    if (!templateId) {
      const templates = await this.storage.listPhaseTemplates();
      if (templates.length === 0) {
        return handleError('NO_TEMPLATES', 'No phase templates. Create with: prlt template create --type phase');
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select phase template:',
        choices: templates.map(t => ({ name: `${t.name}${t.description ? ` - ${t.description}` : ''}`, value: t.id })),
      }], null);
      templateId = selected;
    }

    const template = await this.storage.getPhaseTemplate(templateId!);
    if (!template) {
      return handleError('TEMPLATE_NOT_FOUND', `Template not found: ${templateId}`);
    }

    // Check existing phases
    const existingPhases = await this.storage.listPhases();
    if (existingPhases.length > 0 && !flags.force) {
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', `Replace ${existingPhases.length} existing phase(s)?`, [
            { name: 'No', value: 'false' },
            { name: 'Yes', value: 'true' },
          ]),
          createMetadata('template apply', flags)
        );
        return;
      }

      this.log(styles.warning(`\nThis will REPLACE ${existingPhases.length} existing phase(s).`));
      const { confirm } = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: `Apply template "${template.name}"?`,
        choices: [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
      }], null);

      if (!confirm) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    const phases = await this.storage.applyPhaseTemplate(templateId!);

    this.log(styles.success(`\nApplied phase template "${styles.emphasis(template.name)}"`));
    this.log(styles.muted(`Created ${phases.length} phases:`));
    for (const phase of phases) {
      this.log(styles.muted(`  • ${phase.name} [${phase.category}]`));
    }
  }
}
