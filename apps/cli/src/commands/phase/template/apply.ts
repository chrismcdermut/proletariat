import { Command, Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class PhaseTemplateApply extends Command {
  static description = 'Apply a phase template to the workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> default',
    '<%= config.bin %> <%= command.id %> agile',
    '<%= config.bin %> <%= command.id %> product --force  # Skip confirmation',
  ];

  static args = {
    template: Args.string({
      description: 'Phase template ID to apply',
      required: true,
    }),
  };

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt (will replace existing phases)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PhaseTemplateApply);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false
    );

    try {
      // Verify template exists
      const template = await storage.getPhaseTemplate(args.template);
      if (!template) {
        await storage.close();
        this.error(`Phase template not found: ${args.template}\nRun 'prlt phase template list' to see available templates.`);
      }

      // Check if workspace has existing phases
      const existingPhases = await storage.listPhases();
      if (existingPhases.length > 0 && !flags.force) {
        this.log(styles.warning(`\nWorkspace has ${existingPhases.length} existing phase(s).`));
        this.log(styles.warning('Applying a template will REPLACE all existing phases.'));
        this.log('');

        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Apply template "${template.name}" and replace existing phases?`,
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
      const phases = await storage.applyPhaseTemplate(args.template);

      await storage.close();

      this.log(styles.success(`\nApplied phase template "${styles.emphasis(template.name)}"`));
      this.log(styles.muted(`Created ${phases.length} phases:`));
      for (const phase of phases) {
        const defaultBadge = phase.isDefault ? ' (default)' : '';
        this.log(styles.muted(`  • ${phase.name} [${phase.category}]${defaultBadge}`));
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
