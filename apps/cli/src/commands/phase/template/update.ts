import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class PhaseTemplateUpdate extends PMOCommand {
  static description = 'Update a phase template';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-template --name "New Name"',
    '<%= config.bin %> <%= command.id %> my-template --description "Updated description"',
  ];

  static args = {
    id: Args.string({
      description: 'Template ID to update',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    name: Flags.string({
      char: 'n',
      description: 'New template name',
    }),
    description: Flags.string({
      char: 'd',
      description: 'New template description',
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(PhaseTemplateUpdate);

    if (!flags.name && !flags.description) {
      this.error('Must provide --name or --description to update');
    }

    const changes: { name?: string; description?: string } = {};
    if (flags.name) changes.name = flags.name;
    if (flags.description !== undefined) changes.description = flags.description;

    const template = await this.storage.updatePhaseTemplate(args.id, changes);

    this.log(styles.success(`\nUpdated phase template "${styles.emphasis(template.name)}"`));
    if (flags.name) {
      this.log(styles.muted(`  Name: ${template.name}`));
    }
    if (flags.description !== undefined) {
      this.log(styles.muted(`  Description: ${template.description || '(none)'}`));
    }
  }
}
