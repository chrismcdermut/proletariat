import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class TicketTemplateDelete extends PMOCommand {
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
    const { args, flags } = await this.parse(TicketTemplateDelete);

    const template = await this.storage.getTicketTemplate(args.id);
    if (!template) {
      this.error(`Template "${args.id}" not found.\nRun 'prlt ticket template list' to see available templates.`);
    }

    if (template.isBuiltin) {
      this.error('Cannot delete built-in templates.');
    }

    if (!flags.force) {
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: `Delete template "${template.name}"?`,
        choices: [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
      }]);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    await this.storage.deleteTicketTemplate(args.id);

    this.log(styles.success(`\nDeleted template "${template.name}"`));
  }
}
