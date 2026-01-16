import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, WorkAction } from '../../lib/pmo/types.js';

export default class ActionList extends PMOCommand {
  static description = 'List available work actions';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --builtin',
    '<%= config.bin %> <%= command.id %> --custom',
    '<%= config.bin %> <%= command.id %> --suggested-for started',
  ];

  static flags = {
    ...pmoBaseFlags,
    builtin: Flags.boolean({
      description: 'Show only built-in actions',
      exclusive: ['custom'],
    }),
    custom: Flags.boolean({
      description: 'Show only custom actions',
      exclusive: ['builtin'],
    }),
    'suggested-for': Flags.string({
      description: 'Filter to actions suggested for a category',
      options: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(ActionList);

    const filter: { isBuiltin?: boolean; suggestedFor?: StateCategory } = {};
    if (flags.builtin) filter.isBuiltin = true;
    if (flags.custom) filter.isBuiltin = false;
    if (flags['suggested-for']) filter.suggestedFor = flags['suggested-for'] as StateCategory;

    const actions = await this.storage.listActions(filter);

    if (flags.json) {
      this.log(JSON.stringify(actions, null, 2));
      return;
    }

    if (actions.length === 0) {
      this.log(styles.muted('\nNo actions found.'));
      return;
    }

    this.log(`\n${styles.emphasis('Work Actions')}`);
    this.log('═'.repeat(60));

    // Group by builtin vs custom
    const builtinActions = actions.filter(a => a.isBuiltin);
    const customActions = actions.filter(a => !a.isBuiltin);

    if (builtinActions.length > 0 && !flags.custom) {
      this.log(`\n${styles.emphasis('Built-in Actions')}`);
      this.log('─'.repeat(40));
      for (const action of builtinActions) {
        this.printAction(action);
      }
    }

    if (customActions.length > 0 && !flags.builtin) {
      this.log(`\n${styles.emphasis('Custom Actions')}`);
      this.log('─'.repeat(40));
      for (const action of customActions) {
        this.printAction(action);
      }
    }

    this.log('');
    this.log(styles.muted('Use an action: prlt work start TKT-001 --action <id>'));
    this.log(styles.muted('View details:  prlt action show <id>'));
    this.log('');
  }

  private printAction(action: WorkAction): void {
    this.log(`\n  ${styles.emphasis(action.name)} ${styles.muted(`(${action.id})`)}`);
    if (action.description) {
      this.log(`    ${styles.muted(action.description)}`);
    }

    const details: string[] = [];
    if (action.suggestedForCategories?.length) {
      details.push(`Suggested for: ${action.suggestedForCategories.join(', ')}`);
    }
    if (action.defaultMoveToCategory) {
      details.push(`Moves to: ${action.defaultMoveToCategory}`);
    }
    if (details.length > 0) {
      this.log(`    ${styles.muted(details.join(' | '))}`);
    }
  }
}
