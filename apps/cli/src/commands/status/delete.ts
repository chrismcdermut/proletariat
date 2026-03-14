import { Flags, Args } from '@oclif/core';
import { PMOCommand, machineOutputFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';
import {
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

interface DeleteFlags {
  force?: boolean;
  confirm?: boolean;
  json?: boolean;
  machine?: boolean;
  [key: string]: unknown;
}

export default class StatusDelete extends PMOCommand {
  static description = 'Delete a workflow status';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project-blocked',
    '<%= config.bin %> <%= command.id %> my-project-review --force',
  ];

  static args = {
    id: Args.string({
      description: 'Status ID',
      required: true,
    }),
  };

  static flags = {
    ...machineOutputFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(StatusDelete);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('status delete', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get existing status
    const existing = await this.storage.getStatus(args.id);
    if (!existing) {
      return handleError('STATUS_NOT_FOUND', `Status not found: ${args.id}`);
    }

    // Confirm deletion if not forced
    if (!flags.force) {
      // Create FlagResolver for confirmation
      const resolver = new FlagResolver<DeleteFlags>({
        commandName: 'status delete',
        baseCommand: `prlt status delete ${args.id}`,
        jsonMode,
        flags: { ...flags, confirm: flags.force ? true : undefined },
        context: { statusId: args.id, existing },
      });

      // Add confirmation prompt (use list instead of confirm per CLAUDE.md guidelines)
      resolver.addPrompt({
        flagName: 'confirm',
        type: 'list',
        message: `Delete status "${existing.name}" (${existing.category})?`,
        choices: () => [
          { name: 'No, cancel', value: false, command: '' },
          { name: 'Yes, delete', value: true, command: `prlt status delete ${args.id} --force --machine` },
        ],
        when: (ctx) => ctx.flags.confirm === undefined,
      });

      const resolved = await resolver.resolve();

      if (!resolved.confirm) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    try {
      await this.storage.deleteStatus(args.id);
      this.log(styles.success(`Deleted status "${existing.name}"`));
    } catch (error) {
      if (error instanceof Error && error.message.includes('ticket(s) are using it')) {
        if (jsonMode) {
          outputErrorAsJson('STATUS_IN_USE', error.message + ' Move tickets to another status before deleting.', createMetadata('status delete', flags));
        }
        this.error(error.message + '\nMove tickets to another status before deleting.');
      }
      throw error;
    }
  }
}
