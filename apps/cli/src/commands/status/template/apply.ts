import { Command, Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class StatusTemplateApply extends Command {
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
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt (will replace existing statuses)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(StatusTemplateApply);

    const { storage, projectName, projectId } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Verify template exists
      const template = await storage.getTemplate(args.template);
      if (!template) {
        await storage.close();
        this.error(`Template not found: ${args.template}\nRun 'prlt status template list' to see available templates.`);
      }

      // Check if project has existing statuses
      const existingStatuses = await storage.listStatuses(projectId);
      if (existingStatuses.length > 0 && !flags.force) {
        this.log(styles.warning(`\nProject "${projectName}" has ${existingStatuses.length} existing status(es).`));
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
          await storage.close();
          this.log(styles.muted('Cancelled'));
          return;
        }
      }

      // Apply template
      const statuses = await storage.applyTemplate(projectId, args.template);

      await storage.close();

      this.log(styles.success(`\nApplied template "${styles.emphasis(template.name)}" to project "${projectName}"`));
      this.log(styles.muted(`Created ${statuses.length} statuses:`));
      for (const status of statuses) {
        const defaultBadge = status.isDefault ? ' (default)' : '';
        this.log(styles.muted(`  • ${status.name} [${status.category}]${defaultBadge}`));
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
