import { Command, Flags } from '@oclif/core';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { BoardView } from '../../lib/pmo/types.js';

export default class ViewList extends Command {
  static description = 'List all saved board views for a project';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --project my-project',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID',
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ViewList);

    const { storage, projectName, projectId } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      const views = await storage.listViews(projectId);

      if (flags.json) {
        this.log(JSON.stringify(views, null, 2));
        await storage.close();
        return;
      }

      if (views.length === 0) {
        this.log(styles.muted('\nNo saved views found.'));
        this.log(styles.muted('Create a view: prlt view create "My Tasks" --filter-assignee alice'));
        await storage.close();
        return;
      }

      this.log(`\n👁️ ${styles.emphasis('Board Views')} - ${projectName}`);
      this.log('═'.repeat(60));

      for (const view of views) {
        const defaultBadge = view.isDefault ? styles.success(' (default)') : '';
        const typeEmoji = this.getTypeEmoji(view.type);

        this.log(`\n${typeEmoji} ${styles.code(view.id)} ${styles.emphasis(view.name)}${defaultBadge}`);
        this.log(`   Type: ${view.type} | Group by: ${view.groupBy} | Sort: ${view.sortBy} ${view.sortDirection}`);

        const filterSummary = this.formatFilterSummary(view);
        if (filterSummary) {
          this.log(`   Filters: ${styles.muted(filterSummary)}`);
        }
      }

      this.log('');
      await storage.close();
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private getTypeEmoji(type: string): string {
    const emojis: Record<string, string> = {
      kanban: '📋',
      list: '📝',
      table: '📊',
    };
    return emojis[type] || '👁️';
  }

  private formatFilterSummary(view: BoardView): string {
    const parts: string[] = [];
    const { filter } = view;

    if (filter.assignee?.length) {
      parts.push(`assignee=${filter.assignee.join(',')}`);
    }
    if (filter.priority?.length) {
      parts.push(`priority=${filter.priority.join(',')}`);
    }
    if (filter.statusCategory?.length) {
      parts.push(`category=${filter.statusCategory.join(',')}`);
    }
    if (filter.column?.length) {
      parts.push(`column=${filter.column.join(',')}`);
    }
    if (filter.search) {
      parts.push(`search="${filter.search}"`);
    }

    return parts.join(', ') || '(none)';
  }
}
