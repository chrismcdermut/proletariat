import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { shouldOutputJson } from '../../../lib/prompt-json.js';
import { styles } from '../../../lib/styles.js';

export default class LabelGroupList extends PMOCommand {
  static description = 'List label groups';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(LabelGroupList);

    const groups = await this.storage.listLabelGroups();

    if (shouldOutputJson(flags)) {
      this.log(JSON.stringify(groups, null, 2));
      return;
    }

    if (groups.length === 0) {
      this.log(styles.muted('\nNo label groups found.'));
      this.log(styles.muted('Create one: prlt label group create <name>'));
      return;
    }

    this.log(`\n${styles.emphasis('Label Groups')}`);
    this.log('═'.repeat(60));

    for (const group of groups) {
      const exclusive = group.isExclusive ? 'exclusive' : 'non-exclusive';
      const required = group.isRequired ? ', required' : '';
      this.log(`\n  ${styles.emphasis(group.name)} ${styles.muted(`(${group.id})`)}`);
      this.log(`    ${styles.muted(`${exclusive}${required}`)}`);
      if (group.description) {
        this.log(`    ${styles.muted(group.description)}`);
      }

      // Show labels in this group
      const labels = await this.storage.listLabels({ groupId: group.id });
      if (labels.length > 0) {
        const labelNames = labels.map(l => l.name).join(', ');
        this.log(`    Labels: ${labelNames}`);
      }
    }

    this.log('');
  }
}
