import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';
import {
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

interface UpdateFlags {
  id?: string;
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

export default class StatusUpdate extends PMOCommand {
  static description = 'Update a workflow status';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project-in-review --name "Code Review"',
    '<%= config.bin %> <%= command.id %> my-project-blocked --color "#EF4444"',
    '<%= config.bin %> <%= command.id %> my-project-todo --default  # Set as default',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static args = {
    id: Args.string({
      description: 'Status ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
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

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(StatusUpdate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // This command requires project context - get projectId (with JSON mode support)
    const projectId = await this.requireProject({
      jsonMode: jsonMode ? {
        flags,
        commandName: 'status update',
        baseCommand: 'prlt status update',
      } : undefined,
    });

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('status update', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get the project's workflow ID
    const project = await this.storage.getProject(projectId);
    if (!project?.workflowId) {
      return handleError('NO_WORKFLOW', `Project "${projectId}" has no workflow assigned.`);
    }

    // Get all statuses for this workflow
    const statuses = await this.storage.listStatuses(project.workflowId);
    if (statuses.length === 0) {
      return handleError('NO_STATUSES', 'No statuses found. Create a status first with "prlt status create".');
    }

    // Create FlagResolver for status selection
    const resolver = new FlagResolver<UpdateFlags>({
      commandName: 'status update',
      baseCommand: 'prlt status update',
      jsonMode,
      flags: { ...flags, id: args.id, category: flags.category as StateCategory | undefined },
      context: { projectId },
    });

    // Add status selection prompt
    resolver.addPrompt({
      flagName: 'id',
      type: 'list',
      message: 'Select status to update:',
      choices: () => statuses.map(s => ({
        name: `${s.name} (${s.category})`,
        value: s.id,
        command: `prlt status update ${s.id} --machine`,
      })),
      when: (ctx) => !ctx.flags.id,
    });

    // Resolve status ID
    const resolved = await resolver.resolve();
    const statusId = resolved.id;

    // Get existing status
    const existing = await this.storage.getStatus(statusId!);
    if (!existing) {
      return handleError('STATUS_NOT_FOUND', `Status not found: ${statusId}`);
    }

    // Check if any change flags were provided
    const hasChangeFlags = flags.name !== undefined ||
                            flags.category !== undefined ||
                            flags.color !== undefined ||
                            flags.description !== undefined ||
                            flags.default !== undefined;

    let changes: Partial<{
      name: string;
      category: StateCategory;
      color: string;
      description: string;
      isDefault: boolean;
    }>;

    // Auto-enter interactive mode if no change flags provided
    if (flags.interactive || !hasChangeFlags) {
      // Create FlagResolver for field updates
      const updateResolver = new FlagResolver<UpdateFlags>({
        commandName: 'status update',
        baseCommand: `prlt status update ${statusId}`,
        jsonMode,
        flags: { ...flags, id: statusId, category: flags.category as StateCategory | undefined },
        context: { projectId, statusId, existing },
      });

      // Add prompts for each field
      updateResolver.addPrompt({
        flagName: 'name',
        type: 'input',
        message: 'Status name:',
        default: existing.name,
        validate: (value) => (value as string).length > 0 || 'Name is required',
        when: (ctx) => ctx.flags.name === undefined,
      });

      updateResolver.addPrompt({
        flagName: 'category',
        type: 'list',
        message: 'Category:',
        choices: () => STATE_CATEGORY_ORDER.map(cat => ({
          name: cat,
          value: cat,
          command: `prlt status update ${statusId} --category ${cat} --machine`,
        })),
        default: existing.category,
        when: (ctx) => ctx.flags.category === undefined,
      });

      updateResolver.addPrompt({
        flagName: 'color',
        type: 'input',
        message: 'Color (hex, optional):',
        default: existing.color || '',
        validate: (value) => {
          const v = value as string;
          if (!v) return true;
          return /^#[0-9A-Fa-f]{6}$/.test(v) || 'Invalid hex color (e.g., #FF0000)';
        },
        when: (ctx) => ctx.flags.color === undefined,
      });

      updateResolver.addPrompt({
        flagName: 'description',
        type: 'input',
        message: 'Description (optional):',
        default: existing.description || '',
        when: (ctx) => ctx.flags.description === undefined,
      });

      updateResolver.addPrompt({
        flagName: 'default',
        type: 'list',
        message: 'Set as default status for new tickets?',
        choices: () => [
          { name: 'Yes', value: true, command: `prlt status update ${statusId} --default --json` },
          { name: 'No', value: false, command: `prlt status update ${statusId} --no-default --json` },
        ],
        default: existing.isDefault || false,
        when: (ctx) => ctx.flags.default === undefined,
      });

      const updateResolved = await updateResolver.resolve();

      changes = {};
      if (updateResolved.name !== existing.name) changes.name = updateResolved.name;
      if (updateResolved.category !== existing.category) changes.category = updateResolved.category;
      if (updateResolved.color !== (existing.color || '')) changes.color = updateResolved.color || undefined;
      if (updateResolved.description !== (existing.description || '')) changes.description = updateResolved.description || undefined;
      if (updateResolved.default !== (existing.isDefault || false)) changes.isDefault = updateResolved.default;
    } else {
      changes = {};
      if (flags.name !== undefined) changes.name = flags.name;
      if (flags.category !== undefined) changes.category = flags.category as StateCategory;
      if (flags.color !== undefined) changes.color = flags.color;
      if (flags.description !== undefined) changes.description = flags.description;
      if (flags.default !== undefined) changes.isDefault = flags.default;
    }

    const updated = await this.storage.updateStatus(statusId!, changes);

    this.log(styles.success(`\nUpdated status "${styles.emphasis(updated.name)}"`));
    this.log(styles.muted(`  ID: ${updated.id}`));
    this.log(styles.muted(`  Category: ${updated.category}`));
    if (updated.color) {
      this.log(styles.muted(`  Color: ${updated.color}`));
    }
    if (updated.isDefault) {
      this.log(styles.muted(`  Default: yes`));
    }
  }
}
