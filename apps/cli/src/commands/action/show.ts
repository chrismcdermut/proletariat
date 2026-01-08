import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

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
    const { args } = await this.parse(ActionShow);

    const action = await this.storage.getAction(args.id);

    if (!action) {
      this.error(`Action not found: ${args.id}`);
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
