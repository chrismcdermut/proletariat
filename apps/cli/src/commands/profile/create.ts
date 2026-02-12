import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class ProfileCreate extends PMOCommand {
  static description = 'Create a new agent profile';

  static examples = [
    '<%= config.bin %> <%= command.id %> "frontend-specialist" --system-prompt "Focus on React components"',
    '<%= config.bin %> <%= command.id %> "retro-enabled" --start-hook "prlt ticket show $TICKET_ID" --end-hook "prlt retro generate"',
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
      description: 'Short description of this profile',
    }),
    'start-hook': Flags.string({
      description: 'Shell command(s) to run when session begins',
    }),
    'end-hook': Flags.string({
      description: 'Shell command(s) to run before exit',
    }),
    'system-prompt': Flags.string({
      description: 'Additional context/instructions for agent',
    }),
    repos: Flags.string({
      description: 'Allowed repos (comma-separated)',
    }),
    'mcp-servers': Flags.string({
      description: 'MCP server configs as JSON array',
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
    const { args, flags } = await this.parse(ProfileCreate);

    const jsonMode = shouldOutputJson(flags);

    let name = args.name;
    let description = flags.description;
    let startHook = flags['start-hook'];
    let endHook = flags['end-hook'];
    let systemPrompt = flags['system-prompt'];
    let repos: string[] | undefined = flags.repos ? flags.repos.split(',').map(s => s.trim()) : undefined;
    let mcpServers = flags['mcp-servers'] ? JSON.parse(flags['mcp-servers']) : undefined;

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
          hint: 'Provide with: prlt profile create "profile-name"',
          requiredFields: ['name (as first argument)'],
        },
      });

      resolver.addPrompt({
        flagName: 'description',
        type: 'input',
        message: 'Description (optional):',
        default: description || '',
        when: (ctx) => ctx.flags.name !== undefined,
      });

      if (flags.interactive) {
        resolver.addPrompt({
          flagName: 'startHook',
          type: 'input',
          message: 'Start hook (shell command, optional):',
          default: startHook || '',
          when: (ctx) => ctx.flags.name !== undefined,
        });

        resolver.addPrompt({
          flagName: 'endHook',
          type: 'input',
          message: 'End hook (shell command, optional):',
          default: endHook || '',
          when: (ctx) => ctx.flags.name !== undefined,
        });

        resolver.addPrompt({
          flagName: 'systemPrompt',
          type: 'input',
          message: 'System prompt (additional agent instructions, optional):',
          default: systemPrompt || '',
          when: (ctx) => ctx.flags.name !== undefined,
        });

        resolver.addPrompt({
          flagName: 'repos',
          type: 'input',
          message: 'Allowed repos (comma-separated, optional):',
          default: repos?.join(', ') || '',
          when: (ctx) => ctx.flags.name !== undefined,
        });
      }

      const resolved = await resolver.resolve();

      name = resolved.name || name;
      description = resolved.description || description;
      startHook = resolved.startHook || startHook;
      endHook = resolved.endHook || endHook;
      systemPrompt = resolved.systemPrompt || systemPrompt;
      if (resolved.repos && (resolved.repos as string).trim()) {
        repos = (resolved.repos as string).split(',').map(s => s.trim());
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
      repos,
      mcpServers,
    });

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
    this.log('');
    this.log(styles.muted(`Use with: prlt work spawn TKT-001 --profile ${profile.id}`));
  }
}
