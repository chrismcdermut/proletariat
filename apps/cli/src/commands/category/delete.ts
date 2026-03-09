import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { CategoryType } from '../../lib/pmo/types.js';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';

export default class CategoryDelete extends PMOCommand {
  static description = 'Delete a category (custom categories only)';

  static examples = [
    '<%= config.bin %> <%= command.id %> --type ticket spike',
    '<%= config.bin %> <%= command.id %> --type status reviewing',
  ];

  static args = {
    name: Args.string({
      description: 'Name of the category to delete',
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
    const { args, flags } = await this.parse(CategoryDelete);
    const categoryType = flags.type as CategoryType;
    const jsonMode = shouldOutputJson(flags);

    // Get custom categories for selection
    const customCategories = await this.storage.listCategories({ type: categoryType, isBuiltin: false });

    if (customCategories.length === 0) {
      this.log(styles.muted('\nNo custom categories to delete. Built-in categories cannot be deleted.'));
      return;
    }

    const resolver = new FlagResolver({
      commandName: 'category delete',
      baseCommand: `prlt category delete --type ${categoryType}`,
      jsonMode,
      flags: { ...flags, name: args.name },
      args,
    });

    resolver.addPrompt({
      flagName: 'name',
      type: 'list',
      message: 'Select category to delete:',
      choices: () => customCategories.map(c => ({
        name: c.name + (c.description ? ` - ${c.description}` : ''),
        value: c.name,
      })),
    });

    resolver.addPrompt({
      flagName: 'confirmed',
      type: 'list',
      message: (ctx) => `Are you sure you want to delete category "${ctx.flags.name}"?`,
      choices: () => [
        { name: 'Yes, delete it', value: 'yes' },
        { name: 'No, cancel', value: 'no' },
      ],
      when: (ctx) => ctx.flags.name !== undefined,
    });

    const resolved = await resolver.resolve();

    const name = (resolved as Record<string, unknown>).name as string;
    const confirmed = (resolved as Record<string, unknown>).confirmed as string;

    if (confirmed === 'no') {
      this.log(styles.muted('Deletion cancelled.'));
      return;
    }

    // Find the category
    const category = await this.storage.getCategoryByName(name, categoryType);
    if (!category) {
      this.error(`Category "${name}" not found for type "${categoryType}"`);
    }

    if (category.isBuiltin) {
      this.error(`Cannot delete built-in category "${name}"`);
    }

    try {
      await this.storage.deleteCategory(category.id);
      this.log(`\n${styles.success(`Category "${name}" deleted successfully.`)}`);
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
