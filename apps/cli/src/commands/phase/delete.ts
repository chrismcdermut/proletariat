import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class PhaseDelete extends PMOCommand {
  static description = 'Delete a project lifecycle phase';

  static examples = [
    '<%= config.bin %> <%= command.id %> on-hold',
    '<%= config.bin %> <%= command.id %> on-hold --force',
  ];

  static args = {
    id: Args.string({
      description: 'Phase ID',
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
    const { args, flags } = await this.parse(PhaseDelete);

    const phase = await this.storage.getPhase(args.id);
    if (!phase) {
      this.error(`Phase "${args.id}" not found.`);
    }

    if (!flags.force) {
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
        type: 'confirm',
        name: 'confirm',
        message: `Delete phase "${phase.name}"?`,
        default: false,
      }]);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    await this.storage.deletePhase(args.id);

    this.log(styles.success(`\nDeleted phase "${phase.name}"`));
  }
}
