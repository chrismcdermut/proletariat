import { Command, Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class TicketTemplateDelete extends Command {
  static description = 'Delete a ticket template';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-template',
    '<%= config.bin %> <%= command.id %> my-template --force',
  ];

  static args = {
    id: Args.string({
      description: 'Template ID to delete',
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
    const { args, flags } = await this.parse(TicketTemplateDelete);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false
    );

    try {
      const template = await storage.getTicketTemplate(args.id);
      if (!template) {
        await storage.close();
        this.error(`Template "${args.id}" not found.\nRun 'prlt ticket template list' to see available templates.`);
      }

      if (template.isBuiltin) {
        await storage.close();
        this.error('Cannot delete built-in templates.');
      }

      if (!flags.force) {
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
          type: 'confirm',
          name: 'confirm',
          message: `Delete template "${template.name}"?`,
          default: false,
        }]);

        if (!confirm) {
          await storage.close();
          this.log(styles.muted('Cancelled.'));
          return;
        }
      }

      await storage.deleteTicketTemplate(args.id);

      await storage.close();

      this.log(styles.success(`\nDeleted template "${template.name}"`));
    } catch (error) {
      await storage.close();
      if (error instanceof Error && error.message.includes('Cannot delete')) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
