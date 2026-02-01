import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

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

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('project archive', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const project = await this.storage.getProject(args.id);
    if (!project) {
      return handleError('PROJECT_NOT_FOUND', `Project "${args.id}" not found.`);
    }

    if (project.isArchived) {
      if (jsonMode) {
        outputSuccessAsJson(
          { projectId: project.id, projectName: project.name, alreadyArchived: true },
          createMetadata('project archive', flags)
        );
        return;
      }
      this.log(styles.muted(`Project "${project.name}" is already archived.`));
      return;
    }

    // Agent mode config for prompts
    const agentConfig = jsonMode ? { flags, commandName: 'project archive' } : null;

    if (!flags.force) {
      const { confirm } = await this.agentPrompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: `Archive project "${project.name}"? It will be hidden from default views.`,
        choices: [
          { name: 'No', value: false, command: '' },
          { name: 'Yes', value: true, command: `prlt project archive ${args.id} --force --json` },
        ],
      }], agentConfig);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    await this.storage.archiveProject(args.id);

    if (jsonMode) {
      outputSuccessAsJson(
        { projectId: project.id, projectName: project.name, archived: true },
        createMetadata('project archive', flags)
      );
      return;
    }

    this.log(styles.success(`\nArchived project "${project.name}"`));
    this.log(styles.muted('View archived projects: prlt project list --archived'));
    this.log(styles.muted('Unarchive: prlt project unarchive ' + args.id));
  }
}
