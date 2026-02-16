import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class ProfileCreate extends PMOCommand {
  static description = 'Create a new agent profile';

  static examples = [
    '<%= config.bin %> <%= command.id %> "frontend-specialist" --system-prompt "Focus on React components"',
    '<%= config.bin %> <%= command.id %> "retro-enabled" --start-hook "prlt ticket show $TICKET_ID > /tmp/context.md" --end-hook "prlt retro generate $TICKET_ID"',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static args = {
    name: Args.string({
      description: 'Name for the new profile',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    description: Flags.string({
      char: 'd',
      description: 'Short description of the profile',
    }),
    'start-hook': Flags.string({
      description: 'Shell command(s) to run when session begins',
    }),
    'end-hook': Flags.string({
      description: 'Shell command(s) to run before exit',
    }),
    'system-prompt': Flags.string({
      char: 's',
      description: 'Additional instructions injected into agent context',
    }),
    repos: Flags.string({
      description: 'Comma-separated list of repo names',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode - prompt for all fields',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ProfileCreate);

    const jsonMode = shouldOutputJson(flags);

    let name = args.name;
    let description = flags.description;
    let startHook = flags['start-hook'];
    let endHook = flags['end-hook'];
    let systemPrompt = flags['system-prompt'];
    let repos: string[] | undefined = flags.repos
      ? flags.repos.split(',').map(s => s.trim())
      : undefined;

    // Interactive mode if name is missing
    if (!name || flags.interactive) {
      const resolver = new FlagResolver<{
        name?: string;
        description?: string;
        startHook?: string;
        endHook?: string;
        systemPrompt?: string;
        repos?: string;
      }>({
        commandName: 'profile create',
        baseCommand: 'prlt profile create',
        jsonMode,
        flags: {
          name,
          description,
          startHook,
          endHook,
          systemPrompt,
          repos: repos?.join(', '),
        },
      });

      resolver.addPrompt({
        flagName: 'name',
        type: 'input',
        message: 'Profile name:',
        default: name,
        when: (ctx) => !ctx.flags.name,
        validate: (value) => (value as string).trim() ? true : 'Name is required',
        context: {
          hint: 'Provide with: prlt profile create "Profile Name" [flags]',
          requiredFields: ['name (as first argument)'],
        },
      });

      resolver.addPrompt({
        flagName: 'description',
        type: 'input',
        message: 'Description (optional):',
        default: description || '',
        when: (ctx) => ctx.flags.name !== undefined && flags.interactive,
      });

      resolver.addPrompt({
        flagName: 'startHook',
        type: 'input',
        message: 'Start hook (shell command run at session start, optional):',
        default: startHook || '',
        when: (ctx) => ctx.flags.name !== undefined && flags.interactive,
        context: {
          hint: 'Example: prlt ticket show $TICKET_ID > /tmp/context.md',
        },
      });

      resolver.addPrompt({
        flagName: 'endHook',
        type: 'input',
        message: 'End hook (shell command run before exit, optional):',
        default: endHook || '',
        when: (ctx) => ctx.flags.name !== undefined && flags.interactive,
        context: {
          hint: 'Example: prlt retro generate $TICKET_ID',
        },
      });

      resolver.addPrompt({
        flagName: 'systemPrompt',
        type: 'multiline',
        message: 'System prompt (additional instructions, optional):',
        default: systemPrompt || '',
        when: (ctx) => ctx.flags.name !== undefined && flags.interactive,
      });

      resolver.addPrompt({
        flagName: 'repos',
        type: 'input',
        message: 'Repos (comma-separated names, optional):',
        default: repos?.join(', ') || '',
        when: (ctx) => ctx.flags.name !== undefined && flags.interactive,
      });

      const resolved = await resolver.resolve();

      name = resolved.name || name;
      description = resolved.description || description;
      startHook = resolved.startHook || startHook;
      endHook = resolved.endHook || endHook;
      systemPrompt = resolved.systemPrompt || systemPrompt;
      if (resolved.repos) {
        repos = resolved.repos.split(',').map(s => s.trim()).filter(Boolean);
      }
    }

    if (!name) {
      this.error('Profile name is required.');
    }

    const profile = await this.storage.createProfile({
      name,
      description: description || undefined,
      startHook: startHook || undefined,
      endHook: endHook || undefined,
      systemPrompt: systemPrompt || undefined,
      repos: repos?.length ? repos : undefined,
    });

    if (jsonMode) {
      this.log(JSON.stringify(profile, null, 2));
      return;
    }

    this.log(styles.success(`\nCreated profile "${styles.emphasis(profile.name)}" (${profile.id})`));
    if (profile.description) {
      this.log(styles.muted(`  ${profile.description}`));
    }
    if (profile.startHook) {
      this.log(styles.muted(`  Start hook: ${profile.startHook}`));
    }
    if (profile.endHook) {
      this.log(styles.muted(`  End hook: ${profile.endHook}`));
    }
    if (profile.repos?.length) {
      this.log(styles.muted(`  Repos: ${profile.repos.join(', ')}`));
    }
    this.log('');
    this.log(styles.muted(`Use with: prlt work spawn TKT-001 --profile ${profile.id}`));
  }
}
