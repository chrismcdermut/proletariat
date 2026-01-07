import { Command, Flags } from '@oclif/core';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER, WorkflowStatus } from '../../lib/pmo/types.js';

export default class StatusList extends Command {
  static description = 'List all workflow statuses for a project';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --project my-project',
    '<%= config.bin %> <%= command.id %> --category started',
  ];

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
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

  async run(): Promise<void> {
    const { flags } = await this.parse(StatusList);

    const { storage, projectName, projectId } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      const statuses = await storage.listStatuses(projectId);

      if (flags.json) {
        this.log(JSON.stringify(statuses, null, 2));
        await storage.close();
        return;
      }

      if (statuses.length === 0) {
        this.log(styles.muted('\nNo statuses found.'));
        this.log(styles.muted('Apply a template: prlt template apply kanban'));
        await storage.close();
        return;
      }

      // Group by category
      const grouped = this.groupByCategory(statuses);

      this.log(`\n📊 ${styles.emphasis('Workflow Statuses')} - ${projectName}`);
      this.log('═'.repeat(60));

      const categoryEmoji: Record<StateCategory, string> = {
        backlog: '📥',
        unstarted: '📋',
        started: '🚀',
        completed: '✅',
        canceled: '🚫',
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
      await storage.close();
    } catch (error) {
      await storage.close();
      throw error;
    }
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
