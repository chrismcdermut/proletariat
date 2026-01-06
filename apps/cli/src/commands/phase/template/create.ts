import { Command, Flags, Args } from '@oclif/core';
import { getPMOContext } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class PhaseTemplateCreate extends Command {
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
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PhaseTemplateCreate);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false
    );

    try {
      const template = await storage.savePhaseTemplate(args.name, flags.description);

      await storage.close();

      this.log(styles.success(`\nCreated phase template "${styles.emphasis(template.name)}" (${template.id})`));
      this.log(styles.muted(`Saved ${template.phases.length} phases:`));
      for (const phase of template.phases) {
        const defaultBadge = phase.isDefault ? ' (default)' : '';
        this.log(styles.muted(`  • ${phase.name} [${phase.category}]${defaultBadge}`));
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
