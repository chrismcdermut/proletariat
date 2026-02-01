import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class ActionUpdate extends PMOCommand {
  static description = 'Update a work action';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-action --name "New Name"',
    '<%= config.bin %> <%= command.id %> my-action --prompt "Updated prompt..."',
    '<%= config.bin %> <%= command.id %> my-action  # Interactive mode',
  ];

  static args = {
    id: Args.string({
      description: 'Action ID to update',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    name: Flags.string({
      char: 'n',
      description: 'New action name',
    }),
    prompt: Flags.string({
      char: 'p',
      description: 'New prompt text',
    }),
    description: Flags.string({
      char: 'd',
      description: 'New description',
    }),
    'suggested-for': Flags.string({
      description: 'Categories this action is suggested for (comma-separated)',
    }),
    'move-to': Flags.string({
      description: 'Category to move ticket to after action',
      options: ['backlog', 'unstarted', 'started', 'completed', 'canceled', ''],
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode - prompt for all fields',
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
    const { args, flags } = await this.parse(ActionUpdate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('action update', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get current action
    const existingAction = await this.storage.getAction(args.id);
    if (!existingAction) {
      return handleError('ACTION_NOT_FOUND', `Action not found: ${args.id}`);
    }

    if (existingAction.isBuiltin) {
      return handleError('CANNOT_UPDATE_BUILTIN', 'Cannot update built-in actions. Create a custom action instead.');
    }

    const hasFlags = flags.name || flags.prompt || flags.description !== undefined ||
                     flags['suggested-for'] || flags['move-to'] !== undefined;

    const changes: {
      name?: string
      prompt?: string
      description?: string
      suggestedForCategories?: StateCategory[]
      defaultMoveToCategory?: StateCategory | null
    } = {};

    // Interactive mode if no flags provided or --interactive flag
    if (!hasFlags || flags.interactive) {
      // Build choices once - single source of truth
      const suggestedForChoices = STATE_CATEGORY_ORDER.map(c => ({ name: c, value: c }));
      const moveToChoices = [
        { name: '(no change)', value: '__none__' },
        ...STATE_CATEGORY_ORDER.map(c => ({ name: c, value: c })),
      ];

      // Use FlagResolver for prompts - works in both JSON and interactive modes
      const resolver = new FlagResolver<{
        name?: string;
        description?: string;
        prompt?: string;
        suggestedFor?: StateCategory[];
        moveTo?: string;
      }>({
        commandName: 'action update',
        baseCommand: `prlt action update ${args.id}`,
        jsonMode,
        flags: {},
      });

      // Name input
      resolver.addPrompt({
        flagName: 'name',
        type: 'input',
        message: 'Name:',
        default: existingAction.name,
        context: {
          hint: `Provide with: prlt action update ${args.id} --name "New Name"`,
          currentValue: existingAction.name,
        },
      });

      // Description input
      resolver.addPrompt({
        flagName: 'description',
        type: 'input',
        message: 'Description:',
        default: existingAction.description || '',
        when: (ctx) => ctx.flags.name !== undefined,
        context: {
          currentValue: existingAction.description || '',
        },
      });

      // Prompt input (editor)
      resolver.addPrompt({
        flagName: 'prompt',
        type: 'editor',
        message: 'Prompt (opens editor):',
        default: existingAction.prompt,
        when: (ctx) => ctx.flags.name !== undefined && ctx.flags.description !== undefined,
        context: {
          hint: `Current prompt length: ${existingAction.prompt.length} chars`,
        },
      });

      // Suggested-for checkbox
      resolver.addPrompt({
        flagName: 'suggestedFor',
        type: 'checkbox',
        message: 'Suggested for categories:',
        choices: () => suggestedForChoices.map(c => ({
          ...c,
          // Pre-select current values
          checked: existingAction.suggestedForCategories?.includes(c.value as StateCategory),
        })),
        when: (ctx) => ctx.flags.prompt !== undefined,
      });

      // Move-to list
      resolver.addPrompt({
        flagName: 'moveTo',
        type: 'list',
        message: 'Move ticket to category after action:',
        choices: () => moveToChoices,
        default: existingAction.defaultMoveToCategory || '__none__',
        when: (ctx) => ctx.flags.suggestedFor !== undefined,
      });

      this.log('');
      this.log(styles.header(`Updating action: ${existingAction.name}`));
      this.log(styles.muted('Press Enter to keep current value, or enter new value.'));
      this.log('');

      const resolved = await resolver.resolve();

      if (resolved.name !== existingAction.name) changes.name = resolved.name;
      if (resolved.description !== (existingAction.description || '')) changes.description = resolved.description;
      if (resolved.prompt !== existingAction.prompt) changes.prompt = resolved.prompt;

      const currentSuggested = existingAction.suggestedForCategories?.sort().join(',') || '';
      const newSuggested = (resolved.suggestedFor || []).sort().join(',');
      if (newSuggested !== currentSuggested) {
        changes.suggestedForCategories = resolved.suggestedFor;
      }

      const currentMoveTo = existingAction.defaultMoveToCategory || '__none__';
      if (resolved.moveTo !== currentMoveTo) {
        changes.defaultMoveToCategory = resolved.moveTo === '__none__' ? null : resolved.moveTo as StateCategory;
      }
    } else {
      // Flag-based update
      if (flags.name) changes.name = flags.name;
      if (flags.prompt) changes.prompt = flags.prompt;
      if (flags.description !== undefined) changes.description = flags.description;
      if (flags['suggested-for']) {
        changes.suggestedForCategories = flags['suggested-for'].split(',').map(s => s.trim()) as StateCategory[];
      }
      if (flags['move-to'] !== undefined) {
        changes.defaultMoveToCategory = flags['move-to'] as StateCategory || null;
      }
    }

    // Check if any changes
    if (Object.keys(changes).length === 0) {
      this.log(styles.muted('No changes made.'));
      return;
    }

    // Convert null to undefined for storage layer compatibility
    const updatePayload = {
      ...changes,
      defaultMoveToCategory: changes.defaultMoveToCategory === null
        ? undefined
        : changes.defaultMoveToCategory,
    };

    const action = await this.storage.updateAction(args.id, updatePayload);

    this.log(styles.success(`\nUpdated action "${styles.emphasis(action.name)}"`));
    if (changes.name) this.log(styles.muted(`  Name: ${action.name}`));
    if (changes.description !== undefined) this.log(styles.muted(`  Description: ${action.description || '(none)'}`));
    if (changes.prompt) this.log(styles.muted(`  Prompt: (updated)`));
    if (changes.suggestedForCategories) this.log(styles.muted(`  Suggested for: ${action.suggestedForCategories?.join(', ') || '(none)'}`));
    if (changes.defaultMoveToCategory !== undefined) this.log(styles.muted(`  Moves to: ${action.defaultMoveToCategory || '(none)'}`));
  }
}
