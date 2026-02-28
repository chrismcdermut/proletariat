import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { getWorkspacePriorities, setWorkspacePriorities } from '../../lib/pmo/utils.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class PriorityRemove extends PMOCommand {
  static description = 'Remove a priority value from the workspace scale';

  static examples = [
    '<%= config.bin %> <%= command.id %> P3',
    '<%= config.bin %> <%= command.id %> Low',
  ];

  static args = {
    value: Args.string({
      description: 'Priority value to remove',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PriorityRemove);
    const jsonMode = shouldOutputJson(flags);
    const db = this.storage.getDatabase();
    const priorities = getWorkspacePriorities(db);

    // Check that the priority exists
    if (!priorities.includes(args.value)) {
      if (jsonMode) {
        outputErrorAsJson('PRIORITY_NOT_FOUND', `Priority "${args.value}" not found`, createMetadata('priority remove', flags));
        this.exit(1);
      }
      this.error(`Priority "${args.value}" not found in the scale: ${priorities.join(', ')}`);
    }

    // Must keep at least one priority
    if (priorities.length <= 1) {
      if (jsonMode) {
        outputErrorAsJson('MIN_PRIORITIES', 'Cannot remove the last priority. Use "prlt priority set" to replace the scale.', createMetadata('priority remove', flags));
        this.exit(1);
      }
      this.error('Cannot remove the last priority. Use "prlt priority set" to replace the scale.');
    }

    const newPriorities = priorities.filter(p => p !== args.value);
    setWorkspacePriorities(db, newPriorities);

    if (jsonMode) {
      this.log(JSON.stringify({ success: true, priorities: newPriorities, removed: args.value }, null, 2));
      return;
    }

    this.log(styles.success(`\n✅ Removed priority "${args.value}"`));
    this.log(styles.muted(`   Scale: ${newPriorities.join(', ')}`));
    this.log(styles.muted('\n   Note: Existing tickets with this priority are not affected.'));
    this.log(styles.muted('   You may want to update them manually.'));
    this.log('');
  }
}
