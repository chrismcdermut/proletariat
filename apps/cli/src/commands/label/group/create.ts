import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { shouldOutputJson } from '../../../lib/prompt-json.js';
import { styles } from '../../../lib/styles.js';

export default class LabelGroupCreate extends PMOCommand {
  static description = 'Create a new label group';

  static examples = [
    '<%= config.bin %> <%= command.id %> Priority',
    '<%= config.bin %> <%= command.id %> Severity --exclusive --required',
    '<%= config.bin %> <%= command.id %> Tags --no-exclusive --description "Free-form tags"',
  ];

  static args = {
    name: Args.string({
      description: 'Group name',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    description: Flags.string({
      char: 'd',
      description: 'Group description',
    }),
    exclusive: Flags.boolean({
      description: 'Only one label from this group per ticket (default: true)',
      default: true,
      allowNo: true,
    }),
    required: Flags.boolean({
      description: 'Must have one label from this group',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(LabelGroupCreate);

    const group = await this.storage.createLabelGroup({
      name: args.name,
      description: flags.description,
      isExclusive: flags.exclusive,
      isRequired: flags.required,
    });

    if (shouldOutputJson(flags)) {
      this.log(JSON.stringify(group, null, 2));
      return;
    }

    const exclusive = group.isExclusive ? 'exclusive' : 'non-exclusive';
    const required = group.isRequired ? ', required' : '';
    this.log(styles.success(`\nCreated label group: ${group.name} (${group.id})`));
    this.log(styles.muted(`  ${exclusive}${required}`));
    this.log('');
  }
}
