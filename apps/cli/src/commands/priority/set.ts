import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { getWorkspacePriorities, setWorkspacePriorities } from '../../lib/pmo/utils.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class PrioritySet extends PMOCommand {
  static description = 'Set the workspace priority scale (replaces all existing priorities)';

  static examples = [
    '<%= config.bin %> <%= command.id %> P0 P1 P2 P3',
    '<%= config.bin %> <%= command.id %> Critical High Medium Low',
    '<%= config.bin %> <%= command.id %> Now Next Later',
    '<%= config.bin %> <%= command.id %> "Must Have" "Should Have" "Nice to Have"',
  ];

  static strict = false;

  static args = {
    priorities: Args.string({
      description: 'Priority values from highest to lowest (space-separated)',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { flags, argv } = await this.parse(PrioritySet);
    const jsonMode = shouldOutputJson(flags);
    const db = this.storage.getDatabase();

    // argv contains all the non-flag arguments
    const newPriorities = (argv as string[]).filter(a => a.trim());

    if (newPriorities.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_PRIORITIES', 'At least one priority value is required', createMetadata('priority set', flags));
        return
      }
      this.error('At least one priority value is required.\n\nUsage: prlt priority set <value1> <value2> ...\nExample: prlt priority set P0 P1 P2 P3');
    }

    // Check for duplicates
    const seen = new Set<string>();
    for (const p of newPriorities) {
      if (seen.has(p)) {
        if (jsonMode) {
          outputErrorAsJson('DUPLICATE_PRIORITY', `Duplicate priority value: "${p}"`, createMetadata('priority set', flags));
          return
        }
        this.error(`Duplicate priority value: "${p}". Each priority must be unique.`);
      }
      seen.add(p);
    }

    const oldPriorities = getWorkspacePriorities(db);
    setWorkspacePriorities(db, newPriorities);

    if (jsonMode) {
      this.log(JSON.stringify({ success: true, priorities: newPriorities }, null, 2));
      return;
    }

    this.log(styles.success(`\n✅ Priority scale updated`));
    this.log(styles.muted(`   Before: ${oldPriorities.join(', ')}`));
    this.log(styles.muted(`   After:  ${newPriorities.join(', ')}`));
    this.log('');
  }
}
