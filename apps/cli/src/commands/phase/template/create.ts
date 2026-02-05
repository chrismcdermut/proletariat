import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import { shouldOutputJson, outputSuccessAsJson, createMetadata } from '../../../lib/prompt-json.js';
import { FlagResolver } from '../../../lib/flags/index.js';

export default class PhaseTemplateCreate extends PMOCommand {
  static description = 'Create a new phase template from current workspace phases';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Custom Phases"',
    '<%= config.bin %> <%= command.id %> "Enterprise" --description "Enterprise project lifecycle"',
    '<%= config.bin %> <%= command.id %> "My Phases" --description "Custom phases" --json',
  ];

  static args = {
    name: Args.string({
      description: 'Name for the new template',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PhaseTemplateCreate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Build base command with positional arg if name provided
    const baseCmd = args.name
      ? `prlt phase template create "${args.name}"`
      : 'prlt phase template create';

    // Use FlagResolver for unified JSON mode and interactive handling
    const resolver = new FlagResolver<{
      name?: string;
      description?: string;
      machine?: boolean;
      json?: boolean;
    }>({
      commandName: 'phase template create',
      baseCommand: baseCmd,
      jsonMode,
      flags: {
        description: flags.description,
        machine: flags.machine,
        json: flags.json,
      },
      args: { name: args.name },
    });

    // Name prompt - required (only if not provided as positional arg)
    if (!args.name) {
      resolver.addPrompt({
        flagName: 'name',
        type: 'input',
        message: 'Template name:',
        validate: (value) => (value as string).length > 0 || 'Name is required',
        context: {
          hint: 'Provide name with: prlt phase template create "Template Name"',
          example: 'prlt phase template create "My Phases" --description "Custom phases"',
        },
        // For input prompts, the agent will re-run with the positional arg
        getCommand: (value) => `prlt phase template create "${value}" --json`,
      });
    }

    // Description prompt - optional (only in interactive mode without --json)
    if (!jsonMode && args.name && flags.description === undefined) {
      resolver.addPrompt({
        flagName: 'description',
        type: 'input',
        message: 'Description (optional):',
      });
    }

    // Resolve missing flags
    const resolved = await resolver.resolve();

    // Get name from args or resolved (for interactive mode)
    const templateName = args.name || (resolved as { name?: string }).name;

    // Validate required fields
    if (!templateName) {
      this.error('Name is required. Provide as positional argument: prlt phase template create "Template Name"');
    }

    // Get description from flags or resolved
    const description = flags.description ?? resolved.description ?? undefined;

    const template = await this.storage.savePhaseTemplate(templateName, description);

    // Output as JSON in machine mode
    if (jsonMode) {
      outputSuccessAsJson(
        {
          id: template.id,
          name: template.name,
          description: template.description,
          phasesCount: template.phases.length,
          phases: template.phases.map(p => ({
            name: p.name,
            category: p.category,
            isDefault: p.isDefault,
          })),
        },
        createMetadata('phase template create', flags as Record<string, unknown>)
      );
      return;
    }

    this.log(styles.success(`\nCreated phase template "${styles.emphasis(template.name)}" (${template.id})`));
    this.log(styles.muted(`Saved ${template.phases.length} phases:`));
    for (const phase of template.phases) {
      const defaultBadge = phase.isDefault ? ' (default)' : '';
      this.log(styles.muted(`  • ${phase.name} [${phase.category}]${defaultBadge}`));
    }
  }
}
