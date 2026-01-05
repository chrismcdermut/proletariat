import { Command, Args, Flags } from '@oclif/core';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class PhaseMove extends Command {
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
    position: Flags.integer({
      char: 'p',
      description: 'New position (0-indexed)',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PhaseMove);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false  // Phases are workspace-scoped, no project selection needed
    );

    try {
      const phase = await storage.getPhase(args.id);
      if (!phase) {
        await storage.close();
        this.error(`Phase "${args.id}" not found.`);
      }

      const updated = await storage.reorderPhase(args.id, flags.position);

      await storage.close();

      this.log(styles.success(`\nMoved phase "${updated.name}" to position ${updated.position}`));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
