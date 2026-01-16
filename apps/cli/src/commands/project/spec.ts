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

export default class ProjectSpec extends PMOCommand {
  static description = 'Manage specs associated with a project (many-to-many)';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project',
    '<%= config.bin %> <%= command.id %> my-project --add SPEC-001',
    '<%= config.bin %> <%= command.id %> my-project --remove SPEC-001',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    projectId: Args.string({
      description: 'Project ID',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    add: Flags.string({
      char: 'a',
      description: 'Add a spec to this project',
    }),
    remove: Flags.string({
      char: 'r',
      description: 'Remove a spec from this project',
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ProjectSpec);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('project spec', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get all projects
    const projects = await this.storage.listProjects();
    if (projects.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_PROJECTS', 'No projects found. Create one with: prlt project create', createMetadata('project spec', flags));
        return;
      }
      this.log(styles.muted('\nNo projects found. Create one with: prlt project create'));
      return;
    }

    let projectId = args.projectId;

    // If no project ID provided, prompt for selection
    if (!projectId) {
      // In JSON mode, output project selection prompt
      if (jsonMode) {
        const projectChoices = projects.map(p => ({ name: `${p.id} - ${p.name} (${p.status})`, value: p.id }));
        outputPromptAsJson(
          buildPromptConfig('list', 'projectId', 'Select project:', projectChoices),
          createMetadata('project spec', flags)
        );
        return;
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select project:',
        choices: projects.map(p => ({
          name: `${p.id} - ${p.name} (${p.status})`,
          value: p.id,
        })),
      }]);
      projectId = selected;
    }

    // Validate project exists
    const project = projects.find(p => p.id === projectId);
    if (!project) {
      return handleError('PROJECT_NOT_FOUND', `Project not found: ${projectId}`);
    }

    // Get specs currently associated with this project
    const projectSpecs = await this.storage.getSpecsForProject(projectId!);
    const projectSpecIds = new Set(projectSpecs.map(s => s.id));

    // Handle add flag
    if (flags.add) {
      const spec = await this.storage.getSpec(flags.add);
      if (!spec) {
        this.error(`Spec not found: ${flags.add}`);
      }

      if (projectSpecIds.has(flags.add)) {
        this.log(styles.muted(`\nSpec "${flags.add}" is already associated with project "${projectId}".`));
      } else {
        await this.storage.linkProjectToSpec(projectId!, flags.add);
        this.log(styles.success(`\nAdded spec ${styles.emphasis(flags.add)} to project ${styles.emphasis(projectId!)}`));
        this.log(styles.muted(`   Spec: ${spec.title}`));
      }
      return;
    }

    // Handle remove flag
    if (flags.remove) {
      if (!projectSpecIds.has(flags.remove)) {
        this.log(styles.muted(`\nSpec "${flags.remove}" is not associated with project "${projectId}".`));
      } else {
        await this.storage.unlinkProjectFromSpec(projectId!, flags.remove);
        this.log(styles.success(`\nRemoved spec ${styles.emphasis(flags.remove)} from project ${styles.emphasis(projectId!)}`));
      }
      return;
    }

    // Interactive mode: show menu
    // In JSON mode, output the menu prompt (no loop - AI will call back)
    if (jsonMode) {
      const currentSpecs = await this.storage.getSpecsForProject(projectId!);
      const menuChoices = [
        { name: 'Add spec to project', value: 'add' },
        { name: 'Remove spec from project', value: 'remove' },
        { name: 'Done', value: 'done' },
      ];
      outputPromptAsJson(
        {
          ...buildPromptConfig('list', 'action', `Manage specs for ${projectId}:`, menuChoices),
          context: {
            projectId,
            currentSpecs: currentSpecs.map(s => ({ id: s.id, title: s.title, status: s.status })),
          },
        },
        createMetadata('project spec', flags)
      );
      return;
    }

    let continueLoop = true;
    while (continueLoop) {
      // Refresh project specs each iteration
      const currentSpecs = await this.storage.getSpecsForProject(projectId!);
      const currentSpecIds = new Set(currentSpecs.map(s => s.id));

      this.log(styles.title(`\nSpecs for project "${project.name}" (${projectId})`));
      if (currentSpecs.length === 0) {
        this.log(styles.muted('  No specs associated with this project.'));
      } else {
        for (const spec of currentSpecs) {
          this.log(`  ${styles.code(spec.id)} - ${spec.title} (${spec.status})`);
        }
      }

      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: `Manage specs for ${projectId}:`,
        choices: [
          { name: 'Add spec to project', value: 'add' },
          { name: 'Remove spec from project', value: 'remove' },
          new inquirer.Separator(),
          { name: 'Done', value: 'done' },
        ],
      }]);

      if (action === 'done') {
        continueLoop = false;
        continue;
      }

      if (action === 'add') {
        // Get all specs not already associated
        const allSpecs = await this.storage.listSpecs();
        const availableSpecs = allSpecs.filter(s => !currentSpecIds.has(s.id));

        if (availableSpecs.length === 0) {
          this.log(styles.muted('\n  All specs are already associated with this project.'));
          continue;
        }

        const { selected } = await inquirer.prompt([{
          type: 'checkbox',
          name: 'selected',
          message: 'Select specs to add:',
          choices: availableSpecs.map(s => ({
            name: `${s.id} - ${s.title} (${s.status})`,
            value: s.id,
          })),
        }]);

        if (selected.length === 0) {
          this.log(styles.muted('  No specs selected.'));
          continue;
        }

        for (const specId of selected) {
          await this.storage.linkProjectToSpec(projectId!, specId);
          this.log(styles.success(`  Added ${specId}`));
        }
        continue;
      }

      if (action === 'remove') {
        if (currentSpecs.length === 0) {
          this.log(styles.muted('\n  No specs to remove.'));
          continue;
        }

        const { selected } = await inquirer.prompt([{
          type: 'checkbox',
          name: 'selected',
          message: 'Select specs to remove:',
          choices: currentSpecs.map(s => ({
            name: `${s.id} - ${s.title} (${s.status})`,
            value: s.id,
          })),
        }]);

        if (selected.length === 0) {
          this.log(styles.muted('  No specs selected.'));
          continue;
        }

        for (const specId of selected) {
          await this.storage.unlinkProjectFromSpec(projectId!, specId);
          this.log(styles.success(`  Removed ${specId}`));
        }
        continue;
      }
    }

    this.log(styles.muted(`\nView project: prlt project view ${projectId}`));
  }
}
