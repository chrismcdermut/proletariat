import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { CategoryType } from '../../lib/pmo/types.js';
import { shouldOutputJson, outputPromptAsJson, buildPromptConfig, createMetadata } from '../../lib/prompt-json.js';

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

    let name = args.name;

    // Get custom categories for selection
    const customCategories = await this.storage.listCategories({ type: categoryType, isBuiltin: false });

    if (customCategories.length === 0) {
      this.log(styles.muted('\nNo custom categories to delete. Built-in categories cannot be deleted.'));
      return;
    }

    // Prompt for category if not provided
    if (!name) {
      const message = 'Select category to delete:';
      const choices = customCategories.map(c => ({
        name: c.name + (c.description ? ` - ${c.description}` : ''),
        value: c.name,
      }));

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'name', message, choices),
          createMetadata('category delete', flags)
        );
        return;
      }

      const result = await this.selectFromList({
        message,
        items: customCategories,
        getName: (c) => c.name + (c.description ? ` - ${c.description}` : ''),
        getValue: (c) => c.name,
        getCommand: (c) => `prlt category delete --type ${categoryType} ${c.name}`,
        allowCancel: true,
      });

      if (!result) {
        return;
      }
      name = result;
    }

    // Find the category
    const category = await this.storage.getCategoryByName(name, categoryType);
    if (!category) {
      this.error(`Category "${name}" not found for type "${categoryType}"`);
    }

    if (category.isBuiltin) {
      this.error(`Cannot delete built-in category "${name}"`);
    }

    // Confirm deletion
    if (!jsonMode) {
      const { confirmed } = await this.prompt<{ confirmed: boolean }>([{
        type: 'list',
        name: 'confirmed',
        message: `Are you sure you want to delete category "${name}"?`,
        choices: [
          { name: 'Yes, delete it', value: true },
          { name: 'No, cancel', value: false },
        ],
      }], null);

      if (!confirmed) {
        this.log(styles.muted('Deletion cancelled.'));
        return;
      }
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
