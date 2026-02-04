import { Flags, Args } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../../lib/prompt-json.js';
import { FlagResolver } from '../../../lib/flags/index.js';

export default class PhaseTemplateCreate extends PMOCommand {
  static description = 'Create a new phase template from current workspace phases';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Custom Phases"',
    '<%= config.bin %> <%= command.id %> "Enterprise" --description "Enterprise project lifecycle"',
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

    const jsonMode = shouldOutputJson(flags);

    const resolver = new FlagResolver<{ name?: string; description?: string }>({
      commandName: 'phase template create',
      baseCommand: 'prlt phase template create',
      jsonMode,
      flags: { name: args.name, description: flags.description },
    });

    resolver.addPrompt({
      flagName: 'name',
      type: 'input',
      message: 'Template name:',
      validate: (input: string) => (input as string).length > 0 || 'Name is required',
      when: (ctx) => !ctx.flags.name,
    });

    resolver.addPrompt({
      flagName: 'description',
      type: 'input',
      message: 'Description (optional):',
      when: (ctx) => ctx.flags.description === undefined,
    });

    const resolved = await resolver.resolve();

    const templateName = resolved.name!;
    const description = resolved.description || undefined;

    const template = await this.storage.savePhaseTemplate(templateName, description);

    if (jsonMode) {
      outputSuccessAsJson({
        id: template.id,
        name: template.name,
        description: template.description,
        phaseCount: template.phases.length,
        phases: template.phases.map(p => ({
          name: p.name,
          category: p.category,
          isDefault: p.isDefault,
        })),
      }, createMetadata('phase template create', flags));
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
