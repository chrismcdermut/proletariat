import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class ActionDelete extends PMOCommand {
  static description = 'Delete a work action';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-custom-action',
    '<%= config.bin %> <%= command.id %> my-action --force',
  ];

  static args = {
    id: Args.string({
      description: 'Action ID to delete',
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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionDelete);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('action delete', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const action = await this.storage.getAction(args.id);

    if (!action) {
      return handleError('ACTION_NOT_FOUND', `Action not found: ${args.id}`);
    }

    if (action.isBuiltin) {
      return handleError('CANNOT_DELETE_BUILTIN', 'Cannot delete built-in actions');
    }

    if (!flags.force) {
      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        const confirmChoices = [
          { name: 'No', value: 'false' },
          { name: 'Yes', value: 'true' },
        ];
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', `Delete action "${action.name}"?`, confirmChoices),
          createMetadata('action delete', flags)
        );
        return;
      }

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Delete action "${action.name}"?`,
          default: false,
        },
      ]);

      if (!confirm) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    await this.storage.deleteAction(args.id);

    this.log(styles.success(`\nDeleted action "${action.name}"`));
  }
}
