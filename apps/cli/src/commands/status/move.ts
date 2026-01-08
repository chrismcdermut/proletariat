import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class StatusMove extends PMOCommand {
  static description = 'Reorder a status within its category';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project-in-review --position 0  # Move to first',
    '<%= config.bin %> <%= command.id %> my-project-blocked --position 2',
  ];

  static args = {
    id: Args.string({
      description: 'Status ID',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    position: Flags.integer({
      char: 'p',
      description: 'New position (0-indexed) within the category',
      required: true,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(StatusMove);

    // Get existing status
    const existing = await this.storage.getStatus(args.id);
    if (!existing) {
      this.error(`Status not found: ${args.id}`);
    }

    const oldPosition = existing.position;
    const newPosition = flags.position;

    if (newPosition < 0) {
      this.error('Position must be >= 0');
    }

    const updated = await this.storage.reorderStatus(args.id, newPosition);

    if (oldPosition === newPosition) {
      this.log(styles.muted(`Status "${updated.name}" is already at position ${newPosition}`));
    } else {
      this.log(styles.success(`Moved "${updated.name}" from position ${oldPosition} to ${updated.position}`));
    }
  }
}
