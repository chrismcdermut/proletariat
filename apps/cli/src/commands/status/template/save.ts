import { Command, Flags, Args } from '@oclif/core';
import { getPMOContext } from '../../../lib/pmo/index.js';
import { styles } from '../../../lib/styles.js';

export default class StatusTemplateSave extends Command {
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
    project: Flags.string({
      char: 'P',
      description: 'Project ID to copy statuses from (default: current project)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Template description',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(StatusTemplateSave);

    const { storage, projectName, projectId } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Check if project has statuses
      const statuses = await storage.listStatuses(projectId);
      if (statuses.length === 0) {
        await storage.close();
        this.error(`Project "${projectName}" has no statuses to save.\nApply a template first: prlt status template apply kanban`);
      }

      // Save as template
      const template = await storage.saveTemplate(args.name, projectId, flags.description);

      await storage.close();

      this.log(styles.success(`\nCreated template "${styles.emphasis(template.name)}"`));
      this.log(styles.muted(`  ID: ${template.id}`));
      if (template.description) {
        this.log(styles.muted(`  Description: ${template.description}`));
      }
      this.log(styles.muted(`  Statuses: ${template.statuses.length}`));
      this.log('');
      this.log(styles.muted(`Apply to a project: prlt status template apply ${template.id}`));
    } catch (error) {
      await storage.close();
      if (error instanceof Error && error.message.includes('already exists')) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
