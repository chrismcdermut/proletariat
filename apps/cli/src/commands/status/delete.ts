import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
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

    // Confirm deletion
    if (!flags.force) {
      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('confirm', 'confirm', `Delete status "${existing.name}" (${existing.category})?`),
          createMetadata('status delete', flags)
        );
        return;
      }

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Delete status "${existing.name}" (${existing.category})?`,
          default: false,
        },
      ]);

      if (!confirm) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    try {
      await this.storage.deleteStatus(args.id);
      this.log(styles.success(`Deleted status "${existing.name}"`));
    } catch (error) {
      if (error instanceof Error && error.message.includes('ticket(s) are using it')) {
        this.error(error.message + '\nMove tickets to another status before deleting.');
      }
      throw error;
    }
  }
}
