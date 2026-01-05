import { Command, Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class ActionDelete extends Command {
  static description = 'Delete a work action';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-custom-action',
    '<%= config.bin %> <%= command.id %> my-action --force',
  ];

  static args = {
    id: Args.string({
      description: 'Action ID to delete',
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
    const { args, flags } = await this.parse(ActionDelete);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false
    );

    try {
      const action = await storage.getAction(args.id);

      if (!action) {
        await storage.close();
        this.error(`Action not found: ${args.id}`);
      }

      if (action.isBuiltin) {
        await storage.close();
        this.error('Cannot delete built-in actions');
      }

      if (!flags.force) {
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Delete action "${action.name}"?`,
            default: false,
          },
        ]);

        if (!confirm) {
          await storage.close();
          this.log(styles.muted('Cancelled'));
          return;
        }
      }

      await storage.deleteAction(args.id);

      await storage.close();

      this.log(styles.success(`\nDeleted action "${action.name}"`));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
