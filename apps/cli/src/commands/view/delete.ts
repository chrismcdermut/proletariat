import { Command, Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class ViewDelete extends Command {
  static description = 'Delete a saved board view';

  static examples = [
    '<%= config.bin %> <%= command.id %> VIEW-001',
    '<%= config.bin %> <%= command.id %> VIEW-001 --force',
  ];

  static args = {
    id: Args.string({
      description: 'View ID',
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
    const { args, flags } = await this.parse(ViewDelete);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Get existing view
      const existing = await storage.getView(args.id);
      if (!existing) {
        this.error(`View not found: ${args.id}`);
      }

      // Confirm deletion
      if (!flags.force) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Delete view "${existing.name}" (${existing.id})?`,
            default: false,
          },
        ]);

        if (!confirm) {
          this.log(styles.muted('Cancelled'));
          await storage.close();
          return;
        }
      }

      await storage.deleteView(args.id);

      this.log(styles.success(`\n✅ Deleted view "${existing.name}" (${existing.id})`));

      await storage.close();
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
