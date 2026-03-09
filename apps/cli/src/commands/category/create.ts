import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { CategoryType } from '../../lib/pmo/types.js';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';

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

    const resolver = new FlagResolver({
      commandName: 'category create',
      baseCommand: `prlt category create --type ${categoryType}`,
      jsonMode,
      flags: { ...flags, name: args.name },
      args,
    });

    resolver.addPrompt({
      flagName: 'name',
      type: 'input',
      message: `Enter ${categoryType} category name:`,
      validate: (value) => {
        const input = String(value);
        if (!input.trim()) return 'Category name is required';
        if (!/^[a-z][a-z0-9-]*$/.test(input.trim())) {
          return 'Category name must start with a letter and contain only lowercase letters, numbers, and hyphens';
        }
        return true;
      },
    });

    resolver.addPrompt({
      flagName: 'description',
      type: 'input',
      message: 'Description (optional):',
      when: (ctx) => ctx.flags.name !== undefined,
    });

    const resolved = await resolver.resolve();

    const name = resolved.name as string;
    const description = (resolved.description as string) || undefined;

    if (!name) {
      this.error('Category name is required');
    }

    // Validate name format
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      this.error('Category name must start with a letter and contain only lowercase letters, numbers, and hyphens');
    }

    try {
      const category = await this.storage.createCategory({
        name,
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
