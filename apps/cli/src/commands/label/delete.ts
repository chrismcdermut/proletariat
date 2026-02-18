import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';
import { styles } from '../../lib/styles.js';

export default class LabelDelete extends PMOCommand {
  static description = 'Delete a label (removes from all tickets)';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-label',
  ];

  static args = {
    id: Args.string({
      description: 'Label ID to delete',
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
    const { args, flags } = await this.parse(LabelDelete);

    await this.storage.deleteLabel(args.id);

    if (shouldOutputJson(flags)) {
      this.log(JSON.stringify({ success: true, deleted: args.id }));
      return;
    }

    this.log(styles.success(`\nDeleted label: ${args.id}`));
    this.log('');
  }
}
