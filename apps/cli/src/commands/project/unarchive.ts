import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class ProjectUnarchive extends PMOCommand {
  static description = 'Unarchive a project (restore to default views)';

  static examples = [
    '<%= config.bin %> <%= command.id %> old-project',
  ];

  static args = {
    id: Args.string({
      description: 'Project ID',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args } = await this.parse(ProjectUnarchive);

    const project = await this.storage.getProject(args.id);
    if (!project) {
      this.error(`Project "${args.id}" not found.`);
    }

    if (!project.isArchived) {
      this.log(styles.muted(`Project "${project.name}" is not archived.`));
      return;
    }

    await this.storage.unarchiveProject(args.id);

    this.log(styles.success(`\nUnarchived project "${project.name}"`));
    this.log(styles.muted('View project: prlt project view ' + args.id));
  }
}
