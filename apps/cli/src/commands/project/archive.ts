import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class ProjectArchive extends PMOCommand {
  static description = 'Archive a project (hide from default views)';

  static examples = [
    '<%= config.bin %> <%= command.id %> old-project',
    '<%= config.bin %> <%= command.id %> old-project --force',
  ];

  static args = {
    id: Args.string({
      description: 'Project ID',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ProjectArchive);

    const project = await this.storage.getProject(args.id);
    if (!project) {
      this.error(`Project "${args.id}" not found.`);
    }

    if (project.isArchived) {
      this.log(styles.muted(`Project "${project.name}" is already archived.`));
      return;
    }

    if (!flags.force) {
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
        type: 'confirm',
        name: 'confirm',
        message: `Archive project "${project.name}"? It will be hidden from default views.`,
        default: false,
      }]);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    await this.storage.archiveProject(args.id);

    this.log(styles.success(`\nArchived project "${project.name}"`));
    this.log(styles.muted('View archived projects: prlt project list --archived'));
    this.log(styles.muted('Unarchive: prlt project unarchive ' + args.id));
  }
}
