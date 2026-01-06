import { Command, Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';

export default class StatusUpdate extends Command {
  static description = 'Update a workflow status';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project-in-review --name "Code Review"',
    '<%= config.bin %> <%= command.id %> my-project-blocked --color "#EF4444"',
    '<%= config.bin %> <%= command.id %> my-project-todo --default  # Set as default',
  ];

  static args = {
    id: Args.string({
      description: 'Status ID',
      required: true,
    }),
  };

  static flags = {
    name: Flags.string({
      char: 'n',
      description: 'New status name',
    }),
    category: Flags.string({
      char: 'c',
      description: 'New category',
      options: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
    }),
    color: Flags.string({
      description: 'Hex color code (e.g., #FF0000)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Status description',
    }),
    default: Flags.boolean({
      description: 'Set as default status for new tickets',
      allowNo: true,
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(StatusUpdate);

    // Get storage without project context since we're using status ID directly
    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Get existing status
      const existing = await storage.getStatus(args.id);
      if (!existing) {
        await storage.close();
        this.error(`Status not found: ${args.id}`);
      }

      let changes: Partial<{
        name: string;
        category: StateCategory;
        color: string;
        description: string;
        isDefault: boolean;
      }>;

      if (flags.interactive) {
        changes = await this.promptChanges(existing);
      } else {
        changes = {};
        if (flags.name !== undefined) changes.name = flags.name;
        if (flags.category !== undefined) changes.category = flags.category as StateCategory;
        if (flags.color !== undefined) changes.color = flags.color;
        if (flags.description !== undefined) changes.description = flags.description;
        if (flags.default !== undefined) changes.isDefault = flags.default;

        if (Object.keys(changes).length === 0) {
          await storage.close();
          this.error('No changes specified. Use flags like --name, --category, --color, or -i for interactive mode.');
        }
      }

      const updated = await storage.updateStatus(args.id, changes);

      await storage.close();

      this.log(styles.success(`\nUpdated status "${styles.emphasis(updated.name)}"`));
      this.log(styles.muted(`  ID: ${updated.id}`));
      this.log(styles.muted(`  Category: ${updated.category}`));
      if (updated.color) {
        this.log(styles.muted(`  Color: ${updated.color}`));
      }
      if (updated.isDefault) {
        this.log(styles.muted(`  Default: yes`));
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private async promptChanges(existing: {
    name: string;
    category: StateCategory;
    color?: string;
    description?: string;
    isDefault?: boolean;
  }): Promise<Partial<{
    name: string;
    category: StateCategory;
    color: string;
    description: string;
    isDefault: boolean;
  }>> {
    const answers = await inquirer.prompt<{
      name: string;
      category: StateCategory;
      color: string;
      description: string;
      isDefault: boolean;
    }>([
      {
        type: 'input',
        name: 'name',
        message: 'Status name:',
        default: existing.name,
        validate: (input: string) => input.length > 0 || 'Name is required',
      },
      {
        type: 'list',
        name: 'category',
        message: 'Category:',
        choices: STATE_CATEGORY_ORDER.map(cat => ({
          name: cat,
          value: cat,
        })),
        default: existing.category,
      },
      {
        type: 'input',
        name: 'color',
        message: 'Color (hex, optional):',
        default: existing.color || '',
        validate: (input: string) => {
          if (!input) return true;
          return /^#[0-9A-Fa-f]{6}$/.test(input) || 'Invalid hex color (e.g., #FF0000)';
        },
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description (optional):',
        default: existing.description || '',
      },
      {
        type: 'confirm',
        name: 'isDefault',
        message: 'Set as default status for new tickets?',
        default: existing.isDefault || false,
      },
    ]);

    const changes: Partial<{
      name: string;
      category: StateCategory;
      color: string;
      description: string;
      isDefault: boolean;
    }> = {};

    if (answers.name !== existing.name) changes.name = answers.name;
    if (answers.category !== existing.category) changes.category = answers.category;
    if (answers.color !== (existing.color || '')) changes.color = answers.color || undefined;
    if (answers.description !== (existing.description || '')) changes.description = answers.description || undefined;
    if (answers.isDefault !== (existing.isDefault || false)) changes.isDefault = answers.isDefault;

    return changes;
  }
}
