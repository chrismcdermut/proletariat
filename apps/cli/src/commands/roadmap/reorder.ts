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

export default class RoadmapReorder extends PMOCommand {
  static description = 'Reorder projects in a roadmap';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-roadmap',
    '<%= config.bin %> <%= command.id %> my-roadmap --project my-project --position 0',
    '<%= config.bin %> <%= command.id %>  # Interactive selection',
  ];

  static args = {
    roadmap: Args.string({
      description: 'Roadmap ID',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    project: Flags.string({
      char: 'p',
      description: 'Project ID to move',
    }),
    position: Flags.integer({
      description: 'New position (0-indexed)',
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
    const { args, flags } = await this.parse(RoadmapReorder);
    const jsonMode = shouldOutputJson(flags);

    // Select roadmap
    let roadmapId = args.roadmap;
    if (!roadmapId) {
      const roadmaps = await this.storage.listRoadmaps();

      if (roadmaps.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_ROADMAPS', 'No roadmaps found', createMetadata('roadmap reorder', flags));
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
          createMetadata('roadmap reorder', flags)
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
        outputErrorAsJson('NOT_FOUND', `Roadmap not found: ${roadmapId}`, createMetadata('roadmap reorder', flags));
        return;
      }
      this.error(`Roadmap not found: ${roadmapId}`);
    }

    // Get projects in roadmap
    let projects = await this.storage.listRoadmapProjects(roadmapId);

    if (projects.length < 2) {
      if (jsonMode) {
        outputErrorAsJson('NOT_ENOUGH_PROJECTS', 'Need at least 2 projects to reorder', createMetadata('roadmap reorder', flags));
        return;
      }
      this.error('Need at least 2 projects to reorder');
    }

    // If flags provided, use them
    if (flags.project && flags.position !== undefined) {
      const project = projects.find(p => p.id === flags.project);
      if (!project) {
        if (jsonMode) {
          outputErrorAsJson('NOT_IN_ROADMAP', `Project "${flags.project}" is not in this roadmap`, createMetadata('roadmap reorder', flags));
          return;
        }
        this.error(`Project "${flags.project}" is not in this roadmap`);
      }

      await this.storage.reorderRoadmapProject(roadmapId, flags.project, flags.position);
      this.log(styles.success(`Moved "${project.name}" to position ${flags.position + 1}`));
      return;
    }

    // Interactive mode
    this.log(styles.title(`\nReorder projects in "${roadmap.name}"\n`));
    this.log('Current order:');
    for (let i = 0; i < projects.length; i++) {
      this.log(`  ${i + 1}. ${projects[i].name}`);
    }
    this.log('');

    // Prompt to select project to move
    if (jsonMode) {
      const choices = projects.map((p, i) => ({
        name: `${i + 1}. ${p.name}`,
        value: p.id,
      }));
      outputPromptAsJson(
        buildPromptConfig('list', 'project', 'Select project to move:', choices),
        createMetadata('roadmap reorder', flags)
      );
      return;
    }

    const { projectToMove } = await inquirer.prompt<{ projectToMove: string }>([{
      type: 'list',
      name: 'projectToMove',
      message: 'Select project to move:',
      choices: projects.map((p, i) => ({
        name: `${i + 1}. ${p.name}`,
        value: p.id,
      })),
    }]);

    const project = projects.find(p => p.id === projectToMove)!;
    const currentPosition = projects.findIndex(p => p.id === projectToMove);

    // Generate position choices
    const positionChoices = projects.map((p, i) => {
      if (i === currentPosition) {
        return { name: `${i + 1}. ${p.name} (current position)`, value: i, disabled: true };
      }
      const label = i < currentPosition ? `Move before ${i + 1}. ${p.name}` : `Move after ${i}. ${projects[i - 1]?.name || ''}`;
      return { name: `Position ${i + 1}: ${label}`, value: i };
    }).filter(c => !c.disabled);

    // Add "move to end" option if not already at the end
    if (currentPosition !== projects.length - 1) {
      positionChoices.push({
        name: `Position ${projects.length}: Move to end`,
        value: projects.length - 1,
      });
    }

    const { newPosition } = await inquirer.prompt<{ newPosition: number }>([{
      type: 'list',
      name: 'newPosition',
      message: `Move "${project.name}" to which position?`,
      choices: positionChoices,
    }]);

    await this.storage.reorderRoadmapProject(roadmapId, projectToMove, newPosition);

    // Show new order
    projects = await this.storage.listRoadmapProjects(roadmapId);
    this.log(styles.success(`\nReordered. New order:`));
    for (let i = 0; i < projects.length; i++) {
      const marker = projects[i].id === projectToMove ? styles.success(' ←') : '';
      this.log(`  ${i + 1}. ${projects[i].name}${marker}`);
    }
  }
}
