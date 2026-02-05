import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { PRIORITIES, PRIORITY_LABELS, TICKET_CATEGORIES } from '../../../lib/pmo/types.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputPromptAsJson,
  buildFormPromptConfig,
  createMetadata,
  FormField,
} from '../../../lib/prompt-json.js';

export default class TicketTemplateCreate extends PMOCommand {
  static description = 'Create a new ticket template from scratch';

  static examples = [
    '<%= config.bin %> <%= command.id %> "Bug Report"',
    '<%= config.bin %> <%= command.id %> "Feature Request" -d "Template for new features"',
    '<%= config.bin %> <%= command.id %> "Task" --title-pattern "[TASK] " --priority P2',
    '<%= config.bin %> <%= command.id %> "Onboarding" --subtask "Setup environment" --subtask "Read docs"',
    '<%= config.bin %> <%= command.id %> "Bug" --ac "Bug is fixed" --ac "Tests pass" --category bug',
  ];

  static args = {
    name: Args.string({
      description: 'Template name',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
    'title-pattern': Flags.string({
      description: 'Default title prefix/pattern (e.g., "[BUG] ")',
    }),
    'description-template': Flags.string({
      description: 'Default description template (markdown)',
    }),
    priority: Flags.string({
      char: 'p',
      description: 'Default priority',
      options: [...PRIORITIES],
    }),
    category: Flags.string({
      char: 'c',
      description: 'Default category',
      options: [...TICKET_CATEGORIES],
    }),
    subtask: Flags.string({
      description: 'Add a suggested subtask (can be used multiple times)',
      multiple: true,
    }),
    ac: Flags.string({
      description: 'Add an acceptance criterion pattern (can be used multiple times)',
      multiple: true,
    }),
    label: Flags.string({
      char: 'l',
      description: 'Add a default label (can be used multiple times)',
      multiple: true,
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketTemplateCreate);
    const jsonMode = shouldOutputJson(flags);

    // Check if we have all required data via flags (non-interactive mode)
    const hasName = Boolean(args.name);
    const hasAllFlags = hasName; // Name is the only required field

    // In JSON mode with missing required data, output form prompt
    if (jsonMode && !hasAllFlags) {
      const fields: FormField[] = [];

      if (!hasName) {
        fields.push({
          type: 'input',
          name: 'name',
          message: 'Template name:',
        });
      }

      // Add optional fields that weren't provided
      if (flags.description === undefined) {
        fields.push({
          type: 'input',
          name: 'description',
          message: 'Template description (optional):',
        });
      }

      if (flags['title-pattern'] === undefined) {
        fields.push({
          type: 'input',
          name: 'titlePattern',
          message: 'Title prefix/pattern (optional, e.g., "[BUG] "):',
        });
      }

      if (flags.priority === undefined) {
        fields.push({
          type: 'list',
          name: 'priority',
          message: 'Default priority:',
          choices: [
            { name: 'None', value: '' },
            ...PRIORITIES.map(p => ({ name: PRIORITY_LABELS[p], value: p })),
          ],
        });
      }

      if (flags.category === undefined) {
        fields.push({
          type: 'list',
          name: 'category',
          message: 'Default category:',
          choices: [
            { name: 'None', value: '' },
            ...TICKET_CATEGORIES.map(c => ({ name: c, value: c })),
          ],
        });
      }

      outputPromptAsJson(
        buildFormPromptConfig(fields),
        createMetadata('ticket template create', flags)
      );
      return; // outputPromptAsJson exits, but TypeScript needs this
    }

    // Non-interactive mode: use flag values directly
    if (hasAllFlags && (jsonMode || this.hasNonDefaultFlags(flags))) {
      const name = args.name!;
      const description = flags.description;
      const titlePattern = flags['title-pattern'];
      const priority = flags.priority;
      const category = flags.category;
      const subtasks = flags.subtask || [];
      const acs = flags.ac || [];
      const labels = flags.label || [];

      // Build description template with ACs if provided
      let descriptionTemplate = flags['description-template'];
      if (acs.length > 0 && !descriptionTemplate) {
        // Create a description template with acceptance criteria section
        descriptionTemplate = '## Description\n\n## Acceptance Criteria\n' +
          acs.map(ac => `- [ ] ${ac}`).join('\n') + '\n';
      } else if (acs.length > 0 && descriptionTemplate) {
        // Append ACs to existing template if it doesn't have an AC section
        if (!descriptionTemplate.toLowerCase().includes('acceptance criteria')) {
          descriptionTemplate += '\n\n## Acceptance Criteria\n' +
            acs.map(ac => `- [ ] ${ac}`).join('\n') + '\n';
        }
      }

      // Create the template
      const template = await this.storage.createTicketTemplate({
        name,
        description,
        titlePattern,
        defaultPriority: priority,
        defaultCategory: category,
        descriptionTemplate,
        suggestedSubtasks: subtasks.map(title => ({ title })),
        defaultLabels: labels,
      });

      if (jsonMode) {
        outputSuccessAsJson({
          template: {
            id: template.id,
            name: template.name,
            description: template.description,
            titlePattern: template.titlePattern,
            defaultPriority: template.defaultPriority,
            defaultCategory: template.defaultCategory,
            descriptionTemplate: template.descriptionTemplate,
            suggestedSubtasks: template.suggestedSubtasks,
            defaultLabels: template.defaultLabels,
          },
        }, createMetadata('ticket template create', flags));
        return;
      }

      this.log(styles.success(`\nCreated template "${styles.emphasis(template.name)}"`));
      this.log(styles.muted(`  ID: ${template.id}`));
      this.log('');
      this.log(styles.muted(`Create ticket from template: prlt ticket template apply ${template.id}`));
      return;
    }

    // Interactive mode
    // Get template name
    let name = args.name;
    if (!name) {
      const { templateName } = await inquirer.prompt([{
        type: 'input',
        name: 'templateName',
        message: 'Template name:',
        validate: (input: string) => input.length > 0 || 'Name is required',
      }]);
      name = templateName;
    }

    // Get description if not provided
    let description = flags.description;
    if (description === undefined) {
      const { templateDescription } = await inquirer.prompt([{
        type: 'input',
        name: 'templateDescription',
        message: 'Description (optional):',
      }]);
      description = templateDescription || undefined;
    }

    // Get title pattern
    let titlePattern = flags['title-pattern'];
    if (titlePattern === undefined) {
      const { pattern } = await inquirer.prompt([{
        type: 'input',
        name: 'pattern',
        message: 'Title prefix/pattern (optional, e.g., "[BUG] "):',
      }]);
      titlePattern = pattern || undefined;
    }

    // Get default priority
    let priority = flags.priority;
    if (priority === undefined) {
      const { selectedPriority } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedPriority',
        message: 'Default priority:',
        choices: [
          { name: 'None', value: '' },
          ...PRIORITIES.map(p => ({ name: PRIORITY_LABELS[p], value: p })),
        ],
      }]);
      priority = selectedPriority || undefined;
    }

    // Get default category
    let category = flags.category;
    if (category === undefined) {
      const { selectedCategory } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedCategory',
        message: 'Default category:',
        choices: [
          { name: 'None', value: '' },
          ...TICKET_CATEGORIES.map(c => ({ name: c, value: c })),
        ],
      }]);
      category = selectedCategory || undefined;
    }

    // Handle description template - use flag value or prompt
    let descriptionTemplate = flags['description-template'];
    if (descriptionTemplate === undefined) {
      const { wantDescriptionTemplate } = await inquirer.prompt([{
        type: 'list',
        name: 'wantDescriptionTemplate',
        message: 'Add a description template?',
        choices: [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
      }]);

      if (wantDescriptionTemplate) {
        const { template } = await inquirer.prompt([{
          type: 'editor',
          name: 'template',
          message: 'Description template (opens editor):',
          default: `## Summary\n\n## Details\n\n## Acceptance Criteria\n- [ ] \n`,
        }]);
        descriptionTemplate = template || undefined;
      }
    }

    // Handle subtasks - use flag values or prompt
    const subtasks: string[] = flags.subtask ? [...flags.subtask] : [];
    if (subtasks.length === 0) {
      const { wantSubtasks } = await inquirer.prompt([{
        type: 'list',
        name: 'wantSubtasks',
        message: 'Add default subtasks?',
        choices: [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
      }]);

      if (wantSubtasks) {
        let addMore = true;
        while (addMore) {
          // eslint-disable-next-line no-await-in-loop -- Interactive loop for subtask creation
          const { subtaskTitle } = await inquirer.prompt([{
            type: 'input',
            name: 'subtaskTitle',
            message: 'Subtask title:',
            validate: (input: string) => input.length > 0 || 'Title is required',
          }]);
          subtasks.push(subtaskTitle);

          // eslint-disable-next-line no-await-in-loop -- Interactive loop continuation
          const { another } = await inquirer.prompt([{
            type: 'list',
            name: 'another',
            message: 'Add another subtask?',
            choices: [
              { name: 'No', value: false },
              { name: 'Yes', value: true },
            ],
          }]);
          addMore = another;
        }
      }
    }

    // Handle ACs - add to description template if provided via flag
    const acs = flags.ac || [];
    if (acs.length > 0) {
      if (!descriptionTemplate) {
        descriptionTemplate = '## Description\n\n## Acceptance Criteria\n' +
          acs.map(ac => `- [ ] ${ac}`).join('\n') + '\n';
      } else if (!descriptionTemplate.toLowerCase().includes('acceptance criteria')) {
        descriptionTemplate += '\n\n## Acceptance Criteria\n' +
          acs.map(ac => `- [ ] ${ac}`).join('\n') + '\n';
      }
    }

    // Handle labels
    const labels: string[] = flags.label ? [...flags.label] : [];

    // Show preview
    this.log(`\n${styles.emphasis('Template Preview:')}`);
    this.log(styles.muted(`  Name: ${name}`));
    if (description) {
      this.log(styles.muted(`  Description: ${description}`));
    }
    if (titlePattern) {
      this.log(styles.muted(`  Title pattern: ${titlePattern}`));
    }
    if (priority) {
      this.log(styles.muted(`  Default priority: ${PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS] || priority}`));
    }
    if (category) {
      this.log(styles.muted(`  Default category: ${category}`));
    }
    if (descriptionTemplate) {
      this.log(styles.muted(`  Description template: (custom)`));
    }
    if (subtasks.length > 0) {
      this.log(styles.muted(`  Default subtasks:`));
      for (const subtask of subtasks) {
        this.log(styles.muted(`    - ${subtask}`));
      }
    }
    if (labels.length > 0) {
      this.log(styles.muted(`  Default labels: ${labels.join(', ')}`));
    }

    // Confirm creation
    const { confirm } = await inquirer.prompt([{
      type: 'list',
      name: 'confirm',
      message: 'Create this template?',
      choices: [
        { name: 'Yes', value: true },
        { name: 'No', value: false },
      ],
    }]);

    if (!confirm) {
      this.log(styles.muted('Cancelled.'));
      return;
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

    this.log(styles.success(`\nCreated template "${styles.emphasis(template.name)}"`));
    this.log(styles.muted(`  ID: ${template.id}`));
    this.log('');
    this.log(styles.muted(`Create ticket from template: prlt ticket template apply ${template.id}`));
  }

  /**
   * Check if any non-default flags were provided (indicating non-interactive intent)
   */
  private hasNonDefaultFlags(flags: Record<string, unknown>): boolean {
    const nonDefaultFlags = [
      'description',
      'title-pattern',
      'description-template',
      'priority',
      'category',
      'subtask',
      'ac',
      'label',
    ];
    return nonDefaultFlags.some(flag => flags[flag] !== undefined);
  }
}
