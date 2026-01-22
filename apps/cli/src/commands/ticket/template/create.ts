import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { PRIORITIES, PRIORITY_LABELS, TICKET_CATEGORIES } from '../../../lib/pmo/types.js';
import { styles } from '../../../lib/styles.js';

export default class TicketTemplateCreate extends PMOCommand {
  static description = 'Create a new ticket template from scratch';

  static examples = [
    '<%= config.bin %> <%= command.id %> "Bug Report"',
    '<%= config.bin %> <%= command.id %> "Feature Request" -d "Template for new features"',
    '<%= config.bin %> <%= command.id %> "Task" --title-pattern "[TASK] " --priority P2',
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
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketTemplateCreate);

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

    // Ask about description template
    const { wantDescriptionTemplate } = await inquirer.prompt([{
      type: 'list',
      name: 'wantDescriptionTemplate',
      message: 'Add a description template?',
      choices: [
        { name: 'No', value: false },
        { name: 'Yes', value: true },
      ],
    }]);

    let descriptionTemplate: string | undefined;
    if (wantDescriptionTemplate) {
      const { template } = await inquirer.prompt([{
        type: 'editor',
        name: 'template',
        message: 'Description template (opens editor):',
        default: `## Summary\n\n## Details\n\n## Acceptance Criteria\n- [ ] \n`,
      }]);
      descriptionTemplate = template || undefined;
    }

    // Ask about default subtasks
    const subtasks: string[] = [];
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
        const { subtaskTitle } = await inquirer.prompt([{
          type: 'input',
          name: 'subtaskTitle',
          message: 'Subtask title:',
          validate: (input: string) => input.length > 0 || 'Title is required',
        }]);
        subtasks.push(subtaskTitle);

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
      defaultLabels: [],
    });

    this.log(styles.success(`\nCreated template "${styles.emphasis(template.name)}"`));
    this.log(styles.muted(`  ID: ${template.id}`));
    this.log('');
    this.log(styles.muted(`Create ticket from template: prlt ticket template apply ${template.id}`));
  }
}
