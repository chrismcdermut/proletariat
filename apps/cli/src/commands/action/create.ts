import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';

export default class ActionCreate extends PMOCommand {
  static description = 'Create a new work action';

  static examples = [
    '<%= config.bin %> <%= command.id %> "Security Review" --prompt "Review for vulnerabilities..."',
    '<%= config.bin %> <%= command.id %> "Write Docs" --prompt "Document this feature..." --suggested-for completed',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static args = {
    name: Args.string({
      description: 'Name for the new action',
      required: false,  // Not required - will prompt if missing
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    prompt: Flags.string({
      char: 'p',
      description: 'The prompt to send to the agent',
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
    const { args, flags } = await this.parse(ActionCreate);

    let name = args.name;
    let prompt = flags.prompt;
    let description = flags.description;
    let suggestedFor: StateCategory[] | undefined;
    let moveTo: StateCategory | undefined = flags['move-to'] as StateCategory | undefined;

    // Interactive mode if name or prompt is missing
    if (!name || !prompt || flags.interactive) {
      this.log('');
      this.log(styles.header('Create Custom Action'));
      this.log('');

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Action name:',
          default: name,
          validate: (input: string) => input.trim() ? true : 'Name is required',
          when: !name,
        },
        {
          type: 'input',
          name: 'description',
          message: 'Description (optional):',
          default: description || '',
        },
        {
          type: 'editor',
          name: 'prompt',
          message: 'Prompt (opens editor):',
          default: prompt || 'Enter the prompt that will be sent to the agent...',
          validate: (input: string) => input.trim() ? true : 'Prompt is required',
          when: !prompt,
        },
        {
          type: 'checkbox',
          name: 'suggestedFor',
          message: 'Suggested for categories (optional):',
          choices: STATE_CATEGORY_ORDER.map(c => ({
            name: c,
            value: c,
          })),
        },
        {
          type: 'list',
          name: 'moveTo',
          message: 'Move ticket to category after action:',
          choices: [
            { name: '(no automatic move)', value: '' },
            ...STATE_CATEGORY_ORDER.map(c => ({ name: c, value: c })),
          ],
          default: moveTo || '',
        },
      ]);

      name = answers.name || name;
      prompt = answers.prompt || prompt;
      description = answers.description || description;
      suggestedFor = answers.suggestedFor?.length ? answers.suggestedFor : undefined;
      moveTo = answers.moveTo || undefined;
    } else {
      // Parse flags
      suggestedFor = flags['suggested-for']
        ? flags['suggested-for'].split(',').map(s => s.trim()) as StateCategory[]
        : undefined;
    }

    if (!name || !prompt) {
      this.error('Name and prompt are required.');
    }

    const action = await this.storage.createAction({
      name,
      description,
      prompt,
      suggestedForCategories: suggestedFor,
      defaultMoveToCategory: moveTo,
    });

    this.log(styles.success(`\nCreated action "${styles.emphasis(action.name)}" (${action.id})`));
    if (action.description) {
      this.log(styles.muted(`  ${action.description}`));
    }
    if (action.suggestedForCategories?.length) {
      this.log(styles.muted(`  Suggested for: ${action.suggestedForCategories.join(', ')}`));
    }
    this.log('');
    this.log(styles.muted(`Use with: prlt work start TKT-001 --action ${action.id}`));
  }
}
