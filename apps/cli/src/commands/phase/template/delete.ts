import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class PhaseTemplateDelete extends PMOCommand {
  static description = 'Delete a phase template';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-custom-template',
    '<%= config.bin %> <%= command.id %> my-template --force',
  ];

  static args = {
    id: Args.string({
      description: 'Template ID to delete',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PhaseTemplateDelete);

    // Verify template exists
    const template = await this.storage.getPhaseTemplate(args.id);
    if (!template) {
      this.error(`Phase template not found: ${args.id}`);
    }

    if (template.isBuiltin) {
      this.error('Cannot delete built-in templates');
    }

    if (!flags.force) {
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Delete phase template "${template.name}"?`,
          default: false,
        },
      ]);

      if (!confirm) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    await this.storage.deletePhaseTemplate(args.id);

    this.log(styles.success(`\nDeleted phase template "${template.name}"`));
  }
}
