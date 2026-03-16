import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
  buildFormPromptConfig,
  FormField,
} from '../../lib/prompt-json.js';

export default class ProjectUpdate extends PMOCommand {
  static description = 'Update project metadata (name, description)';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project --name "New Project Name"',
    '<%= config.bin %> <%= command.id %> my-project --description "Updated description"',
    '<%= config.bin %> <%= command.id %> my-project --name "New Name" --description "New description"',
    '<%= config.bin %> <%= command.id %> my-project  # Interactive mode',
  ];

  static args = {
    id: Args.string({
      description: 'Project ID or name',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    name: Flags.string({
      char: 'n',
      description: 'New project name',
    }),
    description: Flags.string({
      char: 'd',
      description: 'New project description',
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ProjectUpdate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('project update', flags));
        return
      }
      this.error(message);
    };

    // Get project ID - from args or prompt
    let projectId = args.id;

    if (!projectId) {
      // List available projects for selection
      const projects = await this.storage.listProjects({ isArchived: false });

      if (projects.length === 0) {
        return handleError('NO_PROJECTS', 'No projects found. Create one with: prlt project create');
      }

      const projectChoices = projects.map(p => ({
        name: `${p.id} - ${p.name}`,
        value: p.id,
        command: `prlt project update ${p.id} --json`,
      }));

      // Handle JSON mode for project selection
      if (jsonMode) {
        outputPromptAsJson(
          {
            type: 'list',
            name: 'projectId',
            message: 'Select project to update:',
            choices: projectChoices,
          },
          createMetadata('project update', flags)
        );
        return;
      }

      const { selectedProjectId } = await this.prompt<{ selectedProjectId: string }>([{
        type: 'list',
        name: 'selectedProjectId',
        message: 'Select project to update:',
        choices: projectChoices,
      }], null);

      projectId = selectedProjectId;
    }

    // Get the project
    const project = await this.storage.getProject(projectId);
    if (!project) {
      return handleError('PROJECT_NOT_FOUND', `Project "${projectId}" not found.`);
    }

    // Determine what to update
    let newName: string | undefined = flags.name;
    let newDescription: string | undefined = flags.description;

    // If no flags provided, enter interactive mode
    if (newName === undefined && newDescription === undefined) {
      const fields: FormField[] = [
        {
          type: 'input',
          name: 'name',
          message: 'Project name:',
          default: project.name,
        },
        {
          type: 'input',
          name: 'description',
          message: 'Project description:',
          default: project.description || '',
        },
      ];

      // Handle JSON mode for field input
      if (jsonMode) {
        outputPromptAsJson(
          buildFormPromptConfig(fields),
          createMetadata('project update', flags)
        );
        return;
      }

      const answers = await this.prompt<{ name: string; description: string }>(
        fields.map(field => ({
          ...field,
          validate: field.name === 'name'
            ? ((input: unknown) => String(input).length > 0 || 'Name is required')
            : undefined,
        }))
      , null);

      newName = answers.name;
      newDescription = answers.description;
    }

    // Build changes object - only include fields that are different
    const changes: { name?: string; description?: string } = {};

    if (newName !== undefined && newName !== project.name) {
      changes.name = newName;
    }

    if (newDescription !== undefined && newDescription !== (project.description || '')) {
      // Allow clearing description with empty string (storage layer converts '' to null)
      changes.description = newDescription;
    }

    // Check if anything changed
    if (Object.keys(changes).length === 0) {
      if (jsonMode) {
        outputSuccessAsJson(
          {
            projectId: project.id,
            projectName: project.name,
            description: project.description,
            noChanges: true,
          },
          createMetadata('project update', flags)
        );
        return;
      }
      this.log(styles.muted('No changes made.'));
      return;
    }

    // Update the project
    const updated = await this.storage.updateProject(project.id, changes);

    // Output success
    if (jsonMode) {
      outputSuccessAsJson(
        {
          projectId: updated.id,
          projectName: updated.name,
          description: updated.description,
          changes: Object.keys(changes),
        },
        createMetadata('project update', flags)
      );
      return;
    }

    this.log(styles.success(`\nUpdated project "${styles.emphasis(updated.name)}"`));
    this.log(styles.muted(`  ID: ${updated.id}`));
    if (changes.name) {
      this.log(styles.muted(`  Name: ${project.name} → ${updated.name}`));
    }
    if ('description' in changes) {
      const oldDesc = project.description || '(none)';
      const newDesc = updated.description || '(none)';
      this.log(styles.muted(`  Description: ${oldDesc} → ${newDesc}`));
    }
  }
}
