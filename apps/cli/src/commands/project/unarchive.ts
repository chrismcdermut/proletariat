import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

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
    const { args, flags } = await this.parse(ProjectUnarchive);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('project unarchive', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const project = await this.storage.getProject(args.id);
    if (!project) {
      return handleError('PROJECT_NOT_FOUND', `Project "${args.id}" not found.`);
    }

    if (!project.isArchived) {
      if (jsonMode) {
        outputSuccessAsJson(
          { projectId: project.id, projectName: project.name, alreadyUnarchived: true },
          createMetadata('project unarchive', flags)
        );
        return;
      }
      this.log(styles.muted(`Project "${project.name}" is not archived.`));
      return;
    }

    await this.storage.unarchiveProject(args.id);

    if (jsonMode) {
      outputSuccessAsJson(
        { projectId: project.id, projectName: project.name, unarchived: true },
        createMetadata('project unarchive', flags)
      );
      return;
    }

    this.log(styles.success(`\nUnarchived project "${project.name}"`));
    this.log(styles.muted('View project: prlt project view ' + args.id));
  }
}
