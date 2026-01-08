import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class ActionDelete extends PMOCommand {
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
    const { args, flags } = await this.parse(ActionDelete);

    const action = await this.storage.getAction(args.id);

    if (!action) {
      this.error(`Action not found: ${args.id}`);
    }

    if (action.isBuiltin) {
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
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    await this.storage.deleteAction(args.id);

    this.log(styles.success(`\nDeleted action "${action.name}"`));
  }
}
