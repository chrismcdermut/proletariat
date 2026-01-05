import { Command, Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class PhaseTemplateDelete extends Command {
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
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PhaseTemplateDelete);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false
    );

    try {
      // Verify template exists
      const template = await storage.getPhaseTemplate(args.id);
      if (!template) {
        await storage.close();
        this.error(`Phase template not found: ${args.id}`);
      }

      if (template.isBuiltin) {
        await storage.close();
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
          await storage.close();
          this.log(styles.muted('Cancelled'));
          return;
        }
      }

      await storage.deletePhaseTemplate(args.id);

      await storage.close();

      this.log(styles.success(`\nDeleted phase template "${template.name}"`));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
