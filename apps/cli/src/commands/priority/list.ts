import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { getWorkspacePriorities } from '../../lib/pmo/utils.js';
import { isMachineOutput } from '../../lib/prompt-json.js';

export default class PriorityList extends PMOCommand {
  static description = 'List the workspace priority scale';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(PriorityList);
    const db = this.storage.getDatabase();
    const priorities = getWorkspacePriorities(db);

    if (isMachineOutput(flags)) {
      this.log(JSON.stringify({ priorities }, null, 2));
      return;
    }

    this.log(`\n${styles.emphasis('Priority Scale')} (highest to lowest)`);
    this.log('─'.repeat(40));

    for (let i = 0; i < priorities.length; i++) {
      const marker = i === 0 ? '🔴' : i === 1 ? '🟠' : i === 2 ? '🟡' : '🟢';
      this.log(`  ${marker} ${priorities[i]}`);
    }

    this.log('');
    this.log(styles.muted('Manage: prlt priority set <values...>'));
    this.log(styles.muted('        prlt priority add <value>'));
    this.log(styles.muted('        prlt priority remove <value>'));
    this.log('');
  }
}
