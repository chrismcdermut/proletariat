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
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
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
      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        const confirmChoices = [
          { name: 'No', value: 'false' },
          { name: 'Yes', value: 'true' },
        ];
        outputPromptAsJson(
          buildPromptConfig('list', 'confirm', `Delete template "${template.name}"?`, confirmChoices),
          createMetadata('ticket template delete', flags)
        );
        return;
      }

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
