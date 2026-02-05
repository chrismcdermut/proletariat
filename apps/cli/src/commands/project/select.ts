import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { findHQPath } from '../../lib/pmo/find-pmo.js';
import { getSelectedProject, setSelectedProject } from '../../lib/workspace-config.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class ProjectSelect extends PMOCommand {
  static description = 'Select a default project for subsequent commands';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> my-project',
    '<%= config.bin %> <%= command.id %> --clear',
  ];

  static args = {
    id: Args.string({
      description: 'Project ID to select as default',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    clear: Flags.boolean({
      char: 'c',
      description: 'Clear the selected project',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ProjectSelect);
    const jsonMode = shouldOutputJson(flags);

    // Find HQ path for config storage
    const hqPath = findHQPath();
    if (!hqPath) {
      if (jsonMode) {
        outputErrorAsJson('HQ_NOT_FOUND', 'No HQ workspace found', createMetadata('project select', flags));
        this.exit(1);
      }
      this.error('No HQ workspace found. Run "prlt init" first.');
    }

    // Handle --clear flag
    if (flags.clear) {
      const previousProject = getSelectedProject(hqPath);
      setSelectedProject(hqPath, null);

      if (jsonMode) {
        outputSuccessAsJson(
          { cleared: true, previousProject },
          createMetadata('project select', flags)
        );
        return;
      }

      if (previousProject) {
        this.log(styles.success(`Cleared selected project: ${styles.emphasis(previousProject)}`));
      } else {
        this.log(styles.muted('No project was selected.'));
      }
      return;
    }

    // Get project ID from args or prompt
    let projectId = args.id;

    if (!projectId) {
      // Show list of projects to select from
      const projects = await this.storage.listProjects({ isArchived: false });

      if (projects.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_PROJECTS', 'No projects found', createMetadata('project select', flags));
          this.exit(1);
        }
        this.error('No projects found. Create one with: prlt project create');
      }

      // Sort projects by leading number in name
      const sortedProjects = [...projects].sort((a, b) => {
        const numA = parseInt(a.name.match(/^(\d+)/)?.[1] || '999', 10);
        const numB = parseInt(b.name.match(/^(\d+)/)?.[1] || '999', 10);
        return numA - numB;
      });

      // Get current selection for display
      const currentSelection = getSelectedProject(hqPath);

      const selected = await this.selectFromList({
        message: 'Select default project:',
        items: sortedProjects,
        getName: (p) => {
          const marker = p.id === currentSelection ? ' (current)' : '';
          return `${p.name} (${p.id})${marker}`;
        },
        getValue: (p) => p.id,
        getCommand: (p) => `prlt project select ${p.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'project select' } : null,
        allowCancel: true,
      });

      if (!selected) {
        return;
      }

      projectId = selected;
    }

    // Validate project exists and is not archived
    const project = await this.storage.getProject(projectId);
    if (!project) {
      if (jsonMode) {
        outputErrorAsJson('PROJECT_NOT_FOUND', `Project "${projectId}" not found`, createMetadata('project select', flags));
        this.exit(1);
      }
      this.error(`Project "${projectId}" not found.`);
    }

    if (project.isArchived) {
      if (jsonMode) {
        outputErrorAsJson('PROJECT_ARCHIVED', `Project "${projectId}" is archived`, createMetadata('project select', flags));
        this.exit(1);
      }
      this.error(`Cannot select archived project "${projectId}". Unarchive it first with: prlt project unarchive ${projectId}`);
    }

    // Save selection
    setSelectedProject(hqPath, project.id);

    if (jsonMode) {
      outputSuccessAsJson(
        { projectId: project.id, projectName: project.name },
        createMetadata('project select', flags)
      );
      return;
    }

    this.log(styles.success(`Selected project: ${styles.emphasis(project.name)}`));
    this.log(styles.muted(`  ID: ${project.id}`));
    this.log('');
    this.log(styles.muted('This project will be used as default when -P flag is not provided.'));
    this.log(styles.muted('Use "prlt project select --clear" to clear the selection.'));
  }
}
