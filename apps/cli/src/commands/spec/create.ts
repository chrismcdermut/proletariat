import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { slugify } from '../../lib/pmo/utils.js';
import { SpecType, SpecStatus } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class SpecCreate extends PMOCommand {
  static description = 'Create a new spec';

  static examples = [
    '<%= config.bin %> <%= command.id %> "User Authentication"',
    '<%= config.bin %> <%= command.id %> --title "API Design" --type product',
    '<%= config.bin %> <%= command.id %> -i  # Interactive mode',
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
      description: 'Spec title',
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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecCreate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Get spec data
    let specData: {
      title: string;
      status: SpecStatus;
      type?: SpecType;
      problem?: string;
    };

    if (flags.interactive || (!args.title && !flags.title)) {
      // Build choices once, use for both JSON and interactive modes
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

      // In JSON mode, output form prompts
      if (jsonMode) {
        const formFields = [
          { type: 'input' as const, name: 'title', message: 'Spec title:', default: flags.title },
          { type: 'list' as const, name: 'type', message: 'Spec type:', choices: typeChoices, default: flags.type },
          { type: 'list' as const, name: 'status', message: 'Status:', choices: statusChoices, default: flags.status || 'draft' },
          { type: 'input' as const, name: 'problem', message: 'Problem statement (optional):', default: flags.problem },
        ];
        outputPromptAsJson(
          { type: 'form', fields: formFields },
          createMetadata('spec create', flags)
        );
        return;
      }

      specData = await this.promptSpecData(flags, typeChoices, statusChoices);
    } else {
      specData = {
        title: args.title || flags.title || 'Untitled Spec',
        status: (flags.status as SpecStatus) || 'draft',
        type: flags.type as SpecType | undefined,
        problem: flags.problem,
      };
    }

    // Generate ID from title
    const specId = slugify(specData.title);

    // Create spec in database
    const spec = await this.storage.createSpec({
      id: specId,
      title: specData.title,
      status: specData.status,
      type: specData.type,
      problem: specData.problem,
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

  private async promptSpecData(
    flags: {
      title?: string;
      status?: string;
      type?: string;
      problem?: string;
    },
    typeChoices: Array<{ name: string; value: string }>,
    statusChoices: Array<{ name: string; value: string }>
  ): Promise<{
    title: string;
    status: SpecStatus;
    type?: SpecType;
    problem?: string;
  }> {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'title',
        message: 'Spec title:',
        default: flags.title,
        validate: (input: string) => input.length > 0 || 'Title is required',
      },
      {
        type: 'list',
        name: 'type',
        message: 'Spec type:',
        choices: typeChoices.map(c => ({ ...c, value: c.value || undefined })),
        default: flags.type,
      },
      {
        type: 'list',
        name: 'status',
        message: 'Status:',
        choices: statusChoices,
        default: flags.status || 'draft',
      },
      {
        type: 'input',
        name: 'problem',
        message: 'Problem statement (optional):',
        default: flags.problem,
      },
    ]);

    return {
      title: answers.title,
      status: answers.status,
      type: answers.type,
      problem: answers.problem || undefined,
    };
  }
}
