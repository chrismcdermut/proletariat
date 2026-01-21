import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
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

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket template delete', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const template = await this.storage.getTicketTemplate(args.id);
    if (!template) {
      return handleError('TEMPLATE_NOT_FOUND', `Template "${args.id}" not found.\nRun 'prlt ticket template list' to see available templates.`);
    }

    if (template.isBuiltin) {
      return handleError('CANNOT_DELETE_BUILTIN', 'Cannot delete built-in templates.');
    }

    if (!flags.force) {
      const confirmChoices = [
        { id: 'no', name: 'No, cancel' },
        { id: 'yes', name: `Yes, delete "${template.name}"` },
      ];

      const confirm = await this.selectFromList({
        message: `Delete template "${template.name}"?`,
        items: confirmChoices,
        getName: (c) => c.name,
        getValue: (c) => c.id,
        getCommand: (c) => c.id === 'yes' ? `prlt ticket template delete ${args.id} --force` : '',
        jsonMode: jsonMode ? { flags, commandName: 'ticket template delete' } : null,
      });

      if (confirm !== 'yes') {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    await this.storage.deleteTicketTemplate(args.id);

    this.log(styles.success(`\nDeleted template "${template.name}"`));
  }
}
