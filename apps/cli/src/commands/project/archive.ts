import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
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
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
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
        outputErrorAsJson('ALREADY_ARCHIVED', `Project "${project.name}" is already archived.`, createMetadata('project archive', flags));
        return;
      }
      this.log(styles.muted(`Project "${project.name}" is already archived.`));
      return;
    }

    if (!flags.force) {
      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        const confirmChoices = [
          { name: 'No', value: 'false' },
          { name: 'Yes', value: 'true' },
        ];
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', `Archive project "${project.name}"? It will be hidden from default views.`, confirmChoices),
          createMetadata('project archive', flags)
        );
        return;
      }

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
