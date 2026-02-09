import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { CategoryType } from '../../lib/pmo/types.js';
import { shouldOutputJson, outputPromptAsJson, buildPromptConfig, createMetadata } from '../../lib/prompt-json.js';

export default class CategoryCreate extends PMOCommand {
  static description = 'Create a new category';

  static examples = [
    '<%= config.bin %> <%= command.id %> --type ticket spike',
    '<%= config.bin %> <%= command.id %> --type ticket spike --description "Research or investigation task"',
    '<%= config.bin %> <%= command.id %> --type status reviewing',
  ];

  static args = {
    name: Args.string({
      description: 'Name of the new category',
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
    description: Flags.string({
      char: 'd',
      description: 'Description of the category',
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
    const { args, flags } = await this.parse(CategoryCreate);
    const categoryType = flags.type as CategoryType;
    const jsonMode = shouldOutputJson(flags);

    let name = args.name;
    let description = flags.description;

    // Prompt for name if not provided
    if (!name) {
      const message = `Enter ${categoryType} category name:`;
      const choices = [
        { name: 'Enter category name', value: 'input' },
      ];

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('input', 'name', message, choices),
          createMetadata('category create', flags)
        );
        return;
      }

      const { categoryName } = await this.prompt<{ categoryName: string }>([{
        type: 'input',
        name: 'categoryName',
        message,
        validate: (input: unknown) => {
          if (!(input as string).trim()) return 'Category name is required';
          if (!/^[a-z][a-z0-9-]*$/.test((input as string).trim())) {
            return 'Category name must start with a letter and contain only lowercase letters, numbers, and hyphens';
          }
          return true;
        },
      }], null);
      name = categoryName;
    }

    // At this point name should be defined
    if (!name) {
      this.error('Category name is required');
    }

    // Validate name format
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      this.error('Category name must start with a letter and contain only lowercase letters, numbers, and hyphens');
    }

    // Prompt for description if not provided
    if (!description && !jsonMode) {
      const { categoryDescription } = await this.prompt<{ categoryDescription: string }>([{
        type: 'input',
        name: 'categoryDescription',
        message: 'Description (optional):',
      }], null);
      description = categoryDescription || undefined;
    }

    try {
      const category = await this.storage.createCategory({
        name: name,
        type: categoryType,
        description,
      });

      this.log(`\n${styles.success('Category created successfully!')}`);
      this.log(`  Name: ${styles.emphasis(category.name)}`);
      this.log(`  Type: ${category.type}`);
      this.log(`  ID: ${category.id}`);
      if (category.description) {
        this.log(`  Description: ${category.description}`);
      }
      this.log('');
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
