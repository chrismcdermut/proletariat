import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { CategoryType } from '../../lib/pmo/types.js';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';

export default class CategoryRename extends PMOCommand {
  static description = 'Rename a category (custom categories only)';

  static examples = [
    '<%= config.bin %> <%= command.id %> --type ticket spike investigation',
    '<%= config.bin %> <%= command.id %> --type status reviewing in-review',
  ];

  static args = {
    oldName: Args.string({
      description: 'Current name of the category',
    }),
    newName: Args.string({
      description: 'New name for the category',
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    type: Flags.string({
      char: 't',
      description: 'Category type',
      options: ['ticket', 'status'],
      required: true,
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(CategoryRename);
    const categoryType = flags.type as CategoryType;
    const jsonMode = shouldOutputJson(flags);

    // Get custom categories for selection
    const customCategories = await this.storage.listCategories({ type: categoryType, isBuiltin: false });

    if (customCategories.length === 0) {
      this.log(styles.muted('\nNo custom categories to rename. Built-in categories cannot be renamed.'));
      return;
    }

    const resolver = new FlagResolver({
      commandName: 'category rename',
      baseCommand: `prlt category rename --type ${categoryType}`,
      jsonMode,
      flags: { ...flags, oldName: args.oldName, newName: args.newName },
      args,
    });

    resolver.addPrompt({
      flagName: 'oldName',
      type: 'list',
      message: 'Select category to rename:',
      choices: () => customCategories.map(c => ({
        name: c.name + (c.description ? ` - ${c.description}` : ''),
        value: c.name,
      })),
    });

    resolver.addPrompt({
      flagName: 'newName',
      type: 'input',
      message: (ctx) => `Enter new name for "${ctx.flags.oldName}":`,
      when: (ctx) => ctx.flags.oldName !== undefined,
      validate: (value) => {
        const input = String(value);
        if (!input.trim()) return 'New name is required';
        if (!/^[a-z][a-z0-9-]*$/.test(input.trim())) {
          return 'Category name must start with a letter and contain only lowercase letters, numbers, and hyphens';
        }
        return true;
      },
    });

    const resolved = await resolver.resolve();

    const oldName = resolved.oldName as string;
    const newName = resolved.newName as string;

    if (!oldName) {
      this.error('Old name is required');
    }
    if (!newName) {
      this.error('New name is required');
    }

    // Find the category
    const category = await this.storage.getCategoryByName(oldName, categoryType);
    if (!category) {
      this.error(`Category "${oldName}" not found for type "${categoryType}"`);
    }

    if (category.isBuiltin) {
      this.error(`Cannot rename built-in category "${oldName}"`);
    }

    // Validate new name format
    if (!/^[a-z][a-z0-9-]*$/.test(newName)) {
      this.error('Category name must start with a letter and contain only lowercase letters, numbers, and hyphens');
    }

    try {
      const updatedCategory = await this.storage.renameCategory(category.id, newName);
      this.log(`\n${styles.success(`Category renamed successfully!`)}`);
      this.log(`  Old name: ${oldName}`);
      this.log(`  New name: ${styles.emphasis(updatedCategory.name)}`);
      this.log('');
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
