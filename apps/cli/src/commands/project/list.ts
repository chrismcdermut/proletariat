import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { SQLiteStorage, findPMO } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { ProjectPhase } from '../../lib/pmo/types.js';

export default class ProjectList extends Command {
  static description = 'List all projects in the PMO';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --archived',
    '<%= config.bin %> <%= command.id %> --all',
  ];

  static flags = {
    archived: Flags.boolean({
      char: 'a',
      description: 'Show only archived projects',
      default: false,
    }),
    all: Flags.boolean({
      description: 'Show all projects (including archived)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ProjectList);

    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    const hqPath = path.dirname(pmoPath);
    const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');

    if (!fs.existsSync(dbPath)) {
      this.error('Database not found. Run "prlt init" first.');
    }

    const storage = new SQLiteStorage(dbPath);

    try {
      // Determine filter based on flags
      let isArchived: boolean | undefined;
      if (flags.archived) {
        isArchived = true;
      } else if (!flags.all) {
        isArchived = false;  // Default: show only non-archived
      }
      // If --all, isArchived is undefined (show both)

      const projects = await storage.listProjects({ isArchived });

      // Get phases for display
      const phases = await storage.listPhases();
      const phaseMap = new Map<string, ProjectPhase>(phases.map(p => [p.id, p]));

      if (projects.length === 0) {
        if (flags.archived) {
          this.log(styles.muted('No archived projects found.'));
        } else if (flags.all) {
          this.log(styles.muted('No projects found. Create one with: prlt project create'));
        } else {
          this.log(styles.muted('No active projects found. Create one with: prlt project create'));
          // Check if there are archived projects
          const archivedProjects = await storage.listProjects({ isArchived: true });
          if (archivedProjects.length > 0) {
            this.log(styles.muted(`(${archivedProjects.length} archived project${archivedProjects.length > 1 ? 's' : ''} hidden. Use --archived to view)`));
          }
        }
        await storage.close();
        return;
      }

      const title = flags.archived ? 'Archived Projects' : flags.all ? 'All Projects' : 'Projects';
      this.log(styles.title(`\n${title}\n`));

      // Get ticket counts using listProjectSummaries
      const summaries = await storage.listProjectSummaries();
      const ticketCountMap = new Map<string, number>(summaries.map(s => [s.id, s.ticketCount]));

      for (const project of projects) {
        const isDefault = project.id === 'default';
        const markers: string[] = [];
        if (isDefault) markers.push(styles.success('default'));
        if (project.isArchived) markers.push(styles.muted('archived'));

        const markerStr = markers.length > 0 ? ` (${markers.join(', ')})` : '';

        this.log(`  ${styles.emphasis(project.name)}${markerStr}`);
        this.log(styles.muted(`    ID: ${project.id}`));

        // Show ticket count
        const ticketCount = ticketCountMap.get(project.id) ?? 0;
        this.log(styles.muted(`    Tickets: ${ticketCount}`));

        // Show phase if set
        if (project.phaseId) {
          const phase = phaseMap.get(project.phaseId);
          if (phase) {
            this.log(styles.muted(`    Phase: ${phase.name}`));
          }
        }

        if (project.description) {
          this.log(styles.muted(`    ${project.description}`));
        }
        this.log('');
      }

      // Show hint about archived projects when viewing active
      if (!flags.archived && !flags.all) {
        const archivedProjects = await storage.listProjects({ isArchived: true });
        if (archivedProjects.length > 0) {
          this.log(styles.muted(`(${archivedProjects.length} archived project${archivedProjects.length > 1 ? 's' : ''} hidden. Use --archived to view)`));
        }
      }

      await storage.close();
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
