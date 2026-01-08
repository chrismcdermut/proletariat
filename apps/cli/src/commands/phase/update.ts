import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';

export default class PhaseUpdate extends PMOCommand {
  static description = 'Update a project lifecycle phase';

  static examples = [
    '<%= config.bin %> <%= command.id %> active --name "In Development"',
    '<%= config.bin %> <%= command.id %> idea --color "#9333EA"',
    '<%= config.bin %> <%= command.id %> planned --default',
  ];

  static args = {
    id: Args.string({
      description: 'Phase ID',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    name: Flags.string({
      char: 'n',
      description: 'New name',
    }),
    category: Flags.string({
      char: 'c',
      description: 'New category',
      options: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
    }),
    color: Flags.string({
      description: 'New hex color',
    }),
    description: Flags.string({
      char: 'd',
      description: 'New description',
    }),
    default: Flags.boolean({
      description: 'Set as default phase',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };  // Phases are workspace-scoped, no project selection needed
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PhaseUpdate);

    const existing = await this.storage.getPhase(args.id);
    if (!existing) {
      this.error(`Phase "${args.id}" not found.`);
    }

    let updates: {
      name?: string;
      category?: StateCategory;
      color?: string;
      description?: string;
      isDefault?: boolean;
    };

    if (flags.interactive) {
      updates = await this.promptUpdates(existing);
    } else {
      updates = {};
      if (flags.name) updates.name = flags.name;
      if (flags.category) updates.category = flags.category as StateCategory;
      if (flags.color) updates.color = flags.color;
      if (flags.description) updates.description = flags.description;
      if (flags.default !== undefined) updates.isDefault = flags.default;

      if (Object.keys(updates).length === 0) {
        this.error('No changes specified. Use -i for interactive mode.');
      }
    }

    const phase = await this.storage.updatePhase(args.id, updates);

    this.log(styles.success(`\nUpdated phase "${styles.emphasis(phase.name)}"`));
    this.log(styles.muted(`  ID: ${phase.id}`));
    this.log(styles.muted(`  Category: ${phase.category}`));
    if (phase.color) {
      this.log(styles.muted(`  Color: ${phase.color}`));
    }
    if (phase.description) {
      this.log(styles.muted(`  Description: ${phase.description}`));
    }
    if (phase.isDefault) {
      this.log(styles.muted(`  Default: Yes`));
    }
  }

  private async promptUpdates(existing: {
    name: string;
    category: StateCategory;
    color?: string;
    description?: string;
    isDefault?: boolean;
  }): Promise<{
    name?: string;
    category?: StateCategory;
    color?: string;
    description?: string;
    isDefault?: boolean;
  }> {
    const categoryLabels: Record<StateCategory, string> = {
      backlog: 'Backlog - Not yet scheduled for work',
      unstarted: 'Unstarted - Scheduled but work hasn\'t begun',
      started: 'Started - Work is actively in progress',
      completed: 'Completed - Work finished successfully',
      canceled: 'Canceled - Work won\'t be done',
    };

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
        message: 'Name:',
        default: existing.name,
      },
      {
        type: 'list',
        name: 'category',
        message: 'Category:',
        choices: STATE_CATEGORY_ORDER.map(cat => ({
          name: categoryLabels[cat],
          value: cat,
        })),
        default: existing.category,
      },
      {
        type: 'input',
        name: 'color',
        message: 'Color (hex):',
        default: existing.color || '',
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description:',
        default: existing.description || '',
      },
      {
        type: 'confirm',
        name: 'isDefault',
        message: 'Default for new projects?',
        default: existing.isDefault || false,
      },
    ]);

    const updates: {
      name?: string;
      category?: StateCategory;
      color?: string;
      description?: string;
      isDefault?: boolean;
    } = {};

    if (answers.name !== existing.name) updates.name = answers.name;
    if (answers.category !== existing.category) updates.category = answers.category;
    if (answers.color !== (existing.color || '')) updates.color = answers.color || undefined;
    if (answers.description !== (existing.description || '')) updates.description = answers.description || undefined;
    if (answers.isDefault !== (existing.isDefault || false)) updates.isDefault = answers.isDefault;

    return updates;
  }
}
