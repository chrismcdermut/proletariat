import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { shouldOutputJson, outputErrorAsJson, outputSuccessAsJson, createMetadata } from '../../lib/prompt-json.js';

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
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionShow);
    const jsonMode = shouldOutputJson(flags);

    const action = await this.storage.getAction(args.id);

    if (!action) {
      if (jsonMode) {
        outputErrorAsJson('ACTION_NOT_FOUND', `Action not found: ${args.id}`, createMetadata('action show', flags));
      }
      this.error(`Action not found: ${args.id}`);
    }

    if (jsonMode) {
      outputSuccessAsJson({ ...action }, createMetadata('action show', flags));
      return;
    }

    this.log(`\n${styles.emphasis(`Action: ${action.name}`)} ${styles.muted(`(${action.id})`)}`);
    this.log('');

    if (action.description) {
      this.log(`${styles.muted('Description:')} ${action.description}`);
    }

    if (action.fromState) {
      this.log(`${styles.muted('From state:')} ${action.fromState}`);
    } else {
      this.log(`${styles.muted('From state:')} (any)`);
    }

    if (action.toState) {
      this.log(`${styles.muted('To state:')} ${action.toState}`);
    }

    if (action.executor) {
      this.log(`${styles.muted('Executor:')} ${action.executor}`);
    }

    if (action.environment) {
      this.log(`${styles.muted('Environment:')} ${action.environment}`);
    }

    if (action.permissionMode) {
      this.log(`${styles.muted('Permission mode:')} ${action.permissionMode}`);
    }

    if (action.model) {
      this.log(`${styles.muted('Model:')} ${action.model}`);
    }

    if (action.timeout) {
      this.log(`${styles.muted('Timeout:')} ${action.timeout}s`);
    }

    this.log(`${styles.muted('Modifies code:')} ${action.modifiesCode ? 'Yes' : 'No'}`);
    this.log(`${styles.muted('Default:')} ${action.isDefault ? 'Yes' : 'No'}`);
    this.log(`${styles.muted('Built-in:')} ${action.isBuiltin ? 'Yes' : 'No'}`);

    this.log('');
    this.log(styles.muted('Prompt:'));
    this.log('─'.repeat(40));
    this.log(action.prompt);
    this.log('─'.repeat(40));
    this.log('');
  }
}
