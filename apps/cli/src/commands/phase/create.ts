import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';

export default class PhaseCreate extends PMOCommand {
  static description = 'Create a new project lifecycle phase';

  static examples = [
    '<%= config.bin %> <%= command.id %> "On Hold" --category unstarted',
    '<%= config.bin %> <%= command.id %> "In Review" --category started --color "#FFA500"',
    '<%= config.bin %> <%= command.id %> -i  # Interactive mode',
  ];

  static args = {
    name: Args.string({
      description: 'Phase name',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    category: Flags.string({
      char: 'c',
      description: 'State category',
      options: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
    }),
    color: Flags.string({
      description: 'Hex color (e.g., "#FF5733")',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Phase description',
    }),
    default: Flags.boolean({
      description: 'Set as default phase for new projects',
      default: false,
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PhaseCreate);

    {
      let phaseData: {
        name: string;
        category: StateCategory;
        color?: string;
        description?: string;
        isDefault?: boolean;
      };

      // Auto-enter interactive mode if any required value is missing
      if (flags.interactive || !args.name || !flags.category) {
        phaseData = await this.promptPhaseData(args, flags);
      } else {
        phaseData = {
          name: args.name,
          category: flags.category as StateCategory,
          color: flags.color,
          description: flags.description,
          isDefault: flags.default,
        };
      }

      const phase = await this.storage.createPhase(phaseData);

      this.log(styles.success(`\nCreated phase "${styles.emphasis(phase.name)}"`));
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
  }

  private async promptPhaseData(args: { name?: string }, flags: {
    category?: string;
    color?: string;
    description?: string;
    default?: boolean;
  }): Promise<{
    name: string;
    category: StateCategory;
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
        message: 'Phase name:',
        default: args.name,
        validate: (input: string) => input.length > 0 || 'Name is required',
      },
      {
        type: 'list',
        name: 'category',
        message: 'Category:',
        choices: STATE_CATEGORY_ORDER.map(cat => ({
          name: categoryLabels[cat],
          value: cat,
        })),
        default: flags.category,
      },
      {
        type: 'input',
        name: 'color',
        message: 'Color (hex, optional):',
        default: flags.color,
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description (optional):',
        default: flags.description,
      },
      {
        type: 'confirm',
        name: 'isDefault',
        message: 'Set as default for new projects?',
        default: flags.default || false,
      },
    ]);

    return {
      name: answers.name,
      category: answers.category,
      color: answers.color || undefined,
      description: answers.description || undefined,
      isDefault: answers.isDefault,
    };
  }
}
