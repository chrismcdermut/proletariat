import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Category, CategoryType } from '../../lib/pmo/types.js';

export default class CategoryList extends PMOCommand {
  static description = 'List categories for ticket or status types';

  static examples = [
    '<%= config.bin %> <%= command.id %> --type ticket',
    '<%= config.bin %> <%= command.id %> --type status',
    '<%= config.bin %> <%= command.id %> --type ticket --builtin',
    '<%= config.bin %> <%= command.id %> --type ticket --json',
  ];

  static flags = {
    ...pmoBaseFlags,
    type: Flags.string({
      char: 't',
      description: 'Category type to list',
      options: ['ticket', 'status'],
      required: true,
    }),
    builtin: Flags.boolean({
      description: 'Show only built-in categories',
      exclusive: ['custom'],
    }),
    custom: Flags.boolean({
      description: 'Show only custom categories',
      exclusive: ['builtin'],
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
    const { flags } = await this.parse(CategoryList);
    const categoryType = flags.type as CategoryType;

    const filter: { type: CategoryType; isBuiltin?: boolean } = { type: categoryType };
    if (flags.builtin) filter.isBuiltin = true;
    if (flags.custom) filter.isBuiltin = false;

    const categories = await this.storage.listCategories(filter);

    if (flags.json || flags.machine) {
      this.log(JSON.stringify(categories, null, 2));
      return;
    }

    if (categories.length === 0) {
      this.log(styles.muted(`\nNo ${categoryType} categories found.`));
      this.log(styles.muted(`Create one: prlt category create --type ${categoryType}`));
      return;
    }

    const typeLabel = categoryType === 'ticket' ? 'Ticket' : 'Status';
    this.log(`\n📁 ${styles.emphasis(`${typeLabel} Categories`)}`);
    this.log('═'.repeat(60));

    // Group by builtin vs custom
    const builtinCategories = categories.filter(c => c.isBuiltin);
    const customCategories = categories.filter(c => !c.isBuiltin);

    if (builtinCategories.length > 0 && !flags.custom) {
      this.log(`\n${styles.emphasis('Built-in Categories')}`);
      this.log('─'.repeat(40));
      for (const category of builtinCategories) {
        this.printCategory(category);
      }
    }

    if (customCategories.length > 0 && !flags.builtin) {
      this.log(`\n${styles.emphasis('Custom Categories')}`);
      this.log('─'.repeat(40));
      for (const category of customCategories) {
        this.printCategory(category);
      }
    }

    this.log('');
    this.log(styles.muted(`Create new: prlt category create --type ${categoryType} <name>`));
    this.log('');
  }

  private printCategory(category: Category): void {
    const builtinBadge = category.isBuiltin ? '' : ' [custom]';
    this.log(`  ${styles.emphasis(category.name)} ${styles.muted(`(${category.id})`)}${builtinBadge}`);
    if (category.description) {
      this.log(`    ${styles.muted(category.description)}`);
    }
  }
}
