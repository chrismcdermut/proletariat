import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class ProfileDelete extends PMOCommand {
  static description = 'Delete an agent profile';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-profile',
    '<%= config.bin %> <%= command.id %> my-profile --force',
  ];

  static args = {
    id: Args.string({
      description: 'Profile ID to delete',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ProfileDelete);

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('profile delete', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const profile = await this.storage.getProfile(args.id);

    if (!profile) {
      return handleError('PROFILE_NOT_FOUND', `Profile not found: ${args.id}`);
    }

    if (!flags.force) {
      const resolver = new FlagResolver<{ confirmed?: boolean }>({
        commandName: 'profile delete',
        baseCommand: `prlt profile delete ${args.id}`,
        jsonMode,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'confirmed',
        type: 'list',
        message: `Delete profile "${profile.name}"?`,
        choices: () => [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
        getCommand: (value) => value
          ? `prlt profile delete ${args.id} --force --json`
          : '',
      });

      const resolved = await resolver.resolve();

      if (!resolved.confirmed) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    await this.storage.deleteProfile(args.id);

    this.log(styles.success(`\nDeleted profile "${profile.name}"`));
  }
}
