import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class PhaseMove extends PMOCommand {
  static description = 'Change the position of a phase within its category';

  static examples = [
    '<%= config.bin %> <%= command.id %> on-hold --position 0',
    '<%= config.bin %> <%= command.id %> in-review --position 1',
  ];

  static args = {
    id: Args.string({
      description: 'Phase ID',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    position: Flags.integer({
      char: 'p',
      description: 'New position (0-indexed)',
      required: true,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PhaseMove);

    const phase = await this.storage.getPhase(args.id);
    if (!phase) {
      this.error(`Phase "${args.id}" not found.`);
    }

    const updated = await this.storage.reorderPhase(args.id, flags.position);

    this.log(styles.success(`\nMoved phase "${updated.name}" to position ${updated.position}`));
  }
}
