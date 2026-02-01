import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

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

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define category labels - single source of truth
    const categoryLabels: Record<StateCategory, string> = {
      triage: 'Triage - Inbox, needs review',
      backlog: 'Backlog - Not yet scheduled for work',
      unstarted: 'Unstarted - Scheduled but work hasn\'t begun',
      started: 'Started - Work is actively in progress',
      completed: 'Completed - Work finished successfully',
      canceled: 'Canceled - Work won\'t be done',
    };

    // Use FlagResolver for unified JSON mode and interactive handling
    const resolver = new FlagResolver<{
      name?: string;
      category?: string;
      color?: string;
      description?: string;
      default?: boolean;
    }>({
      commandName: 'phase create',
      baseCommand: 'prlt phase create',
      jsonMode,
      flags: {
        name: args.name,
        category: flags.category,
        color: flags.color,
        description: flags.description,
        default: flags.default,
      },
    });

    // Name prompt - required
    resolver.addPrompt({
      flagName: 'name',
      type: 'input',
      message: 'Phase name:',
      when: (ctx) => !ctx.flags.name,
      validate: (value) => (value as string).length > 0 || 'Name is required',
      context: {
        hint: 'Provide name with: prlt phase create "Phase Name" --category <category>',
        example: 'prlt phase create "In Review" --category started',
      },
    });

    // Category prompt - required
    resolver.addPrompt({
      flagName: 'category',
      type: 'list',
      message: 'Category:',
      choices: () => STATE_CATEGORY_ORDER.map(cat => ({
        name: categoryLabels[cat],
        value: cat,
      })),
      when: (ctx) => !ctx.flags.category && ctx.flags.name !== undefined,
    });

    // Color prompt - optional (only in interactive mode)
    if (flags.interactive) {
      resolver.addPrompt({
        flagName: 'color',
        type: 'input',
        message: 'Color (hex, optional):',
        when: (ctx) => ctx.flags.category !== undefined && ctx.flags.color === undefined,
      });

      // Description prompt - optional (only in interactive mode)
      resolver.addPrompt({
        flagName: 'description',
        type: 'input',
        message: 'Description (optional):',
        when: (ctx) => ctx.flags.category !== undefined && ctx.flags.description === undefined,
      });

      // Default prompt - optional (only in interactive mode)
      resolver.addPrompt({
        flagName: 'default',
        type: 'list',
        message: 'Set as default for new projects?',
        choices: () => [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
        when: (ctx) => ctx.flags.category !== undefined && ctx.flags.default === undefined,
      });
    }

    // Resolve missing flags
    const resolved = await resolver.resolve();

    // Validate required fields
    if (!resolved.name) {
      this.error('Name is required. Use positional arg or --interactive mode.');
    }
    if (!resolved.category) {
      this.error('Category is required. Use --category flag or --interactive mode.');
    }

    // Create the phase
    const phase = await this.storage.createPhase({
      name: resolved.name,
      category: resolved.category as StateCategory,
      color: resolved.color || undefined,
      description: resolved.description || undefined,
      isDefault: resolved.default || false,
    });

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
