import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { getWorkspacePriorities, setWorkspacePriorities } from '../../lib/pmo/utils.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class PriorityAdd extends PMOCommand {
  static description = 'Add a priority value to the workspace scale';

  static examples = [
    '<%= config.bin %> <%= command.id %> Critical',
    '<%= config.bin %> <%= command.id %> "Must Have" --position 0',
    '<%= config.bin %> <%= command.id %> P4 --after P3',
  ];

  static args = {
    value: Args.string({
      description: 'Priority value to add',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    position: Flags.integer({
      description: 'Position in the priority scale (0 = highest)',
    }),
    after: Flags.string({
      description: 'Insert after this priority value',
      exclusive: ['position'],
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PriorityAdd);
    const jsonMode = shouldOutputJson(flags);
    const db = this.storage.getDatabase();
    const priorities = getWorkspacePriorities(db);

    // Check for duplicates
    if (priorities.includes(args.value)) {
      if (jsonMode) {
        outputErrorAsJson('DUPLICATE_PRIORITY', `Priority "${args.value}" already exists`, createMetadata('priority add', flags));
        this.exit(1);
      }
      this.error(`Priority "${args.value}" already exists in the scale: ${priorities.join(', ')}`);
    }

    // Determine insertion position
    let insertAt = priorities.length; // Default: append to end (lowest priority)

    if (flags.position !== undefined) {
      insertAt = Math.max(0, Math.min(flags.position, priorities.length));
    } else if (flags.after) {
      const afterIndex = priorities.indexOf(flags.after);
      if (afterIndex === -1) {
        if (jsonMode) {
          outputErrorAsJson('PRIORITY_NOT_FOUND', `Priority "${flags.after}" not found`, createMetadata('priority add', flags));
          this.exit(1);
        }
        this.error(`Priority "${flags.after}" not found in the scale: ${priorities.join(', ')}`);
      }
      insertAt = afterIndex + 1;
    }

    // Insert at position
    const newPriorities = [...priorities];
    newPriorities.splice(insertAt, 0, args.value);
    setWorkspacePriorities(db, newPriorities);

    if (jsonMode) {
      this.log(JSON.stringify({ success: true, priorities: newPriorities }, null, 2));
      return;
    }

    this.log(styles.success(`\n✅ Added priority "${args.value}" at position ${insertAt}`));
    this.log(styles.muted(`   Scale: ${newPriorities.join(', ')}`));
    this.log('');
  }
}
