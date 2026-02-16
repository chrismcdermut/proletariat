import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import type { Label } from '../../lib/pmo/types.js';

export default class LabelList extends PMOCommand {
  static description = 'List labels, optionally filtered by group';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --group function',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...pmoBaseFlags,
    group: Flags.string({
      char: 'g',
      description: 'Filter by group ID',
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(LabelList);

    const labels = await this.storage.listLabels({
      groupId: flags.group,
    });

    if (flags.json || flags.machine) {
      this.log(JSON.stringify(labels, null, 2));
      return;
    }

    if (labels.length === 0) {
      this.log(styles.muted('\nNo labels found.'));
      this.log(styles.muted('Create one: prlt label create <name>'));
      return;
    }

    this.log(`\n${styles.emphasis('Labels')}`);
    this.log('═'.repeat(60));

    // Group labels by group
    const grouped = new Map<string, Label[]>();
    const ungrouped: Label[] = [];

    for (const label of labels) {
      if (label.groupName) {
        const group = grouped.get(label.groupName) || [];
        group.push(label);
        grouped.set(label.groupName, group);
      } else {
        ungrouped.push(label);
      }
    }

    for (const [groupName, groupLabels] of grouped) {
      // Look up group info
      const group = await this.storage.getLabelGroupByName(groupName);
      const exclusive = group?.isExclusive ? ' (exclusive)' : '';
      const required = group?.isRequired ? ' (required)' : '';
      this.log(`\n${styles.emphasis(groupName)}${styles.muted(exclusive + required)}`);
      this.log('─'.repeat(40));
      for (const label of groupLabels) {
        this.printLabel(label);
      }
    }

    if (ungrouped.length > 0) {
      this.log(`\n${styles.emphasis('Ungrouped')}`);
      this.log('─'.repeat(40));
      for (const label of ungrouped) {
        this.printLabel(label);
      }
    }

    this.log('');
  }

  private printLabel(label: Label): void {
    const colorDot = label.color ? `${label.color} ` : '';
    const builtinBadge = label.isBuiltin ? '' : ' [custom]';
    this.log(`  ${colorDot}${styles.emphasis(label.name)} ${styles.muted(`(${label.id})`)}${builtinBadge}`);
    if (label.description) {
      this.log(`    ${styles.muted(label.description)}`);
    }
  }
}
