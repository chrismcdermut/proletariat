import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';
import { styles } from '../../lib/styles.js';

export default class LabelCreate extends PMOCommand {
  static description = 'Create a new label';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-label',
    '<%= config.bin %> <%= command.id %> urgent --color "#ff0000" --group type',
    '<%= config.bin %> <%= command.id %> frontend --group area --description "Frontend work"',
  ];

  static args = {
    name: Args.string({
      description: 'Label name',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    color: Flags.string({
      char: 'c',
      description: 'Label color (hex, e.g. #ff0000)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Label description',
    }),
    group: Flags.string({
      char: 'g',
      description: 'Label group ID to add this label to',
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(LabelCreate);

    const label = await this.storage.createLabel({
      name: args.name,
      color: flags.color,
      description: flags.description,
      groupId: flags.group,
    });

    if (shouldOutputJson(flags)) {
      this.log(JSON.stringify(label, null, 2));
      return;
    }

    this.log(styles.success(`\nCreated label: ${label.name} (${label.id})`));
    if (label.groupName) {
      this.log(styles.muted(`  Group: ${label.groupName}`));
    }
    if (label.color) {
      this.log(styles.muted(`  Color: ${label.color}`));
    }
    this.log('');
  }
}
