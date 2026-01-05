import { Command, Args, Flags } from '@oclif/core';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory } from '../../lib/pmo/types.js';

export default class ActionCreate extends Command {
  static description = 'Create a new work action';

  static examples = [
    '<%= config.bin %> <%= command.id %> "Security Review" --prompt "Review for vulnerabilities..."',
    '<%= config.bin %> <%= command.id %> "Write Docs" --prompt "Document this feature..." --suggested-for completed',
  ];

  static args = {
    name: Args.string({
      description: 'Name for the new action',
      required: true,
    }),
  };

  static flags = {
    prompt: Flags.string({
      char: 'p',
      description: 'The prompt to send to the agent',
      required: true,
    }),
    description: Flags.string({
      char: 'd',
      description: 'Short description of what this action does',
    }),
    'suggested-for': Flags.string({
      description: 'Categories this action is suggested for (comma-separated)',
    }),
    'move-to': Flags.string({
      description: 'Category to move ticket to after action',
      options: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ActionCreate);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false
    );

    try {
      const suggestedFor = flags['suggested-for']
        ? flags['suggested-for'].split(',').map(s => s.trim()) as StateCategory[]
        : undefined;

      const action = await storage.createAction({
        name: args.name,
        description: flags.description,
        prompt: flags.prompt,
        suggestedForCategories: suggestedFor,
        defaultMoveToCategory: flags['move-to'] as StateCategory | undefined,
      });

      await storage.close();

      this.log(styles.success(`\nCreated action "${styles.emphasis(action.name)}" (${action.id})`));
      if (action.description) {
        this.log(styles.muted(`  ${action.description}`));
      }
      if (action.suggestedForCategories?.length) {
        this.log(styles.muted(`  Suggested for: ${action.suggestedForCategories.join(', ')}`));
      }
      this.log('');
      this.log(styles.muted(`Use with: prlt work start TKT-001 --action ${action.id}`));
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
