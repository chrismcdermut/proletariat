import { Command, Args, Flags } from '@oclif/core';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { ViewFilter, ViewType, GroupBy, SortBy, SortDirection, StateCategory } from '../../lib/pmo/types.js';

export default class ViewUpdate extends Command {
  static description = 'Update a saved board view';

  static examples = [
    '<%= config.bin %> <%= command.id %> VIEW-001 --name "New Name"',
    '<%= config.bin %> <%= command.id %> VIEW-001 --filter-priority HIGH,MEDIUM',
    '<%= config.bin %> <%= command.id %> VIEW-001 --default',
    '<%= config.bin %> <%= command.id %> VIEW-001 --sort-by updated --sort-dir desc',
  ];

  static args = {
    id: Args.string({
      description: 'View ID',
      required: true,
    }),
  };

  static flags = {
    name: Flags.string({
      char: 'n',
      description: 'New view name',
    }),
    type: Flags.string({
      char: 't',
      description: 'View type',
      options: ['kanban', 'list', 'table'],
    }),
    'filter-assignee': Flags.string({
      char: 'a',
      description: 'Filter by assignee(s), comma-separated. Use "unassigned" for unassigned tickets',
      multiple: true,
    }),
    'filter-priority': Flags.string({
      char: 'p',
      description: 'Filter by priority level(s), comma-separated',
      multiple: true,
    }),
    'filter-category': Flags.string({
      char: 'c',
      description: 'Filter by status category(s), comma-separated',
      options: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
      multiple: true,
    }),
    'filter-column': Flags.string({
      description: 'Filter by column name(s), comma-separated',
      multiple: true,
    }),
    'filter-search': Flags.string({
      char: 's',
      description: 'Filter by search text (empty string to clear)',
    }),
    'clear-filters': Flags.boolean({
      description: 'Clear all filters',
      default: false,
    }),
    'group-by': Flags.string({
      char: 'g',
      description: 'Group tickets by',
      options: ['status', 'assignee', 'priority', 'category', 'none'],
    }),
    'sort-by': Flags.string({
      description: 'Sort tickets by',
      options: ['priority', 'created', 'updated', 'title', 'assignee', 'position'],
    }),
    'sort-dir': Flags.string({
      description: 'Sort direction',
      options: ['asc', 'desc'],
    }),
    default: Flags.boolean({
      char: 'd',
      description: 'Set as default view for project',
      allowNo: true,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ViewUpdate);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Get existing view
      const existing = await storage.getView(args.id);
      if (!existing) {
        this.error(`View not found: ${args.id}`);
      }

      // Build changes
      const changes: Partial<typeof existing> = {};

      if (flags.name !== undefined) {
        changes.name = flags.name;
      }
      if (flags.type !== undefined) {
        changes.type = flags.type as ViewType;
      }
      if (flags['group-by'] !== undefined) {
        changes.groupBy = flags['group-by'] as GroupBy;
      }
      if (flags['sort-by'] !== undefined) {
        changes.sortBy = flags['sort-by'] as SortBy;
      }
      if (flags['sort-dir'] !== undefined) {
        changes.sortDirection = flags['sort-dir'] as SortDirection;
      }
      if (flags.default !== undefined) {
        changes.isDefault = flags.default;
      }

      // Handle filter changes
      if (flags['clear-filters']) {
        changes.filter = {};
      } else {
        const filter: ViewFilter = { ...existing.filter };
        let hasFilterChanges = false;

        if (flags['filter-assignee'] !== undefined) {
          filter.assignee = flags['filter-assignee'].flatMap((a) => a.split(',').map((s) => s.trim()));
          hasFilterChanges = true;
        }
        if (flags['filter-priority'] !== undefined) {
          filter.priority = flags['filter-priority'].flatMap((p) => p.split(',').map((s) => s.trim().toUpperCase()));
          hasFilterChanges = true;
        }
        if (flags['filter-category'] !== undefined) {
          filter.statusCategory = flags['filter-category'].flatMap((c) => c.split(',').map((s) => s.trim())) as StateCategory[];
          hasFilterChanges = true;
        }
        if (flags['filter-column'] !== undefined) {
          filter.column = flags['filter-column'].flatMap((c) => c.split(',').map((s) => s.trim()));
          hasFilterChanges = true;
        }
        if (flags['filter-search'] !== undefined) {
          filter.search = flags['filter-search'] || undefined;
          hasFilterChanges = true;
        }

        if (hasFilterChanges) {
          changes.filter = filter;
        }
      }

      if (Object.keys(changes).length === 0) {
        this.log(styles.muted('No changes specified'));
        await storage.close();
        return;
      }

      const view = await storage.updateView(args.id, changes);

      if (flags.json) {
        this.log(JSON.stringify(view, null, 2));
        await storage.close();
        return;
      }

      this.log(styles.success(`\n✅ Updated view "${view.name}" (${view.id})`));

      await storage.close();
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
