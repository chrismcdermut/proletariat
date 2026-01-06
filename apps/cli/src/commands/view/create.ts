import { Command, Args, Flags } from '@oclif/core';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { ViewFilter, ViewType, GroupBy, SortBy, SortDirection } from '../../lib/pmo/types.js';

export default class ViewCreate extends Command {
  static description = 'Create a saved board view with filters';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My Tasks"',
    '<%= config.bin %> <%= command.id %> "High Priority" --filter-priority HIGH',
    '<%= config.bin %> <%= command.id %> "Alice\'s Work" --filter-assignee alice --default',
    '<%= config.bin %> <%= command.id %> "In Progress" --filter-category started --group-by assignee',
  ];

  static args = {
    name: Args.string({
      description: 'View name',
      required: true,
    }),
  };

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID',
    }),
    type: Flags.string({
      char: 't',
      description: 'View type',
      options: ['kanban', 'list', 'table'],
      default: 'kanban',
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
      description: 'Filter by search text',
    }),
    'group-by': Flags.string({
      char: 'g',
      description: 'Group tickets by',
      options: ['status', 'assignee', 'priority', 'category', 'none'],
      default: 'status',
    }),
    'sort-by': Flags.string({
      description: 'Sort tickets by',
      options: ['priority', 'created', 'updated', 'title', 'assignee', 'position'],
      default: 'position',
    }),
    'sort-dir': Flags.string({
      description: 'Sort direction',
      options: ['asc', 'desc'],
      default: 'asc',
    }),
    default: Flags.boolean({
      char: 'd',
      description: 'Set as default view for project',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ViewCreate);

    const { storage, projectId } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Build filter from flags
      const filter: ViewFilter = {};

      if (flags['filter-assignee']?.length) {
        filter.assignee = flags['filter-assignee'].flatMap((a) => a.split(',').map((s) => s.trim()));
      }
      if (flags['filter-priority']?.length) {
        filter.priority = flags['filter-priority'].flatMap((p) => p.split(',').map((s) => s.trim().toUpperCase()));
      }
      if (flags['filter-category']?.length) {
        filter.statusCategory = flags['filter-category'].flatMap((c) => c.split(',').map((s) => s.trim())) as ViewFilter['statusCategory'];
      }
      if (flags['filter-column']?.length) {
        filter.column = flags['filter-column'].flatMap((c) => c.split(',').map((s) => s.trim()));
      }
      if (flags['filter-search']) {
        filter.search = flags['filter-search'];
      }

      const view = await storage.createView({
        projectId,
        name: args.name,
        type: flags.type as ViewType,
        filter,
        groupBy: flags['group-by'] as GroupBy,
        sortBy: flags['sort-by'] as SortBy,
        sortDirection: flags['sort-dir'] as SortDirection,
        isDefault: flags.default,
      });

      if (flags.json) {
        this.log(JSON.stringify(view, null, 2));
        await storage.close();
        return;
      }

      this.log(styles.success(`\n✅ Created view "${view.name}" (${view.id})`));

      if (view.isDefault) {
        this.log(styles.muted('   This is now the default view for the project'));
      }

      this.log('');
      this.log(styles.muted('View with: prlt board view --view ' + view.id));

      await storage.close();
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
