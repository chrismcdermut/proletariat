import { Command, Flags, Args } from '@oclif/core';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class StatusMove extends Command {
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
    position: Flags.integer({
      char: 'p',
      description: 'New position (0-indexed) within the category',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(StatusMove);

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

      const oldPosition = existing.position;
      const newPosition = flags.position;

      if (newPosition < 0) {
        await storage.close();
        this.error('Position must be >= 0');
      }

      const updated = await storage.reorderStatus(args.id, newPosition);

      await storage.close();

      if (oldPosition === newPosition) {
        this.log(styles.muted(`Status "${updated.name}" is already at position ${newPosition}`));
      } else {
        this.log(styles.success(`Moved "${updated.name}" from position ${oldPosition} to ${updated.position}`));
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
