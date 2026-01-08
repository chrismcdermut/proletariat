import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class StatusTemplateDelete extends PMOCommand {
  static description = 'Delete a workflow status template';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-template',
    '<%= config.bin %> <%= command.id %> my-template --force',
  ];

  static args = {
    id: Args.string({
      description: 'Template ID',
      required: true,
    }),
  };

  static flags = {
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
    const { args, flags } = await this.parse(StatusTemplateDelete);

    const template = await this.storage.getTemplate(args.id);
    if (!template) {
      this.error(`Template "${args.id}" not found.`);
    }

    if (template.isBuiltin) {
      this.error('Cannot delete built-in templates.');
    }

    if (!flags.force) {
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
        type: 'confirm',
        name: 'confirm',
        message: `Delete template "${template.name}"?`,
        default: false,
      }]);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    try {
      await this.storage.deleteTemplate(args.id);
      this.log(styles.success(`\nDeleted template "${template.name}"`));
    } catch (error) {
      if (error instanceof Error && error.message.includes('Cannot delete')) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
