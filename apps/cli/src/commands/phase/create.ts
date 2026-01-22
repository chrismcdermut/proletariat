import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildFormPromptConfig,
  FormField,
} from '../../lib/prompt-json.js';

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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
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
        // Check if JSON output mode is active
        const jsonMode = shouldOutputJson(flags);

        // In JSON mode, output form prompt
        // Define labels once - single source of truth
        const categoryLabels: Record<StateCategory, string> = {
          triage: 'Triage - Inbox, needs review',
          backlog: 'Backlog - Not yet scheduled for work',
          unstarted: 'Unstarted - Scheduled but work hasn\'t begun',
          started: 'Started - Work is actively in progress',
          completed: 'Completed - Work finished successfully',
          canceled: 'Canceled - Work won\'t be done',
        };
        const categoryChoices = STATE_CATEGORY_ORDER.map(cat => ({ name: categoryLabels[cat], value: cat }));

        // Define fields once - single source of truth for both JSON and interactive modes
        const fields: FormField[] = [
          { type: 'input', name: 'name', message: 'Phase name:', default: args.name },
          { type: 'list', name: 'category', message: 'Category:', choices: categoryChoices, default: flags.category },
          { type: 'input', name: 'color', message: 'Color (hex, optional):', default: flags.color },
          { type: 'input', name: 'description', message: 'Description (optional):', default: flags.description },
          { type: 'confirm', name: 'isDefault', message: 'Set as default for new projects?', default: flags.default || false },
        ];

        if (jsonMode) {
          outputPromptAsJson(
            buildFormPromptConfig(fields),
            createMetadata('phase create', flags)
          );
        }

        phaseData = await this.promptPhaseData(fields);
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

  private async promptPhaseData(
    fields: FormField[]
  ): Promise<{
    name: string;
    category: StateCategory;
    color?: string;
    description?: string;
    isDefault?: boolean;
  }> {
    // Build inquirer prompts from fields, adding validators
    const answers = await inquirer.prompt<{
      name: string;
      category: StateCategory;
      color: string;
      description: string;
      isDefault: boolean;
    }>(fields.map(field => ({
      ...field,
      validate: field.name === 'name'
        ? ((input: string) => input.length > 0 || 'Name is required')
        : undefined,
    })));

    return {
      name: answers.name,
      category: answers.category,
      color: answers.color || undefined,
      description: answers.description || undefined,
      isDefault: answers.isDefault,
    };
  }
}
