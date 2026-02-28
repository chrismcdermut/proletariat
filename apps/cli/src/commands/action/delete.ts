import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

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
      // Use FlagResolver for confirmation prompt - works in both JSON and interactive modes
      const resolver = new FlagResolver<{ confirmed?: boolean }>({
        commandName: 'action delete',
        baseCommand: `prlt action delete ${args.id}`,
        jsonMode,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'confirmed',
        type: 'list',
        message: `Delete action "${action.name}"?`,
        choices: () => [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
        getCommand: (value) => value
          ? `prlt action delete ${args.id} --force --json`
          : '',
      });

      const resolved = await resolver.resolve();

      if (!resolved.confirmed) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    await this.storage.deleteAction(args.id);

    this.log(styles.success(`\nDeleted action "${action.name}"`));
  }
}
