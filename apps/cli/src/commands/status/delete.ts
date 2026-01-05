import { Command, Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class StatusDelete extends Command {
  static description = 'Delete a workflow status';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project-blocked',
    '<%= config.bin %> <%= command.id %> my-project-review --force',
  ];

  static args = {
    id: Args.string({
      description: 'Status ID',
      required: true,
    }),
  };

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(StatusDelete);

    // Get storage without project context since we're using status ID directly
    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Get existing status
      const existing = await storage.getStatus(args.id);
      if (!existing) {
        await storage.close();
        this.error(`Status not found: ${args.id}`);
      }

      // Confirm deletion
      if (!flags.force) {
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Delete status "${existing.name}" (${existing.category})?`,
            default: false,
          },
        ]);

        if (!confirm) {
          await storage.close();
          this.log(styles.muted('Cancelled'));
          return;
        }
      }

      await storage.deleteStatus(args.id);

      await storage.close();

      this.log(styles.success(`Deleted status "${existing.name}"`));
    } catch (error) {
      await storage.close();
      if (error instanceof Error && error.message.includes('ticket(s) are using it')) {
        this.error(error.message + '\nMove tickets to another status before deleting.');
      }
      throw error;
    }
  }
}
