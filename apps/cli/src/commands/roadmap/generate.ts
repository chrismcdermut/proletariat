import { Args, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { slugify } from '../../lib/pmo/utils.js';
import { normalizePriority, PRIORITIES } from '../../lib/pmo/types.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class RoadmapGenerate extends PMOCommand {
  static description = 'Generate roadmap markdown file';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-roadmap',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> my-roadmap --output ./docs',
  ];

  static args = {
    id: Args.string({
      description: 'Roadmap ID to generate',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    all: Flags.boolean({
      description: 'Generate all roadmaps',
      default: false,
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output directory (default: {pmoPath}/roadmaps)',
    }),
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(RoadmapGenerate);
    const jsonMode = shouldOutputJson(flags);

    // Determine output directory
    const outputDir = flags.output || path.join(this.pmoPath, 'roadmaps');
    fs.mkdirSync(outputDir, { recursive: true });

    if (flags.all) {
      // Generate all roadmaps
      const roadmaps = await this.storage.listRoadmaps();
      if (roadmaps.length === 0) {
        this.log(styles.muted('No roadmaps found. Create one with: prlt roadmap create'));
        return;
      }

      for (const roadmap of roadmaps) {
        await this.generateRoadmap(roadmap.id, outputDir);
      }
      this.log(styles.success(`\nGenerated ${roadmaps.length} roadmap(s) to ${outputDir}`));
      return;
    }

    // Select specific roadmap
    let roadmapId = args.id;
    if (!roadmapId) {
      const roadmaps = await this.storage.listRoadmaps();

      if (roadmaps.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_ROADMAPS', 'No roadmaps found', createMetadata('roadmap generate', flags));
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
          buildPromptConfig('list', 'id', 'Select roadmap to generate:', choices),
          createMetadata('roadmap generate', flags)
        );
        return;
      }

      const { selected } = await inquirer.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select roadmap to generate:',
        choices: roadmaps.map(r => ({
          name: `${r.name}${r.isDefault ? ' (default)' : ''}`,
          value: r.id,
        })),
      }]);
      roadmapId = selected;
    }

    await this.generateRoadmap(roadmapId!, outputDir);
  }

  private async generateRoadmap(roadmapId: string, outputDir: string): Promise<void> {
    const roadmap = await this.storage.getRoadmap(roadmapId);
    if (!roadmap) {
      this.error(`Roadmap not found: ${roadmapId}`);
    }

    const projects = await this.storage.listRoadmapProjects(roadmapId);
    const lines: string[] = [];

    // Header
    lines.push(`# ${roadmap.name}`);
    lines.push('');
    if (roadmap.description) {
      lines.push(roadmap.description);
      lines.push('');
    }
    lines.push('Generated from PMO database. Source of truth: `workspace.db`');
    lines.push('');
    lines.push('---');
    lines.push('');

    // Process each project
    for (let i = 0; i < projects.length; i++) {
      const project = projects[i];
      const tickets = await this.storage.listTickets(project.id);

      if (tickets.length === 0) continue;

      // Strip leading number prefix from project name (e.g., "1. MVP Launch" -> "MVP Launch")
      let displayName = project.name;
      if (displayName && /^\d+\.\s/.test(displayName)) {
        displayName = displayName.replace(/^\d+\.\s/, '');
      }

      lines.push(`## ${i + 1}. ${displayName}`);
      lines.push('');

      // Group tickets by priority
      const ticketsByPriority = new Map<string, typeof tickets>();
      for (const priority of PRIORITIES) {
        ticketsByPriority.set(priority, []);
      }
      ticketsByPriority.set('unset', []);

      for (const ticket of tickets) {
        const normalizedPriority = normalizePriority(ticket.priority) || 'unset';
        const group = ticketsByPriority.get(normalizedPriority) || ticketsByPriority.get('unset')!;
        group.push(ticket);
      }

      // Sort each priority group by status category, then ticket ID
      const categoryOrder: Record<string, number> = {
        'started': 1,
        'unstarted': 2,
        'backlog': 3,
        'completed': 4,
        'canceled': 5,
        'triage': 6,
      };

      for (const [priority, priorityTickets] of ticketsByPriority) {
        if (priorityTickets.length === 0) continue;

        priorityTickets.sort((a, b) => {
          const catA = categoryOrder[a.statusCategory || 'backlog'] || 6;
          const catB = categoryOrder[b.statusCategory || 'backlog'] || 6;
          if (catA !== catB) return catA - catB;
          return a.id.localeCompare(b.id);
        });

        // Priority header
        const priorityLabel = priority === 'unset' ? 'Unset Priority' : `${priority} - ${this.getPriorityLabel(priority)}`;
        lines.push(`### ${priorityLabel} (${priorityTickets.length} ticket${priorityTickets.length > 1 ? 's' : ''})`);
        lines.push('');

        // Table header
        lines.push('| Ticket | Title | Status | Category | Description |');
        lines.push('| ------ | ----- | ------ | -------- | ----------- |');

        for (const ticket of priorityTickets) {
          const title = this.cleanForTable(ticket.title);
          const status = ticket.statusCategory || 'backlog';
          const category = ticket.category || '';
          const desc = this.truncateDescription(ticket.description || '', 150);

          lines.push(`| ${ticket.id} | ${title} | ${status} | ${category} | ${desc} |`);
        }

        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    // Footer
    lines.push(`*Last updated: ${new Date().toISOString().split('T')[0]}*`);
    lines.push('');

    const fileName = `${slugify(roadmap.name)}.md`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, lines.join('\n'));

    this.log(styles.success(`Generated ${filePath}`));
  }

  private getPriorityLabel(priority: string): string {
    const labels: Record<string, string> = {
      'P0': 'Critical',
      'P1': 'High',
      'P2': 'Medium',
      'P3': 'Low',
    };
    return labels[priority] || priority;
  }

  private cleanForTable(text: string): string {
    return (text || '').replace(/\|/g, '-').replace(/\n/g, ' ').replace(/\r/g, '').trim();
  }

  private truncateDescription(desc: string, maxLength: number): string {
    const cleaned = this.cleanForTable(desc);
    if (cleaned.length > maxLength) {
      return cleaned.substring(0, maxLength - 3) + '...';
    }
    return cleaned;
  }
}
