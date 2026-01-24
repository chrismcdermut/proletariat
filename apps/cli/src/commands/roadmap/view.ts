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

export default class RoadmapView extends PMOCommand {
  static description = 'View roadmap details and its projects';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-roadmap',
    '<%= config.bin %> <%= command.id %>  # Interactive selection',
  ];

  static args = {
    id: Args.string({
      description: 'Roadmap ID to view',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(RoadmapView);
    const jsonMode = shouldOutputJson(flags);

    let roadmapId = args.id;

    if (!roadmapId) {
      const roadmaps = await this.storage.listRoadmaps();

      if (roadmaps.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_ROADMAPS', 'No roadmaps found', createMetadata('roadmap view', flags));
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
          buildPromptConfig('list', 'id', 'Select roadmap to view:', choices),
          createMetadata('roadmap view', flags)
        );
        return;
      }

      const { selected } = await inquirer.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select roadmap to view:',
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
        outputErrorAsJson('NOT_FOUND', `Roadmap not found: ${roadmapId}`, createMetadata('roadmap view', flags));
        return;
      }
      this.error(`Roadmap not found: ${roadmapId}`);
    }

    // Display roadmap details
    this.log(styles.title(`\n${roadmap.name}`));
    if (roadmap.isDefault) {
      this.log(styles.success('  (default roadmap)'));
    }
    this.log(styles.muted(`  ID: ${roadmap.id}`));
    if (roadmap.description) {
      this.log(styles.muted(`  ${roadmap.description}`));
    }
    this.log('');

    // Get projects in this roadmap
    const projects = await this.storage.listRoadmapProjects(roadmap.id);

    if (projects.length === 0) {
      this.log(styles.muted('No projects in this roadmap.'));
      this.log(styles.muted(`Add projects with: prlt roadmap add-project ${roadmap.id}`));
      return;
    }

    this.log(styles.emphasis('Projects (in order):'));
    this.log('');

    for (let i = 0; i < projects.length; i++) {
      const project = projects[i];
      const tickets = await this.storage.listTickets(project.id);
      const ticketCount = tickets.length;

      this.log(`  ${i + 1}. ${styles.emphasis(project.name)}`);
      this.log(styles.muted(`     ID: ${project.id}`));
      this.log(styles.muted(`     Tickets: ${ticketCount}`));
      if (project.description) {
        this.log(styles.muted(`     ${project.description}`));
      }
      this.log('');
    }

    this.log(styles.muted(`Generate markdown: prlt roadmap generate ${roadmap.id}`));
    this.log(styles.muted(`Reorder projects: prlt roadmap reorder ${roadmap.id}`));
  }
}
