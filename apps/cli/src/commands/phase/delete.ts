import { Command, Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class PhaseDelete extends Command {
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
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PhaseDelete);

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

      if (!flags.force) {
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
          type: 'confirm',
          name: 'confirm',
          message: `Delete phase "${phase.name}"?`,
          default: false,
        }]);

        if (!confirm) {
          this.log(styles.muted('Cancelled.'));
          await storage.close();
          return;
        }
      }

      await storage.deletePhase(args.id);

      await storage.close();

      this.log(styles.success(`\nDeleted phase "${phase.name}"`));
    } catch (error) {
      await storage.close();
      if (error instanceof Error && error.message.includes('are using it')) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
