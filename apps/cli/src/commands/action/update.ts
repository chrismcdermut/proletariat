import { Command, Args, Flags } from '@oclif/core';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory } from '../../lib/pmo/types.js';

export default class ActionUpdate extends Command {
  static description = 'Update a work action';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-action --name "New Name"',
    '<%= config.bin %> <%= command.id %> my-action --prompt "Updated prompt..."',
  ];

  static args = {
    id: Args.string({
      description: 'Action ID to update',
      required: true,
    }),
  };

  static flags = {
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
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ActionUpdate);

    const hasChanges = flags.name || flags.prompt || flags.description !== undefined ||
                       flags['suggested-for'] || flags['move-to'] !== undefined;

    if (!hasChanges) {
      this.error('Must provide at least one flag to update');
    }

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false
    );

    try {
      const changes: {
        name?: string
        prompt?: string
        description?: string
        suggestedForCategories?: StateCategory[]
        defaultMoveToCategory?: StateCategory
      } = {};

      if (flags.name) changes.name = flags.name;
      if (flags.prompt) changes.prompt = flags.prompt;
      if (flags.description !== undefined) changes.description = flags.description;
      if (flags['suggested-for']) {
        changes.suggestedForCategories = flags['suggested-for'].split(',').map(s => s.trim()) as StateCategory[];
      }
      if (flags['move-to'] !== undefined) {
        changes.defaultMoveToCategory = flags['move-to'] as StateCategory || undefined;
      }

      const action = await storage.updateAction(args.id, changes);

      await storage.close();

      this.log(styles.success(`\nUpdated action "${styles.emphasis(action.name)}"`));
      if (flags.name) this.log(styles.muted(`  Name: ${action.name}`));
      if (flags.description !== undefined) this.log(styles.muted(`  Description: ${action.description || '(none)'}`));
      if (flags.prompt) this.log(styles.muted(`  Prompt: (updated)`));
      if (flags['suggested-for']) this.log(styles.muted(`  Suggested for: ${action.suggestedForCategories?.join(', ') || '(none)'}`));
      if (flags['move-to'] !== undefined) this.log(styles.muted(`  Moves to: ${action.defaultMoveToCategory || '(none)'}`));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
