import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';

export default class SpecDelete extends PMOCommand {
  static description = 'Delete a spec';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-spec',
    '<%= config.bin %> <%= command.id %> my-spec --force',
    '<%= config.bin %> <%= command.id %>  # Interactive selection',
  ];

  static args = {
    id: Args.string({
      description: 'Spec ID to delete',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecDelete);
    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('spec delete', flags));
        this.exit(1);
      }
      this.error(message);
    };

    let specId = args.id;

    // Interactive selection if no ID provided
    if (!specId) {
      const specs = await this.storage.listSpecs();
      if (specs.length === 0) {
        return handleError('NO_SPECS', 'No specs found');
      }

      const resolver = new FlagResolver<{ spec?: string }>({
        commandName: 'spec delete',
        baseCommand: 'prlt spec delete',
        jsonMode,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'spec',
        type: 'list',
        message: 'Select spec to delete:',
        choices: () => specs.map(s => ({
          name: `${s.title} [${s.status}]${s.type ? ` (${s.type})` : ''}`,
          value: s.id,
        })),
        getCommand: (value) => `prlt spec delete ${value} --json`,
      });

      const resolved = await resolver.resolve();
      specId = resolved.spec;
    }

    // Get spec details
    const spec = await this.storage.getSpec(specId!);
    if (!spec) {
      return handleError('SPEC_NOT_FOUND', `Spec not found: ${specId}`);
    }

    // Confirmation prompt
    if (!flags.force) {
      const resolver = new FlagResolver<{ confirmed?: boolean }>({
        commandName: 'spec delete',
        baseCommand: `prlt spec delete ${specId}`,
        jsonMode,
        flags: {},
      });

      resolver.addPrompt({
        flagName: 'confirmed',
        type: 'list',
        message: `Delete spec "${spec.title}"?`,
        choices: () => [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
        getCommand: (value) => value
          ? `prlt spec delete ${specId} --force --json`
          : '',
      });

      const resolved = await resolver.resolve();

      if (!resolved.confirmed) {
        this.log(styles.muted('Cancelled'));
        return;
      }
    }

    // Delete the spec
    await this.storage.deleteSpec(specId!);

    // JSON response for agents
    if (jsonMode) {
      outputSuccessAsJson(
        {
          specId: spec.id,
          title: spec.title,
          deleted: true,
        },
        createMetadata('spec delete', flags)
      );
      return;
    }

    // Human-readable response
    this.log(styles.success(`\nDeleted spec "${styles.emphasis(spec.title)}"`));
  }
}
