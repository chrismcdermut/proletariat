import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';

interface CreateFlags {
  name?: string;
  category?: StateCategory;
  color?: string;
  description?: string;
  default?: boolean;
  project?: string;
  json?: boolean;
  machine?: boolean;
  interactive?: boolean;
  [key: string]: unknown;
}

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
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(StatusCreate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // This command requires project context - get projectId (with JSON mode support)
    const projectId = await this.requireProject({
      jsonMode: jsonMode ? {
        flags,
        commandName: 'status create',
        baseCommand: 'prlt status create',
      } : undefined,
    });

    // Determine initial name from args or flags
    const initialName = args.name || flags.name;

    // Create FlagResolver for prompts
    const resolver = new FlagResolver<CreateFlags>({
      commandName: 'status create',
      baseCommand: 'prlt status create',
      jsonMode,
      flags: { ...flags, name: initialName, category: flags.category as StateCategory | undefined },
      context: { projectId },
    });

    // Add name prompt
    resolver.addPrompt({
      flagName: 'name',
      type: 'input',
      message: 'Status name:',
      default: initialName,
      validate: (value) => (value as string).trim() ? true : 'Name cannot be empty',
      when: (ctx) => !ctx.flags.name || flags.interactive,
    });

    // Add category prompt
    resolver.addPrompt({
      flagName: 'category',
      type: 'list',
      message: 'Category:',
      choices: () => STATE_CATEGORY_ORDER.map(cat => ({
        name: `${cat} - ${this.getCategoryDescription(cat)}`,
        value: cat,
        command: `prlt status create --category ${cat} --machine`,
      })),
      default: flags.category || 'backlog',
      when: (ctx) => !ctx.flags.category || flags.interactive,
    });

    // Optional prompts - only shown in interactive mode
    // In JSON/machine mode, optional fields should be passed as flags or omitted
    if (flags.interactive) {
      // Add color prompt
      resolver.addPrompt({
        flagName: 'color',
        type: 'input',
        message: 'Color (hex, optional):',
        default: flags.color,
        validate: (value) => {
          const v = value as string;
          if (!v) return true;
          return /^#[0-9A-Fa-f]{6}$/.test(v) || 'Invalid hex color (e.g., #FF0000)';
        },
        when: (ctx) => ctx.flags.color === undefined,
      });

      // Add description prompt
      resolver.addPrompt({
        flagName: 'description',
        type: 'input',
        message: 'Description (optional):',
        default: flags.description,
        when: (ctx) => ctx.flags.description === undefined,
      });

      // Add default prompt
      resolver.addPrompt({
        flagName: 'default',
        type: 'list',
        message: 'Set as default status for new tickets?',
        choices: () => [
          { name: 'No', value: false, command: 'prlt status create --json' },
          { name: 'Yes', value: true, command: 'prlt status create --default --json' },
        ],
        default: flags.default || false,
        when: (ctx) => ctx.flags.default === undefined,
      });
    }

    // Resolve all flags
    const resolved = await resolver.resolve();

    const status = await this.storage.createStatus(projectId, {
      name: resolved.name!,
      category: resolved.category!,
      color: resolved.color,
      description: resolved.description,
      isDefault: resolved.default,
    });

    const projectName = await this.getProjectName(projectId);
    this.log(styles.success(`\nCreated status "${styles.emphasis(status.name)}"`));
    this.log(styles.muted(`  Category: ${status.category}`));
    this.log(styles.muted(`  Project: ${projectName}`));
    if (status.color) {
      this.log(styles.muted(`  Color: ${status.color}`));
    }
    if (status.isDefault) {
      this.log(styles.muted(`  Default: yes`));
    }
  }

  private getCategoryDescription(category: StateCategory): string {
    const descriptions: Record<StateCategory, string> = {
      triage: 'Inbox - needs review before entering workflow',
      backlog: 'Not yet scheduled for work',
      unstarted: 'Scheduled but work hasn\'t begun',
      started: 'Work is actively in progress',
      completed: 'Work finished successfully',
      canceled: 'Work won\'t be done',
    };
    return descriptions[category];
  }
}
