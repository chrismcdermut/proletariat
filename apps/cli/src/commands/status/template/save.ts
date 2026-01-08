import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class StatusTemplateSave extends PMOCommand {
  static description = 'Save current project workflow as a reusable template';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Custom Workflow"',
    '<%= config.bin %> <%= command.id %> "Team Workflow" --project my-project',
    '<%= config.bin %> <%= command.id %> "Sprint Board" --description "Agile sprint workflow"',
  ];

  static args = {
    name: Args.string({
      description: 'Template name',
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

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(StatusTemplateSave);

    // Check if project has statuses
    const statuses = await this.storage.listStatuses(this.projectId);
    if (statuses.length === 0) {
      this.error(`Project "${this.projectName}" has no statuses to save.\nApply a template first: prlt status template apply kanban`);
    }

    // Save as template
    try {
      const template = await this.storage.saveTemplate(args.name, this.projectId, flags.description);

      this.log(styles.success(`\nCreated template "${styles.emphasis(template.name)}"`));
      this.log(styles.muted(`  ID: ${template.id}`));
      if (template.description) {
        this.log(styles.muted(`  Description: ${template.description}`));
      }
      this.log(styles.muted(`  Statuses: ${template.statuses.length}`));
      this.log('');
      this.log(styles.muted(`Apply to a project: prlt status template apply ${template.id}`));
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
