import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { slugify } from '../../lib/pmo/utils.js';
import { SpecType, SpecStatus } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputDryRunSuccessAsJson,
  outputDryRunErrorsAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';
import { multiLineInput } from '../../lib/multiline-input.js';

export default class SpecCreate extends PMOCommand {
  static description = 'Create a new spec';

  static examples = [
    '<%= config.bin %> <%= command.id %> "User Authentication"',
    '<%= config.bin %> <%= command.id %> --title "API Design" --type product',
    '<%= config.bin %> <%= command.id %> -i  # Interactive mode',
    '<%= config.bin %> <%= command.id %> --title "Test" --dry-run --json  # Validate without creating',
  ];

  static args = {
    title: Args.string({
      description: 'Spec title',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    title: Flags.string({
      char: 't',
      description: 'Spec title [required for non-interactive]',
    }),
    status: Flags.string({
      char: 's',
      description: 'Spec status',
      options: ['draft', 'active', 'implemented'],
      default: 'draft',
    }),
    type: Flags.string({
      description: 'Spec type',
      options: ['product', 'platform', 'infra', 'integration'],
    }),
    problem: Flags.string({
      description: 'Problem statement',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Validate inputs without creating spec (use with --json for structured output)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecCreate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Build choices for prompts
    const typeChoices = [
      { name: 'Product (user-facing feature)', value: 'product' },
      { name: 'Platform (internal tooling)', value: 'platform' },
      { name: 'Infra (technical infrastructure)', value: 'infra' },
      { name: 'Integration (external service)', value: 'integration' },
      { name: 'None', value: '' },
    ];
    const statusChoices = [
      { name: 'Draft (planning)', value: 'draft' },
      { name: 'Active (in progress)', value: 'active' },
      { name: 'Implemented (complete)', value: 'implemented' },
    ];

    // Use FlagResolver for all fields
    const resolver = new FlagResolver<{
      title?: string;
      type?: string;
      status?: string;
      problem?: string;
    }>({
      commandName: 'spec create',
      baseCommand: 'prlt spec create',
      jsonMode,
      flags: {
        title: args.title || flags.title,
        type: flags.type,
        status: flags.status || 'draft',
        problem: flags.problem,
      },
    });

    // Only prompt if interactive mode or no title provided
    const needsPrompts = flags.interactive || (!args.title && !flags.title);

    if (needsPrompts) {
      resolver.addPrompt({
        flagName: 'title',
        type: 'input',
        message: 'Spec title:',
        validate: (value) => (value as string).trim() ? true : 'Title cannot be empty',
        when: (ctx) => !ctx.flags.title,
      });

      resolver.addPrompt({
        flagName: 'type',
        type: 'list',
        message: 'Spec type:',
        choices: () => typeChoices,
        when: (ctx) => !ctx.flags.type && ctx.flags.title !== undefined,
      });

      resolver.addPrompt({
        flagName: 'status',
        type: 'list',
        message: 'Status:',
        choices: () => statusChoices,
        default: 'draft',
        when: (ctx) => ctx.flags.title !== undefined,
      });

      resolver.addPrompt({
        flagName: 'problem',
        type: 'multiline',
        message: 'Problem statement (optional):',
        when: (ctx) => ctx.flags.title !== undefined,
      });
    }

    const resolved = await resolver.resolve();

    // Convert empty type to undefined
    const specType = resolved.type === '' ? undefined : resolved.type as SpecType | undefined;

    // Generate ID from title
    const specId = slugify(resolved.title!);

    // Check if spec already exists
    const existing = await this.storage.getSpec(specId);
    if (existing) {
      if (flags['dry-run']) {
        if (jsonMode) {
          outputDryRunErrorsAsJson(
            [{ field: 'id', error: `Spec "${specId}" already exists` }],
            createMetadata('spec create', flags)
          );
        }
      }
      this.error(`Spec "${specId}" already exists.`);
    }

    // Handle dry-run: show what would be created without actually creating
    if (flags['dry-run']) {
      const wouldCreate = {
        id: specId,
        title: resolved.title!,
        status: resolved.status || 'draft',
        ...(specType && { type: specType }),
        ...(resolved.problem && { problem: resolved.problem }),
      };

      if (jsonMode) {
        outputDryRunSuccessAsJson('spec', wouldCreate, createMetadata('spec create', flags));
      }

      // Human-readable dry-run output
      this.log(styles.warning('\n[DRY RUN] Would create spec:'));
      this.log(styles.muted(`   ID: ${specId}`));
      this.log(styles.muted(`   Title: ${resolved.title}`));
      this.log(styles.muted(`   Status: ${resolved.status || 'draft'}`));
      if (specType) {
        this.log(styles.muted(`   Type: ${specType}`));
      }
      if (resolved.problem) {
        this.log(styles.muted(`   Problem: ${resolved.problem}`));
      }
      this.log(styles.muted('\n(No spec was created)'));
      return;
    }

    // Create spec in database
    const spec = await this.storage.createSpec({
      id: specId,
      title: resolved.title!,
      status: (resolved.status as SpecStatus) || 'draft',
      type: specType,
      problem: resolved.problem || undefined,
    });

    this.log(styles.success(`\n✅ Created spec "${styles.emphasis(spec.title)}"`));
    this.log(styles.muted(`  ID: ${spec.id}`));
    this.log(styles.muted(`  Status: ${spec.status}`));
    if (spec.type) this.log(styles.muted(`  Type: ${spec.type}`));
    this.log(styles.muted(`\nNext steps:`));
    this.log(styles.muted(`  1. prlt spec view ${spec.id}`));
    this.log(styles.muted(`  2. prlt spec edit ${spec.id}  (to add details)`));
    this.log(styles.muted(`  3. prlt spec plan ${spec.id}  (to generate tickets)`));
  }
}
