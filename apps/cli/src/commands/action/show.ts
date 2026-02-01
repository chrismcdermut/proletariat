import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class ActionShow extends PMOCommand {
  static description = 'Show details of a work action';

  static examples = [
    '<%= config.bin %> <%= command.id %> groom',
    '<%= config.bin %> <%= command.id %> implement',
  ];

  static args = {
    id: Args.string({
      description: 'Action ID to show',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output action details as JSON',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionShow);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('action show', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const action = await this.storage.getAction(args.id);

    if (!action) {
      return handleError('ACTION_NOT_FOUND', `Action not found: ${args.id}`);
    }

    // JSON mode: output action details as JSON
    if (jsonMode) {
      this.log(JSON.stringify(action, null, 2));
      return;
    }

    this.log(`\n${styles.emphasis(`Action: ${action.name}`)} ${styles.muted(`(${action.id})`)}`);
    this.log('');

    if (action.description) {
      this.log(`${styles.muted('Description:')} ${action.description}`);
    }

    if (action.suggestedForCategories?.length) {
      this.log(`${styles.muted('Suggested for:')} ${action.suggestedForCategories.join(', ')}`);
    }

    if (action.defaultMoveToCategory) {
      this.log(`${styles.muted('Moves to:')} ${action.defaultMoveToCategory}`);
    }

    this.log(`${styles.muted('Built-in:')} ${action.isBuiltin ? 'Yes' : 'No'}`);

    this.log('');
    this.log(styles.muted('Prompt:'));
    this.log('─'.repeat(40));
    this.log(action.prompt);
    this.log('─'.repeat(40));
    this.log('');
  }
}
