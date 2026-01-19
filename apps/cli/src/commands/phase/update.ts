import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
  buildFormPromptConfig,
  FormField,
} from '../../lib/prompt-json.js';

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

    // Get phase ID - prompt if not provided
    let phaseId = args.id;

    if (!phaseId) {
      const phases = await this.storage.listPhases();
      if (phases.length === 0) {
        return handleError('NO_PHASES', 'No phases found. Create a phase first with "prlt phase create".');
      }

      // In JSON mode, output phase selection prompt
      if (jsonMode) {
        const phaseChoices = phases.map(p => ({
          name: `${p.name} (${p.category})`,
          value: p.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'phaseId', 'Select phase to update:', phaseChoices),
          createMetadata('phase update', flags)
        );
        return;
      }

      const { selectedId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedId',
        message: 'Select phase to update:',
        choices: phases.map(p => ({
          name: `${p.name} (${p.category})`,
          value: p.id,
        })),
      }]);
      phaseId = selectedId;
    }

    const existing = await this.storage.getPhase(phaseId!);
    if (!existing) {
      return handleError('PHASE_NOT_FOUND', `Phase "${phaseId}" not found.`);
    }

    let updates: {
      name?: string;
      category?: StateCategory;
      color?: string;
      description?: string;
      isDefault?: boolean;
    };

    // Check if any change flags were provided
    const hasChangeFlags = flags.name !== undefined ||
                            flags.category !== undefined ||
                            flags.color !== undefined ||
                            flags.description !== undefined ||
                            flags.default !== undefined;

    // Auto-enter interactive mode if no change flags provided
    if (flags.interactive || !hasChangeFlags) {
      // Define labels and choices once - single source of truth
      const categoryLabels: Record<StateCategory, string> = {
        backlog: 'Backlog - Not yet scheduled for work',
        unstarted: 'Unstarted - Scheduled but work hasn\'t begun',
        started: 'Started - Work is actively in progress',
        completed: 'Completed - Work finished successfully',
        canceled: 'Canceled - Work won\'t be done',
      };
      const categoryChoices = STATE_CATEGORY_ORDER.map(cat => ({ name: categoryLabels[cat], value: cat }));

      // Define fields once - single source of truth for both JSON and interactive modes
      const fields: FormField[] = [
        { type: 'input', name: 'name', message: 'Name:', default: existing.name },
        { type: 'list', name: 'category', message: 'Category:', choices: categoryChoices, default: existing.category },
        { type: 'input', name: 'color', message: 'Color (hex):', default: existing.color || '' },
        { type: 'input', name: 'description', message: 'Description:', default: existing.description || '' },
        { type: 'confirm', name: 'isDefault', message: 'Default for new projects?', default: existing.isDefault || false },
      ];

      // In JSON mode, output form prompt
      if (jsonMode) {
        outputPromptAsJson(
          buildFormPromptConfig(fields),
          createMetadata('phase update', flags)
        );
      }

      updates = await this.promptUpdates(fields, existing);
    } else {
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

  private async promptUpdates(
    fields: FormField[],
    existing: {
      name: string;
      category: StateCategory;
      color?: string;
      description?: string;
      isDefault?: boolean;
    }
  ): Promise<{
    name?: string;
    category?: StateCategory;
    color?: string;
    description?: string;
    isDefault?: boolean;
  }> {
    // Build inquirer prompts from fields
    const answers = await inquirer.prompt<{
      name: string;
      category: StateCategory;
      color: string;
      description: string;
      isDefault: boolean;
    }>(fields);

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
