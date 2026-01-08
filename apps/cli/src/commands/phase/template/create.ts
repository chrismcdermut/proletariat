import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class PhaseTemplateCreate extends PMOCommand {
  static description = 'Create a new phase template from current workspace phases';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Custom Phases"',
    '<%= config.bin %> <%= command.id %> "Enterprise" --description "Enterprise project lifecycle"',
  ];

  static args = {
    name: Args.string({
      description: 'Name for the new template',
      required: true,
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

    const template = await this.storage.savePhaseTemplate(args.name, flags.description);

    this.log(styles.success(`\nCreated phase template "${styles.emphasis(template.name)}" (${template.id})`));
    this.log(styles.muted(`Saved ${template.phases.length} phases:`));
    for (const phase of template.phases) {
      const defaultBadge = phase.isDefault ? ' (default)' : '';
      this.log(styles.muted(`  • ${phase.name} [${phase.category}]${defaultBadge}`));
    }
  }
}
