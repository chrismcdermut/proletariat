import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class StatusDelete extends PMOCommand {
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

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(StatusDelete);

    // Get existing status
    const existing = await this.storage.getStatus(args.id);
    if (!existing) {
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
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    try {
      await this.storage.deleteStatus(args.id);
      this.log(styles.success(`Deleted status "${existing.name}"`));
    } catch (error) {
      if (error instanceof Error && error.message.includes('ticket(s) are using it')) {
        this.error(error.message + '\nMove tickets to another status before deleting.');
      }
      throw error;
    }
  }
}
