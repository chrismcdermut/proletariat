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

export default class StatusCreate extends PMOCommand {
  static description = 'Create a new workflow status';

  static examples = [
    '<%= config.bin %> <%= command.id %> "In Review" --category started',
    '<%= config.bin %> <%= command.id %> --name "Blocked" --category started --color "#EF4444"',
    '<%= config.bin %> <%= command.id %> -i  # Interactive mode',
  ];

  static args = {
    name: Args.string({
      description: 'Status name',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    name: Flags.string({
      char: 'n',
      description: 'Status name',
    }),
    category: Flags.string({
      char: 'c',
      description: 'Status category',
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
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(StatusCreate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    let statusData: {
      name: string;
      category: StateCategory;
      color?: string;
      description?: string;
      isDefault?: boolean;
    };

    // Auto-enter interactive mode if any required value is missing
    const name = args.name || flags.name;
    if (flags.interactive || !name || !flags.category) {
      // Build choices once - single source of truth
      const categoryChoices = STATE_CATEGORY_ORDER.map(cat => ({
        name: `${cat} - ${this.getCategoryDescription(cat)}`,
        value: cat,
      }));

      // Define fields once - single source of truth for both JSON and interactive modes
      const fields: FormField[] = [
        { type: 'input', name: 'name', message: 'Status name:', default: name || flags.name },
        { type: 'list', name: 'category', message: 'Category:', choices: categoryChoices, default: flags.category || 'backlog' },
        { type: 'input', name: 'color', message: 'Color (hex, optional):', default: flags.color },
        { type: 'input', name: 'description', message: 'Description (optional):', default: flags.description },
        { type: 'confirm', name: 'isDefault', message: 'Set as default status for new tickets?', default: flags.default || false },
      ];

      // In JSON mode, output form prompts
      if (jsonMode) {
        outputPromptAsJson(
          buildFormPromptConfig(fields),
          createMetadata('status create', flags)
        );
      }

      statusData = await this.promptStatusData(fields);
    } else {
      statusData = {
        name,
        category: flags.category as StateCategory,
        color: flags.color,
        description: flags.description,
        isDefault: flags.default,
      };
    }

    const status = await this.storage.createStatus({
      projectId: this.projectId,
      name: statusData.name,
      category: statusData.category,
      color: statusData.color,
      description: statusData.description,
      isDefault: statusData.isDefault,
    });

    this.log(styles.success(`\nCreated status "${styles.emphasis(status.name)}"`));
    this.log(styles.muted(`  Category: ${status.category}`));
    this.log(styles.muted(`  Project: ${this.projectName}`));
    if (status.color) {
      this.log(styles.muted(`  Color: ${status.color}`));
    }
    if (status.isDefault) {
      this.log(styles.muted(`  Default: yes`));
    }
  }

  private async promptStatusData(
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
        : field.name === 'color'
        ? ((input: string) => {
            if (!input) return true;
            return /^#[0-9A-Fa-f]{6}$/.test(input) || 'Invalid hex color (e.g., #FF0000)';
          })
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

  private getCategoryDescription(category: StateCategory): string {
    const descriptions: Record<StateCategory, string> = {
      backlog: 'Not yet scheduled for work',
      unstarted: 'Scheduled but work hasn\'t begun',
      started: 'Work is actively in progress',
      completed: 'Work finished successfully',
      canceled: 'Work won\'t be done',
    };
    return descriptions[category];
  }
}
