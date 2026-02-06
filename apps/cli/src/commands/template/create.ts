import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { PRIORITIES, PRIORITY_LABELS, TICKET_CATEGORIES } from '../../lib/pmo/types.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputPromptAsJson,
  outputErrorAsJson,
  buildFormPromptConfig,
  createMetadata,
  FormField,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

type TemplateType = 'ticket' | 'phase';

export default class TemplateCreate extends PMOCommand {
  static description = 'Create a new template';

  static examples = [
    '<%= config.bin %> <%= command.id %> --type ticket "Bug Report"',
    '<%= config.bin %> <%= command.id %> --type ticket "Feature" -d "For new features"',
    '<%= config.bin %> <%= command.id %> --type phase "My Phases"',
    '<%= config.bin %> <%= command.id %> --type phase "Enterprise" --description "Enterprise lifecycle"',
  ];

  static args = {
    name: Args.string({
      description: 'Template name',
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
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
    // Ticket-specific flags
    'title-pattern': Flags.string({
      description: 'Default title prefix/pattern (ticket only)',
    }),
    'description-template': Flags.string({
      description: 'Default description template (ticket only)',
    }),
    priority: Flags.string({
      char: 'p',
      description: 'Default priority (ticket only)',
      options: [...PRIORITIES],
    }),
    category: Flags.string({
      char: 'c',
      description: 'Default category (ticket only)',
      options: [...TICKET_CATEGORIES],
    }),
    subtask: Flags.string({
      description: 'Add a suggested subtask (ticket only, can repeat)',
      multiple: true,
    }),
    ac: Flags.string({
      description: 'Add an acceptance criterion (ticket only, can repeat)',
      multiple: true,
    }),
    label: Flags.string({
      char: 'l',
      description: 'Add a default label (ticket only, can repeat)',
      multiple: true,
    }),
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output as JSON for AI agents/scripts',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TemplateCreate);
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
          createMetadata('template create', flags)
        );
        return;
      }

      const { selectedType } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedType',
        message: 'What type of template?',
        choices: [
          { name: 'Ticket template', value: 'ticket' },
          { name: 'Phase template', value: 'phase' },
        ],
      }]);
      templateType = selectedType;
    }

    if (templateType === 'ticket') {
      await this.createTicketTemplate(args.name, flags, jsonMode);
    } else {
      await this.createPhaseTemplate(args.name, flags, jsonMode);
    }
  }

  private async createTicketTemplate(
    name: string | undefined,
    flags: Record<string, unknown>,
    jsonMode: boolean
  ): Promise<void> {
    // Check if we have required data
    if (!name) {
      if (jsonMode) {
        const fields: FormField[] = [
          { type: 'input', name: 'name', message: 'Template name:' },
          { type: 'input', name: 'description', message: 'Description (optional):' },
          {
            type: 'list',
            name: 'priority',
            message: 'Default priority:',
            choices: [
              { name: 'None', value: '' },
              ...PRIORITIES.map(p => ({ name: PRIORITY_LABELS[p], value: p })),
            ],
          },
          {
            type: 'list',
            name: 'category',
            message: 'Default category:',
            choices: [
              { name: 'None', value: '' },
              ...TICKET_CATEGORIES.map(c => ({ name: c, value: c })),
            ],
          },
        ];
        outputPromptAsJson(buildFormPromptConfig(fields), createMetadata('template create', flags));
        return;
      }

      const { templateName } = await inquirer.prompt([{
        type: 'input',
        name: 'templateName',
        message: 'Template name:',
        validate: (input: string) => input.trim() ? true : 'Name required',
      }]);
      name = templateName;
    }

    // Get optional values
    let description = flags.description as string | undefined;
    let titlePattern = flags['title-pattern'] as string | undefined;
    let priority = flags.priority as string | undefined;
    let category = flags.category as string | undefined;
    const subtasks = (flags.subtask as string[]) || [];
    const acs = (flags.ac as string[]) || [];
    const labels = (flags.label as string[]) || [];
    let descriptionTemplate = flags['description-template'] as string | undefined;

    // Interactive prompts for missing optional values
    if (!jsonMode && description === undefined) {
      const { desc } = await inquirer.prompt([{
        type: 'input', name: 'desc', message: 'Description (optional):',
      }]);
      description = desc || undefined;
    }

    if (!jsonMode && priority === undefined) {
      const { p } = await inquirer.prompt([{
        type: 'list',
        name: 'p',
        message: 'Default priority:',
        choices: [
          { name: 'None', value: '' },
          ...PRIORITIES.map(pr => ({ name: PRIORITY_LABELS[pr], value: pr })),
        ],
      }]);
      priority = p || undefined;
    }

    if (!jsonMode && category === undefined) {
      const { c } = await inquirer.prompt([{
        type: 'list',
        name: 'c',
        message: 'Default category:',
        choices: [
          { name: 'None', value: '' },
          ...TICKET_CATEGORIES.map(cat => ({ name: cat, value: cat })),
        ],
      }]);
      category = c || undefined;
    }

    // Build description template with ACs
    if (acs.length > 0 && !descriptionTemplate) {
      descriptionTemplate = '## Description\n\n## Acceptance Criteria\n' +
        acs.map(ac => `- [ ] ${ac}`).join('\n') + '\n';
    }

    // Create the template
    const template = await this.storage.createTicketTemplate({
      name: name!,
      description,
      titlePattern,
      defaultPriority: priority,
      defaultCategory: category,
      descriptionTemplate,
      suggestedSubtasks: subtasks.map(title => ({ title })),
      defaultLabels: labels,
    });

    if (jsonMode) {
      outputSuccessAsJson({ template }, createMetadata('template create', flags));
      return;
    }

    this.log(styles.success(`\nCreated ticket template "${styles.emphasis(template.name)}"`));
    this.log(styles.muted(`  ID: ${template.id}`));
    this.log(styles.muted(`\nApply with: prlt template apply --type ticket ${template.id}`));
  }

  private async createPhaseTemplate(
    name: string | undefined,
    flags: Record<string, unknown>,
    jsonMode: boolean
  ): Promise<void> {
    if (!name) {
      if (jsonMode) {
        outputErrorAsJson('NAME_REQUIRED', 'Name required: prlt template create --type phase "Name"', createMetadata('template create', flags));
        return;
      }

      const { templateName } = await inquirer.prompt([{
        type: 'input',
        name: 'templateName',
        message: 'Template name:',
        validate: (input: string) => input.trim() ? true : 'Name required',
      }]);
      name = templateName;
    }

    let description = flags.description as string | undefined;
    if (!jsonMode && description === undefined) {
      const { desc } = await inquirer.prompt([{
        type: 'input', name: 'desc', message: 'Description (optional):',
      }]);
      description = desc || undefined;
    }

    const template = await this.storage.savePhaseTemplate(name!, description);

    if (jsonMode) {
      outputSuccessAsJson({
        id: template.id,
        name: template.name,
        phasesCount: template.phases.length,
      }, createMetadata('template create', flags));
      return;
    }

    this.log(styles.success(`\nCreated phase template "${styles.emphasis(template.name)}" (${template.id})`));
    this.log(styles.muted(`Saved ${template.phases.length} phases`));
    this.log(styles.muted(`\nApply with: prlt template apply --type phase ${template.id}`));
  }
}
