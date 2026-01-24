import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class RoadmapList extends PMOCommand {
  static description = 'List all roadmaps';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const roadmaps = await this.storage.listRoadmaps();

    if (roadmaps.length === 0) {
      this.log(styles.muted('No roadmaps found. Create one with: prlt roadmap create'));
      return;
    }

    this.log(styles.title('\nRoadmaps\n'));

    // Fetch all project counts in parallel
    const projectCounts = await Promise.all(
      roadmaps.map(async (roadmap) => {
        const projects = await this.storage.listRoadmapProjects(roadmap.id);
        return projects.length;
      })
    );

    for (let i = 0; i < roadmaps.length; i++) {
      const roadmap = roadmaps[i];
      const markers: string[] = [];
      if (roadmap.isDefault) markers.push(styles.success('default'));

      const markerStr = markers.length > 0 ? ` (${markers.join(', ')})` : '';

      this.log(`  ${styles.emphasis(roadmap.name)}${markerStr}`);
      this.log(styles.muted(`    ID: ${roadmap.id}`));

      // Get project count (already fetched in parallel)
      this.log(styles.muted(`    Projects: ${projectCounts[i]}`));

      if (roadmap.description) {
        this.log(styles.muted(`    ${roadmap.description}`));
      }
      this.log('');
    }
  }
}
