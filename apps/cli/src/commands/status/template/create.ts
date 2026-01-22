import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import type { StateCategory, WorkflowTemplateStatus } from '../../../lib/pmo/types.js';
import { STATE_CATEGORY_ORDER } from '../../../lib/pmo/types.js';

const CATEGORY_LABELS: Record<StateCategory, string> = {
  backlog: 'Backlog',
  unstarted: 'Not Started',
  started: 'In Progress',
  completed: 'Completed',
  canceled: 'Canceled',
};

export default class StatusTemplateCreate extends PMOCommand {
  static description = 'Create a new workflow template from scratch';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Workflow"',
    '<%= config.bin %> <%= command.id %> "Simple" --statuses "Todo,In Progress,Done"',
    '<%= config.bin %> <%= command.id %> "Kanban" --description "Simple kanban board" --statuses "Backlog,Ready,Doing,Review,Done"',
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
    statuses: Flags.string({
      char: 's',
      description: 'Comma-separated list of status names (auto-assigns categories based on position)',
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(StatusTemplateCreate);

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
    if (!description) {
      const { templateDescription } = await inquirer.prompt([{
        type: 'input',
        name: 'templateDescription',
        message: 'Description (optional):',
      }]);
      description = templateDescription || undefined;
    }

    // Get statuses
    let statuses: WorkflowTemplateStatus[] = [];

    if (flags.statuses) {
      // Parse statuses from flag
      const statusNames = flags.statuses.split(',').map(s => s.trim()).filter(s => s);
      statuses = this.assignCategories(statusNames);
    } else {
      // Interactive mode - prompt for statuses
      this.log(styles.muted('\nEnter status names (one per line). Empty line to finish.'));
      this.log(styles.muted('Categories will be auto-assigned based on position.\n'));

      const statusNames: string[] = [];
      let adding = true;

      while (adding) {
        const { statusName } = await inquirer.prompt([{
          type: 'input',
          name: 'statusName',
          message: `Status ${statusNames.length + 1}:`,
        }]);

        if (statusName.trim()) {
          statusNames.push(statusName.trim());
        } else {
          adding = false;
        }
      }

      if (statusNames.length === 0) {
        // Use default statuses
        this.log(styles.muted('\nNo statuses entered. Using defaults: Backlog, Ready, In Progress, Done'));
        statuses = this.assignCategories(['Backlog', 'Ready', 'In Progress', 'Done']);
      } else {
        statuses = this.assignCategories(statusNames);
      }
    }

    // Show preview
    this.log(`\n${styles.emphasis('Template Preview:')}`);
    this.log(styles.muted(`  Name: ${name}`));
    if (description) {
      this.log(styles.muted(`  Description: ${description}`));
    }
    this.log(styles.muted(`  Statuses:`));
    for (const status of statuses) {
      this.log(styles.muted(`    • ${status.name} [${status.category}]`));
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
    const template = await this.storage.createTemplate(name!, statuses, description);

    this.log(styles.success(`\nCreated template "${styles.emphasis(template.name)}"`));
    this.log(styles.muted(`  ID: ${template.id}`));
    if (template.description) {
      this.log(styles.muted(`  Description: ${template.description}`));
    }
    this.log(styles.muted(`  Statuses: ${template.statuses.length}`));
    this.log('');
    this.log(styles.muted(`Apply to a project: prlt status template apply ${template.id}`));
  }

  /**
   * Auto-assign categories based on position:
   * - First status: backlog
   * - Second status: unstarted
   * - Last status: completed
   * - Middle statuses: started
   */
  private assignCategories(statusNames: string[]): WorkflowTemplateStatus[] {
    return statusNames.map((name, index) => {
      let category: StateCategory;
      if (index === 0) {
        category = 'backlog';
      } else if (index === 1 && statusNames.length > 2) {
        category = 'unstarted';
      } else if (index === statusNames.length - 1) {
        category = 'completed';
      } else {
        category = 'started';
      }

      return {
        name,
        category,
        position: index,
      };
    });
  }
}
