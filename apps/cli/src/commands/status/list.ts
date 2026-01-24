import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER, WorkflowStatus } from '../../lib/pmo/types.js';

export default class StatusList extends PMOCommand {
  static description = 'List all workflow statuses for a project';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --project my-project',
    '<%= config.bin %> <%= command.id %> --category started',
  ];

  static flags = {
    ...pmoBaseFlags,
    category: Flags.string({
      char: 'c',
      description: 'Filter by category',
      options: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(StatusList);
    // This command requires project context
    const projectId = await this.requireProject();

    // Get the project's workflow ID
    const project = await this.storage.getProject(projectId);
    if (!project?.workflowId) {
      this.error(`Project "${projectId}" has no workflow assigned.`);
    }

    const statuses = await this.storage.listStatuses(project.workflowId);

    if (flags.json) {
      this.log(JSON.stringify(statuses, null, 2));
      return;
    }

    if (statuses.length === 0) {
      this.log(styles.muted('\nNo statuses found.'));
      this.log(styles.muted('Apply a template: prlt template apply kanban'));
      return;
    }

    // Group by category
    const grouped = this.groupByCategory(statuses);

    const projectName = await this.getProjectName(projectId);
    this.log(`\n📊 ${styles.emphasis('Workflow Statuses')} - ${projectName}`);
    this.log('═'.repeat(60));

    const categoryEmoji: Record<StateCategory, string> = {
      triage: '📬',
      backlog: '📥',
      unstarted: '📋',
      started: '🚀',
      completed: '✅',
      canceled: '🚫',
    };

    const categoryColors: Record<StateCategory, string> = {
      triage: '#A78BFA',    // purple
      backlog: '#9CA3AF',   // gray
      unstarted: '#60A5FA', // blue
      started: '#FBBF24',   // yellow
      completed: '#34D399', // green
      canceled: '#F87171',  // red
    };

    for (const category of STATE_CATEGORY_ORDER) {
      if (flags.category && flags.category !== category) continue;

      const categoryStatuses = grouped.get(category);
      if (!categoryStatuses || categoryStatuses.length === 0) continue;

      const emoji = categoryEmoji[category];
      this.log(`\n${emoji} ${styles.emphasis(category.toUpperCase())}`);
      this.log('─'.repeat(40));

      for (const status of categoryStatuses) {
        const defaultBadge = status.isDefault ? styles.muted(' (default)') : '';
        const colorPreview = status.color ? `[${status.color}]` : '';
        this.log(`  ${status.name}${defaultBadge} ${styles.muted(colorPreview)}`);
        if (status.description) {
          this.log(`    ${styles.muted(status.description)}`);
        }
      }
    }

    this.log('');
  }

  private groupByCategory(statuses: WorkflowStatus[]): Map<StateCategory, WorkflowStatus[]> {
    const grouped = new Map<StateCategory, WorkflowStatus[]>();

    for (const status of statuses) {
      const existing = grouped.get(status.category) || [];
      existing.push(status);
      grouped.set(status.category, existing);
    }

    return grouped;
  }
}
