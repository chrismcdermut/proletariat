import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class StatusTemplateApply extends PMOCommand {
  static description = 'Apply a workflow status template to a project';

  static examples = [
    '<%= config.bin %> <%= command.id %> kanban',
    '<%= config.bin %> <%= command.id %> linear --project my-project',
    '<%= config.bin %> <%= command.id %> bug-smash --force  # Skip confirmation',
  ];

  static args = {
    template: Args.string({
      description: 'Template ID to apply',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt (will replace existing statuses)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(StatusTemplateApply);

    // Verify template exists
    const template = await this.storage.getTemplate(args.template);
    if (!template) {
      this.error(`Template not found: ${args.template}\nRun 'prlt status template list' to see available templates.`);
    }

    // Check if project has existing statuses
    const existingStatuses = await this.storage.listStatuses(this.projectId);
    if (existingStatuses.length > 0 && !flags.force) {
      this.log(styles.warning(`\nProject "${this.projectName}" has ${existingStatuses.length} existing status(es).`));
      this.log(styles.warning('Applying a template will REPLACE all existing statuses.'));
      this.log('');

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Apply template "${template.name}" and replace existing statuses?`,
          default: false,
        },
      ]);

      if (!confirm) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    // Apply template
    const statuses = await this.storage.applyTemplate(this.projectId, args.template);

    this.log(styles.success(`\nApplied template "${styles.emphasis(template.name)}" to project "${this.projectName}"`));
    this.log(styles.muted(`Created ${statuses.length} statuses:`));
    for (const status of statuses) {
      const defaultBadge = status.isDefault ? ' (default)' : '';
      this.log(styles.muted(`  • ${status.name} [${status.category}]${defaultBadge}`));
    }
  }
}
