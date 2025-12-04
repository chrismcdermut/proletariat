import { Command, Flags } from '@oclif/core';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Epic, EpicStatus, Ticket } from '../../lib/pmo/types.js';

// Progress bar helper
function progressBar(percent: number, width = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export default class EpicList extends Command {
  static description = 'List all epics';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --status active',
  ];

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
    status: Flags.string({
      char: 's',
      description: 'Filter by status',
      options: ['active', 'draft', 'complete', 'dropped', 'future'],
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(EpicList);

    const { storage, projectName } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      const epics = await storage.listEpics(
        flags.status ? { status: flags.status as EpicStatus } : undefined
      );

      if (epics.length === 0) {
        this.log(styles.muted('\nNo epics found.'));
        this.log(styles.muted('Create one with: prlt epic create'));
        await storage.close();
        return;
      }

      // Group epics by status
      const grouped = this.groupByStatus(epics);

      // Get ticket counts for each epic
      const epicProgress: Map<string, { done: number; total: number }> = new Map();
      for (const epic of epics) {
        const tickets = await storage.getTicketsForEpic(epic.id);
        const done = tickets.filter((t: Ticket) => t.status === 'done').length;
        epicProgress.set(epic.id, { done, total: tickets.length });
      }

      this.log(`\n🎯 ${styles.emphasis('Epics')} - ${projectName}`);
      this.log('═'.repeat(55));

      const statusOrder: EpicStatus[] = ['active', 'draft', 'complete', 'dropped', 'future'];
      const statusEmoji: Record<EpicStatus, string> = {
        active: '🟢',
        draft: '🟡',
        complete: '✅',
        dropped: '❌',
        future: '🔮',
      };

      for (const status of statusOrder) {
        const statusEpics = grouped.get(status);
        if (!statusEpics || statusEpics.length === 0) continue;

        this.log(`\n${statusEmoji[status]} ${status.toUpperCase()} (${statusEpics.length})`);

        for (const epic of statusEpics) {
          const progress = epicProgress.get(epic.id) || { done: 0, total: 0 };
          const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
          const bar = progressBar(percent);
          const readyToArchive = percent === 100 && status === 'active' ? ' ← ready to archive!' : '';

          this.log(`  ${epic.id.padEnd(10)} ${epic.title.substring(0, 30).padEnd(30)} ${bar} ${String(percent).padStart(3)}% (${progress.done}/${progress.total})${readyToArchive}`);
        }
      }

      this.log('\n' + '═'.repeat(55));

      const counts = statusOrder
        .map(s => `${grouped.get(s)?.length || 0} ${s}`)
        .filter(s => !s.startsWith('0'))
        .join(', ');
      this.log(`Total: ${epics.length} epics (${counts})`);

      this.log(styles.muted('\nCommands:'));
      this.log(styles.muted('  prlt epic progress <id>    View detailed progress'));
      this.log(styles.muted('  prlt epic archive <id>     Archive completed epic'));

      await storage.close();
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private groupByStatus(epics: Epic[]): Map<EpicStatus, Epic[]> {
    const grouped = new Map<EpicStatus, Epic[]>();
    for (const epic of epics) {
      const list = grouped.get(epic.status) || [];
      list.push(epic);
      grouped.set(epic.status, list);
    }
    return grouped;
  }
}
