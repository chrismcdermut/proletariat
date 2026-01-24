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

export default class RoadmapAddProject extends PMOCommand {
  static description = 'Add a project to a roadmap';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-roadmap my-project',
    '<%= config.bin %> <%= command.id %> my-roadmap  # Interactive project selection',
    '<%= config.bin %> <%= command.id %>  # Interactive selection for both',
  ];

  static args = {
    roadmap: Args.string({
      description: 'Roadmap ID',
      required: false,
    }),
    project: Args.string({
      description: 'Project ID to add',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    position: Flags.integer({
      char: 'p',
      description: 'Position in the roadmap (0-indexed)',
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
    const { args, flags } = await this.parse(RoadmapAddProject);
    const jsonMode = shouldOutputJson(flags);

    // Select roadmap
    let roadmapId = args.roadmap;
    if (!roadmapId) {
      const roadmaps = await this.storage.listRoadmaps();

      if (roadmaps.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_ROADMAPS', 'No roadmaps found', createMetadata('roadmap add-project', flags));
          return;
        }
        this.error('No roadmaps found. Create one with: prlt roadmap create');
      }

      if (jsonMode) {
        const choices = roadmaps.map(r => ({
          name: `${r.name}${r.isDefault ? ' (default)' : ''}`,
          value: r.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'roadmap', 'Select roadmap:', choices),
          createMetadata('roadmap add-project', flags)
        );
        return;
      }

      const { selected } = await inquirer.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select roadmap:',
        choices: roadmaps.map(r => ({
          name: `${r.name}${r.isDefault ? ' (default)' : ''}`,
          value: r.id,
        })),
      }]);
      roadmapId = selected;
    }

    const roadmap = await this.storage.getRoadmap(roadmapId);
    if (!roadmap) {
      if (jsonMode) {
        outputErrorAsJson('NOT_FOUND', `Roadmap not found: ${roadmapId}`, createMetadata('roadmap add-project', flags));
        return;
      }
      this.error(`Roadmap not found: ${roadmapId}`);
    }

    // Get projects already in roadmap
    const existingProjects = await this.storage.listRoadmapProjects(roadmapId);
    const existingProjectIds = new Set(existingProjects.map(p => p.id));

    // Get all projects and filter out ones already in roadmap
    const allProjects = await this.storage.listProjects({ isArchived: false });
    const availableProjects = allProjects.filter(p => !existingProjectIds.has(p.id));

    if (availableProjects.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_AVAILABLE_PROJECTS', 'All projects are already in this roadmap', createMetadata('roadmap add-project', flags));
        return;
      }
      this.error('All projects are already in this roadmap');
    }

    // Select project
    let projectId = args.project;
    if (!projectId) {
      if (jsonMode) {
        const choices = availableProjects.map(p => ({
          name: p.name,
          value: p.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'project', 'Select project to add:', choices),
          createMetadata('roadmap add-project', flags)
        );
        return;
      }

      const { selected } = await inquirer.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select project to add:',
        choices: availableProjects.map(p => ({
          name: p.name,
          value: p.id,
        })),
      }]);
      projectId = selected;
    }

    // Verify project exists and isn't already in roadmap
    const project = await this.storage.getProject(projectId);
    if (!project) {
      if (jsonMode) {
        outputErrorAsJson('NOT_FOUND', `Project not found: ${projectId}`, createMetadata('roadmap add-project', flags));
        return;
      }
      this.error(`Project not found: ${projectId}`);
    }

    if (existingProjectIds.has(projectId)) {
      if (jsonMode) {
        outputErrorAsJson('ALREADY_IN_ROADMAP', `Project "${project.name}" is already in this roadmap`, createMetadata('roadmap add-project', flags));
        return;
      }
      this.error(`Project "${project.name}" is already in this roadmap`);
    }

    // Add project to roadmap
    await this.storage.addProjectToRoadmap(roadmapId, projectId, flags.position);

    const projects = await this.storage.listRoadmapProjects(roadmapId);
    const position = projects.findIndex(p => p.id === projectId) + 1;

    this.log(styles.success(`Added "${project.name}" to "${roadmap.name}" at position ${position}`));
  }
}
