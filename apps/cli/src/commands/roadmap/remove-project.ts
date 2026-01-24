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

export default class RoadmapRemoveProject extends PMOCommand {
  static description = 'Remove a project from a roadmap';

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
      description: 'Project ID to remove',
      required: false,
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
    const { args, flags } = await this.parse(RoadmapRemoveProject);
    const jsonMode = shouldOutputJson(flags);

    // Select roadmap
    let roadmapId = args.roadmap;
    if (!roadmapId) {
      const roadmaps = await this.storage.listRoadmaps();

      if (roadmaps.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_ROADMAPS', 'No roadmaps found', createMetadata('roadmap remove-project', flags));
          return;
        }
        this.error('No roadmaps found');
      }

      if (jsonMode) {
        const choices = roadmaps.map(r => ({
          name: `${r.name}${r.isDefault ? ' (default)' : ''}`,
          value: r.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'roadmap', 'Select roadmap:', choices),
          createMetadata('roadmap remove-project', flags)
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
        outputErrorAsJson('NOT_FOUND', `Roadmap not found: ${roadmapId}`, createMetadata('roadmap remove-project', flags));
        return;
      }
      this.error(`Roadmap not found: ${roadmapId}`);
    }

    // Get projects in roadmap
    const projects = await this.storage.listRoadmapProjects(roadmapId);

    if (projects.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_PROJECTS', 'No projects in this roadmap', createMetadata('roadmap remove-project', flags));
        return;
      }
      this.error('No projects in this roadmap');
    }

    // Select project
    let projectId = args.project;
    if (!projectId) {
      if (jsonMode) {
        const choices = projects.map((p, i) => ({
          name: `${i + 1}. ${p.name}`,
          value: p.id,
        }));
        outputPromptAsJson(
          buildPromptConfig('list', 'project', 'Select project to remove:', choices),
          createMetadata('roadmap remove-project', flags)
        );
        return;
      }

      const { selected } = await inquirer.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select project to remove:',
        choices: projects.map((p, i) => ({
          name: `${i + 1}. ${p.name}`,
          value: p.id,
        })),
      }]);
      projectId = selected;
    }

    // Verify project is in roadmap
    const project = projects.find(p => p.id === projectId);
    if (!project) {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_ROADMAP', `Project "${projectId}" is not in this roadmap`, createMetadata('roadmap remove-project', flags));
        return;
      }
      this.error(`Project "${projectId}" is not in this roadmap`);
    }

    // Confirm removal
    if (!flags.force) {
      const message = `Remove "${project.name}" from "${roadmap.name}"?`;

      if (jsonMode) {
        const confirmChoices = [
          { name: 'No, cancel', value: 'false' },
          { name: 'Yes, remove', value: 'true' },
        ];
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', message, confirmChoices),
          createMetadata('roadmap remove-project', flags)
        );
        return;
      }

      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message,
        choices: [
          { name: 'No, cancel', value: false },
          { name: 'Yes, remove', value: true },
        ],
      }]);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    await this.storage.removeProjectFromRoadmap(roadmapId, projectId);
    this.log(styles.success(`Removed "${project.name}" from "${roadmap.name}"`));
  }
}
