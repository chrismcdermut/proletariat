import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';
import { AgentProfile } from '../../lib/pmo/types.js';

export default class ProfileEdit extends PMOCommand {
  static description = 'Edit an existing agent profile';

  static examples = [
    '<%= config.bin %> <%= command.id %> frontend-specialist --description "Updated description"',
    '<%= config.bin %> <%= command.id %> retro-enabled --start-hook "prlt ticket show $TICKET_ID"',
    '<%= config.bin %> <%= command.id %> my-profile  # Interactive mode',
  ];

  static args = {
    id: Args.string({
      description: 'Profile ID to edit',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    name: Flags.string({
      char: 'n',
      description: 'New profile name',
    }),
    description: Flags.string({
      char: 'd',
      description: 'New description',
    }),
    'start-hook': Flags.string({
      description: 'New start hook command',
    }),
    'end-hook': Flags.string({
      description: 'New end hook command',
    }),
    'system-prompt': Flags.string({
      description: 'New system prompt',
    }),
    repos: Flags.string({
      description: 'New allowed repos (comma-separated)',
    }),
    'mcp-servers': Flags.string({
      description: 'New MCP server configs as JSON array',
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
    const { args, flags } = await this.parse(ProfileEdit);

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('profile edit', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const existingProfile = await this.storage.getProfile(args.id);
    if (!existingProfile) {
      return handleError('PROFILE_NOT_FOUND', `Profile not found: ${args.id}`);
    }

    const hasFlags = flags.name || flags.description !== undefined ||
                     flags['start-hook'] !== undefined || flags['end-hook'] !== undefined ||
                     flags['system-prompt'] !== undefined || flags.repos !== undefined ||
                     flags['mcp-servers'] !== undefined;

    const changes: Partial<AgentProfile> = {};

    if (!hasFlags || flags.interactive) {
      const resolver = new FlagResolver<{
        name?: string;
        description?: string;
        startHook?: string;
        endHook?: string;
        systemPrompt?: string;
        repos?: string;
      }>({
        commandName: 'profile edit',
        baseCommand: `prlt profile edit ${args.id}`,
        jsonMode,
        flags: {
          name: flags.name,
          description: flags.description,
          startHook: flags['start-hook'],
          endHook: flags['end-hook'],
          systemPrompt: flags['system-prompt'],
        },
      });

      resolver.addPrompt({
        flagName: 'name',
        type: 'input',
        message: 'Name:',
        default: existingProfile.name,
        context: {
          hint: `Provide with: prlt profile edit ${args.id} --name "New Name"`,
          currentValue: existingProfile.name,
        },
      });

      resolver.addPrompt({
        flagName: 'description',
        type: 'input',
        message: 'Description:',
        default: existingProfile.description || '',
        when: (ctx) => ctx.flags.name !== undefined,
      });

      resolver.addPrompt({
        flagName: 'startHook',
        type: 'input',
        message: 'Start hook (shell command):',
        default: existingProfile.startHook || '',
        when: (ctx) => ctx.flags.description !== undefined,
      });

      resolver.addPrompt({
        flagName: 'endHook',
        type: 'input',
        message: 'End hook (shell command):',
        default: existingProfile.endHook || '',
        when: (ctx) => ctx.flags.startHook !== undefined,
      });

      resolver.addPrompt({
        flagName: 'systemPrompt',
        type: 'input',
        message: 'System prompt:',
        default: existingProfile.systemPrompt || '',
        when: (ctx) => ctx.flags.endHook !== undefined,
      });

      resolver.addPrompt({
        flagName: 'repos',
        type: 'input',
        message: 'Allowed repos (comma-separated):',
        default: existingProfile.repos?.join(', ') || '',
        when: (ctx) => ctx.flags.systemPrompt !== undefined,
      });

      this.log('');
      this.log(styles.header(`Editing profile: ${existingProfile.name}`));
      this.log(styles.muted('Press Enter to keep current value, or enter new value.'));
      this.log('');

      const resolved = await resolver.resolve();

      if (resolved.name !== existingProfile.name) changes.name = resolved.name;
      if (resolved.description !== (existingProfile.description || '')) changes.description = resolved.description;
      if (resolved.startHook !== (existingProfile.startHook || '')) changes.startHook = resolved.startHook;
      if (resolved.endHook !== (existingProfile.endHook || '')) changes.endHook = resolved.endHook;
      if (resolved.systemPrompt !== (existingProfile.systemPrompt || '')) changes.systemPrompt = resolved.systemPrompt;
      if (resolved.repos) {
        const newRepos = (resolved.repos as string).split(',').map(s => s.trim()).filter(Boolean);
        const existingRepos = existingProfile.repos || [];
        if (JSON.stringify(newRepos.sort()) !== JSON.stringify([...existingRepos].sort())) {
          changes.repos = newRepos;
        }
      }
    } else {
      if (flags.name) changes.name = flags.name;
      if (flags.description !== undefined) changes.description = flags.description;
      if (flags['start-hook'] !== undefined) changes.startHook = flags['start-hook'];
      if (flags['end-hook'] !== undefined) changes.endHook = flags['end-hook'];
      if (flags['system-prompt'] !== undefined) changes.systemPrompt = flags['system-prompt'];
      if (flags.repos !== undefined) {
        changes.repos = flags.repos ? flags.repos.split(',').map(s => s.trim()) : [];
      }
      if (flags['mcp-servers'] !== undefined) {
        changes.mcpServers = flags['mcp-servers'] ? JSON.parse(flags['mcp-servers']) : [];
      }
    }

    if (Object.keys(changes).length === 0) {
      this.log(styles.muted('No changes made.'));
      return;
    }

    const profile = await this.storage.updateProfile(args.id, changes);

    this.log(styles.success(`\nUpdated profile "${styles.emphasis(profile.name)}"`));
    if (changes.name) this.log(styles.muted(`  Name: ${profile.name}`));
    if (changes.description !== undefined) this.log(styles.muted(`  Description: ${profile.description || '(none)'}`));
    if (changes.startHook !== undefined) this.log(styles.muted(`  Start hook: ${profile.startHook || '(none)'}`));
    if (changes.endHook !== undefined) this.log(styles.muted(`  End hook: ${profile.endHook || '(none)'}`));
    if (changes.systemPrompt !== undefined) this.log(styles.muted(`  System prompt: (updated)`));
    if (changes.repos !== undefined) this.log(styles.muted(`  Repos: ${profile.repos?.join(', ') || '(none)'}`));
  }
}
