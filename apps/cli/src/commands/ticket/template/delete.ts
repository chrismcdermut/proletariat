import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../../lib/prompt-json.js';

export default class TicketTemplateDelete extends PMOCommand {
  static description = 'Delete a ticket template';

  static examples = [
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
    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket template delete', flags));
        return
      }
      this.error(message);
    };

    const template = await this.storage.getTicketTemplate(args.id);
    if (!template) {
      return handleError('NOT_FOUND', `Ticket template not found: ${args.id}`);
    }

    if (template.isBuiltin) {
      return handleError('BUILTIN', `Cannot delete built-in template "${template.name}".`);
    }

    if (!flags.force) {
      const { confirm } = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: `Delete ticket template "${template.name}"?`,
        choices: [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
      }], jsonMode ? { flags, commandName: 'ticket template delete' } : null);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    await this.storage.deleteTicketTemplate(args.id);
    this.log(styles.success(`\nDeleted template "${template.name}"`));
  }
}
