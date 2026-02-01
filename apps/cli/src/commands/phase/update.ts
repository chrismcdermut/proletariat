import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class PhaseUpdate extends PMOCommand {
  static description = 'Update a project lifecycle phase';

  static examples = [
    '<%= config.bin %> <%= command.id %> active --name "In Development"',
    '<%= config.bin %> <%= command.id %> idea --color "#9333EA"',
    '<%= config.bin %> <%= command.id %> planned --default',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static args = {
    id: Args.string({
      description: 'Phase ID - prompts with dropdown if not provided',
      required: false,
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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };  // Phases are workspace-scoped, no project selection needed
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PhaseUpdate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('phase update', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get phase ID - use FlagResolver if not provided
    let phaseId = args.id;

    if (!phaseId) {
      const phases = await this.storage.listPhases();
      if (phases.length === 0) {
        return handleError('NO_PHASES', 'No phases found. Create a phase first with "prlt phase create".');
      }

      const idResolver = new FlagResolver<{ phaseId?: string }>({
        commandName: 'phase update',
        baseCommand: 'prlt phase update',
        jsonMode,
        flags: {},
      });

      idResolver.addPrompt({
        flagName: 'phaseId',
        type: 'list',
        message: 'Select phase to update:',
        choices: () => phases.map(p => ({
          name: `${p.name} (${p.category})`,
          value: p.id,
        })),
      });

      const resolved = await idResolver.resolve();
      phaseId = resolved.phaseId;
    }

    const existing = await this.storage.getPhase(phaseId!);
    if (!existing) {
      return handleError('PHASE_NOT_FOUND', `Phase "${phaseId}" not found.`);
    }

    // Check if any change flags were provided
    const hasChangeFlags = flags.name !== undefined ||
                            flags.category !== undefined ||
                            flags.color !== undefined ||
                            flags.description !== undefined ||
                            flags.default !== undefined;

    let updates: {
      name?: string;
      category?: StateCategory;
      color?: string;
      description?: string;
      isDefault?: boolean;
    };

    // Auto-enter interactive mode if no change flags provided
    if (flags.interactive || !hasChangeFlags) {
      // Define category labels - single source of truth
      const categoryLabels: Record<StateCategory, string> = {
        triage: 'Triage - Inbox, needs review',
        backlog: 'Backlog - Not yet scheduled for work',
        unstarted: 'Unstarted - Scheduled but work hasn\'t begun',
        started: 'Started - Work is actively in progress',
        completed: 'Completed - Work finished successfully',
        canceled: 'Canceled - Work won\'t be done',
      };

      // Use FlagResolver for update prompts
      const resolver = new FlagResolver<{
        name?: string;
        category?: string;
        color?: string;
        description?: string;
        isDefault?: boolean;
      }>({
        commandName: 'phase update',
        baseCommand: `prlt phase update ${phaseId}`,
        jsonMode,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'name',
        type: 'input',
        message: 'Name:',
        default: existing.name,
      });

      resolver.addPrompt({
        flagName: 'category',
        type: 'list',
        message: 'Category:',
        choices: () => STATE_CATEGORY_ORDER.map(cat => ({
          name: categoryLabels[cat],
          value: cat,
        })),
        default: existing.category,
        when: (ctx) => ctx.flags.name !== undefined,
      });

      resolver.addPrompt({
        flagName: 'color',
        type: 'input',
        message: 'Color (hex):',
        default: existing.color || '',
        when: (ctx) => ctx.flags.category !== undefined,
      });

      resolver.addPrompt({
        flagName: 'description',
        type: 'input',
        message: 'Description:',
        default: existing.description || '',
        when: (ctx) => ctx.flags.color !== undefined,
      });

      resolver.addPrompt({
        flagName: 'isDefault',
        type: 'list',
        message: 'Default for new projects?',
        choices: () => [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
        default: existing.isDefault || false,
        when: (ctx) => ctx.flags.description !== undefined,
      });

      const resolved = await resolver.resolve();

      // Build updates from resolved values - only include changed values
      updates = {};
      if (resolved.name && resolved.name !== existing.name) {
        updates.name = resolved.name;
      }
      if (resolved.category && resolved.category !== existing.category) {
        updates.category = resolved.category as StateCategory;
      }
      if (resolved.color !== undefined && resolved.color !== (existing.color || '')) {
        updates.color = resolved.color || undefined;
      }
      if (resolved.description !== undefined && resolved.description !== (existing.description || '')) {
        updates.description = resolved.description || undefined;
      }
      if (resolved.isDefault !== undefined && resolved.isDefault !== (existing.isDefault || false)) {
        updates.isDefault = resolved.isDefault;
      }
    } else {
      // Use flags directly
      updates = {};
      if (flags.name) updates.name = flags.name;
      if (flags.category) updates.category = flags.category as StateCategory;
      if (flags.color) updates.color = flags.color;
      if (flags.description) updates.description = flags.description;
      if (flags.default !== undefined) updates.isDefault = flags.default;
    }

    const phase = await this.storage.updatePhase(phaseId!, updates);

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
}
