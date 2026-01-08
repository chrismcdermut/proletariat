import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';

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
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ActionUpdate);

    // Get current action
    const existingAction = await this.storage.getAction(args.id);
    if (!existingAction) {
      this.error(`Action not found: ${args.id}`);
    }

    if (existingAction.isBuiltin) {
      this.error('Cannot update built-in actions. Create a custom action instead.');
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
      this.log('');
      this.log(styles.header(`Updating action: ${existingAction.name}`));
      this.log(styles.muted('Press Enter to keep current value, or enter new value.'));
      this.log('');

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Name:',
          default: existingAction.name,
        },
        {
          type: 'input',
          name: 'description',
          message: 'Description:',
          default: existingAction.description || '',
        },
        {
          type: 'editor',
          name: 'prompt',
          message: 'Prompt (opens editor):',
          default: existingAction.prompt,
        },
        {
          type: 'checkbox',
          name: 'suggestedFor',
          message: 'Suggested for categories:',
          choices: STATE_CATEGORY_ORDER.map(c => ({
            name: c,
            value: c,
            checked: existingAction.suggestedForCategories?.includes(c),
          })),
        },
        {
          type: 'list',
          name: 'moveTo',
          message: 'Move ticket to category after action:',
          choices: [
            { name: '(no change)', value: '__none__' },
            ...STATE_CATEGORY_ORDER.map(c => ({ name: c, value: c })),
          ],
          default: existingAction.defaultMoveToCategory || '__none__',
        },
      ]);

      if (answers.name !== existingAction.name) changes.name = answers.name;
      if (answers.description !== (existingAction.description || '')) changes.description = answers.description;
      if (answers.prompt !== existingAction.prompt) changes.prompt = answers.prompt;

      const currentSuggested = existingAction.suggestedForCategories?.sort().join(',') || '';
      const newSuggested = answers.suggestedFor.sort().join(',');
      if (newSuggested !== currentSuggested) {
        changes.suggestedForCategories = answers.suggestedFor;
      }

      const currentMoveTo = existingAction.defaultMoveToCategory || '__none__';
      if (answers.moveTo !== currentMoveTo) {
        changes.defaultMoveToCategory = answers.moveTo === '__none__' ? null : answers.moveTo;
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
