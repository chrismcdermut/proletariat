import { Command, Flags, Args } from '@oclif/core';
import { getPMOContext } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class PhaseTemplateUpdate extends Command {
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
    name: Flags.string({
      char: 'n',
      description: 'New template name',
    }),
    description: Flags.string({
      char: 'd',
      description: 'New template description',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PhaseTemplateUpdate);

    if (!flags.name && !flags.description) {
      this.error('Must provide --name or --description to update');
    }

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false
    );

    try {
      const changes: { name?: string; description?: string } = {};
      if (flags.name) changes.name = flags.name;
      if (flags.description !== undefined) changes.description = flags.description;

      const template = await storage.updatePhaseTemplate(args.id, changes);

      await storage.close();

      this.log(styles.success(`\nUpdated phase template "${styles.emphasis(template.name)}"`));
      if (flags.name) {
        this.log(styles.muted(`  Name: ${template.name}`));
      }
      if (flags.description !== undefined) {
        this.log(styles.muted(`  Description: ${template.description || '(none)'}`));
      }
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
