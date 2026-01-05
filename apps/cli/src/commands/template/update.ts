import { Command, Flags, Args } from '@oclif/core';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TemplateUpdate extends Command {
  static description = 'Update a workflow template';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-template --name "New Name"',
    '<%= config.bin %> <%= command.id %> my-template --description "Updated description"',
  ];

  static args = {
    id: Args.string({
      description: 'Template ID',
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
    const { args, flags } = await this.parse(TemplateUpdate);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false
    );

    try {
      // Check if any changes specified
      if (!flags.name && flags.description === undefined) {
        await storage.close();
        this.error('No changes specified. Use --name or --description.');
      }

      const template = await storage.updateTemplate(args.id, {
        name: flags.name,
        description: flags.description,
      });

      await storage.close();

      this.log(styles.success(`\nUpdated template "${styles.emphasis(template.name)}"`));
      this.log(styles.muted(`  ID: ${template.id}`));
      if (template.description) {
        this.log(styles.muted(`  Description: ${template.description}`));
      }
      this.log(styles.muted(`  Statuses: ${template.statuses.length}`));
    } catch (error) {
      await storage.close();
      if (error instanceof Error) {
        if (error.message.includes('not found') || error.message.includes('Cannot modify')) {
          this.error(error.message);
        }
      }
      throw error;
    }
  }
}
