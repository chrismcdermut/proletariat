import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { CategoryType } from '../../lib/pmo/types.js';
import { shouldOutputJson, outputPromptAsJson, buildPromptConfig, createMetadata, outputErrorAsJson, outputSuccessAsJson } from '../../lib/prompt-json.js';

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

    let oldName = args.oldName;
    let newName = args.newName;

    // Get custom categories for selection
    const customCategories = await this.storage.listCategories({ type: categoryType, isBuiltin: false });

    if (customCategories.length === 0) {
      this.log(styles.muted('\nNo custom categories to rename. Built-in categories cannot be renamed.'));
      return;
    }

    // Prompt for category if not provided
    if (!oldName) {
      const message = 'Select category to rename:';
      const choices = customCategories.map(c => ({
        name: c.name + (c.description ? ` - ${c.description}` : ''),
        value: c.name,
      }));

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'oldName', message, choices),
          createMetadata('category rename', flags)
        );
        return;
      }

      const result = await this.selectFromList({
        message,
        items: customCategories,
        getName: (c) => c.name + (c.description ? ` - ${c.description}` : ''),
        getValue: (c) => c.name,
        getCommand: (c) => `prlt category rename --type ${categoryType} ${c.name}`,
        allowCancel: true,
      });

      if (!result) {
        return;
      }
      oldName = result;
    }

    // Find the category
    const category = await this.storage.getCategoryByName(oldName, categoryType);
    if (!category) {
      if (jsonMode) {
        outputErrorAsJson('CATEGORY_NOT_FOUND', `Category "${oldName}" not found for type "${categoryType}"`, createMetadata('category rename', flags));
      }
      this.error(`Category "${oldName}" not found for type "${categoryType}"`);
    }

    if (category.isBuiltin) {
      if (jsonMode) {
        outputErrorAsJson('BUILTIN_CATEGORY', `Cannot rename built-in category "${oldName}"`, createMetadata('category rename', flags));
      }
      this.error(`Cannot rename built-in category "${oldName}"`);
    }

    // Prompt for new name if not provided
    if (!newName) {
      const message = `Enter new name for "${oldName}":`;

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('input', 'newName', message, []),
          createMetadata('category rename', { ...flags, oldName })
        );
        return;
      }

      const { categoryNewName } = await this.prompt<{ categoryNewName: string }>([{
        type: 'input',
        name: 'categoryNewName',
        message,
        validate: (input: unknown) => {
          if (!(input as string).trim()) return 'New name is required';
          if (!/^[a-z][a-z0-9-]*$/.test((input as string).trim())) {
            return 'Category name must start with a letter and contain only lowercase letters, numbers, and hyphens';
          }
          return true;
        },
      }], null);
      newName = categoryNewName;
    }

    // At this point newName and oldName should be defined
    if (!newName) {
      if (jsonMode) {
        outputErrorAsJson('NAME_REQUIRED', 'New name is required', createMetadata('category rename', flags));
      }
      this.error('New name is required');
    }
    if (!oldName) {
      if (jsonMode) {
        outputErrorAsJson('NAME_REQUIRED', 'Old name is required', createMetadata('category rename', flags));
      }
      this.error('Old name is required');
    }

    // Validate new name format
    if (!/^[a-z][a-z0-9-]*$/.test(newName)) {
      if (jsonMode) {
        outputErrorAsJson('INVALID_NAME', 'Category name must start with a letter and contain only lowercase letters, numbers, and hyphens', createMetadata('category rename', flags));
      }
      this.error('Category name must start with a letter and contain only lowercase letters, numbers, and hyphens');
    }

    try {
      const updatedCategory = await this.storage.renameCategory(category.id, newName);
      if (jsonMode) {
        outputSuccessAsJson({
          oldName,
          newName: updatedCategory.name,
          type: categoryType,
          message: 'Category renamed successfully!',
        }, createMetadata('category rename', flags));
        return;
      }

      this.log(`\n${styles.success(`Category renamed successfully!`)}`);
      this.log(`  Old name: ${oldName}`);
      this.log(`  New name: ${styles.emphasis(updatedCategory.name)}`);
      this.log('');
    } catch (error) {
      if (error instanceof Error) {
        if (jsonMode) {
          outputErrorAsJson('RENAME_FAILED', error.message, createMetadata('category rename', flags));
        }
        this.error(error.message);
      }
      throw error;
    }
  }
}
