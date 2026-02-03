import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER } from '../../lib/pmo/types.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

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

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    let name = args.name;
    let prompt = flags.prompt;
    let description = flags.description;
    let suggestedFor: StateCategory[] | undefined;
    let moveTo: StateCategory | undefined = flags['move-to'] as StateCategory | undefined;

    // Interactive mode if name or prompt is missing
    if (!name || !prompt || flags.interactive) {
      // Build choices for list/checkbox prompts
      const suggestedForChoices = STATE_CATEGORY_ORDER.map(c => ({ name: c, value: c }));
      const moveToChoices = [
        { name: '(no automatic move)', value: '' },
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
        commandName: 'action create',
        baseCommand: 'prlt action create',
        jsonMode,
        flags: {
          name,
          prompt,
          description,
          moveTo: moveTo || '',
        },
      });

      // Name input
      resolver.addPrompt({
        flagName: 'name',
        type: 'input',
        message: 'Action name:',
        default: name,
        when: (ctx) => !ctx.flags.name,
        validate: (value) => (value as string).trim() ? true : 'Name is required',
        context: {
          hint: 'Provide with: prlt action create "Action Name" --prompt "..."',
          requiredFields: ['name (as first argument)', '--prompt'],
        },
      });

      // Prompt input (editor type in interactive, but input for JSON mode context)
      resolver.addPrompt({
        flagName: 'prompt',
        type: 'editor',
        message: 'Prompt (opens editor):',
        default: prompt || 'Enter the prompt that will be sent to the agent...',
        when: (ctx) => !ctx.flags.prompt && ctx.flags.name !== undefined,
        validate: (value) => (value as string).trim() ? true : 'Prompt is required',
        context: (ctx) => ({
          hint: `Provide with: prlt action create "${ctx.flags.name}" --prompt "Your prompt here"`,
          requiredFields: ['--prompt'],
          optionalFields: ['--description', '--suggested-for', '--move-to'],
        }),
      });

      // Description input (optional, only in full interactive mode)
      if (flags.interactive) {
        resolver.addPrompt({
          flagName: 'description',
          type: 'input',
          message: 'Description (optional):',
          default: description || '',
          when: (ctx) => ctx.flags.name !== undefined && ctx.flags.prompt !== undefined,
        });

        // Suggested-for checkbox (optional)
        resolver.addPrompt({
          flagName: 'suggestedFor',
          type: 'checkbox',
          message: 'Suggested for categories (optional):',
          choices: () => suggestedForChoices,
          when: (ctx) => ctx.flags.name !== undefined && ctx.flags.prompt !== undefined,
        });

        // Move-to list (optional)
        resolver.addPrompt({
          flagName: 'moveTo',
          type: 'list',
          message: 'Move ticket to category after action:',
          choices: () => moveToChoices,
          default: moveTo || '',
          when: (ctx) => ctx.flags.name !== undefined && ctx.flags.prompt !== undefined,
        });
      }

      const resolved = await resolver.resolve();

      name = resolved.name || name;
      prompt = resolved.prompt || prompt;
      description = resolved.description || description;
      suggestedFor = resolved.suggestedFor?.length ? resolved.suggestedFor : undefined;
      moveTo = (resolved.moveTo || undefined) as StateCategory | undefined;
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
