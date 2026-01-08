import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class PhaseTemplateApply extends PMOCommand {
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
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt (will replace existing phases)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PhaseTemplateApply);

    // Verify template exists
    const template = await this.storage.getPhaseTemplate(args.template);
    if (!template) {
      this.error(`Phase template not found: ${args.template}\nRun 'prlt phase template list' to see available templates.`);
    }

    // Check if workspace has existing phases
    const existingPhases = await this.storage.listPhases();
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
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    // Apply template
    const phases = await this.storage.applyPhaseTemplate(args.template);

    this.log(styles.success(`\nApplied phase template "${styles.emphasis(template.name)}"`));
    this.log(styles.muted(`Created ${phases.length} phases:`));
    for (const phase of phases) {
      const defaultBadge = phase.isDefault ? ' (default)' : '';
      this.log(styles.muted(`  • ${phase.name} [${phase.category}]${defaultBadge}`));
    }
  }
}
