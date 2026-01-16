import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Epic, EpicStatus, Ticket } from '../../lib/pmo/types.js';
import { getRelativeEpicPath } from '../../lib/pmo/epic-files.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

// Progress bar helper
function progressBar(percent: number, width = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export default class EpicProgress extends PMOCommand {
  static description = 'Show epic completion progress';

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001',
    '<%= config.bin %> <%= command.id %> --all',
  ];

  static args = {
    id: Args.string({
      description: 'Epic ID',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Show progress for all epics',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(EpicProgress);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    if (flags.all) {
      await this.showAllProgress();
    } else {
      let epicId = args.id;

      // If no ID provided, prompt for selection
      if (!epicId) {
        const epics = await this.storage.listEpics();
        if (epics.length === 0) {
          if (jsonMode) {
            outputErrorAsJson('NO_EPICS', 'No epics found.', createMetadata('epic progress', flags));
            return;
          }
          this.log(styles.muted('\nNo epics found.'));
          return;
        }

        // In JSON mode, output epic selection prompt
        if (jsonMode) {
          const epicChoices = epics.map(e => ({ name: `${e.id} ${e.title} (${e.status})`, value: e.id }));
          outputPromptAsJson(
            buildPromptConfig('list', 'id', 'Select epic to view progress:', epicChoices),
            createMetadata('epic progress', flags)
          );
          return;
        }

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select epic to view progress:',
          choices: epics.map(e => ({
            name: `${e.id} ${e.title} (${e.status})`,
            value: e.id,
          })),
        }]);
        epicId = selected;
      }

      await this.showSingleProgress(epicId!);
    }
  }

  private async showSingleProgress(epicId: string): Promise<void> {
    const epic = await this.storage.getEpic(epicId);
    if (!epic) {
      this.error(`Epic not found: ${epicId}`);
    }

    const tickets = await this.storage.getTicketsForEpic(epicId);
    const doneTickets = tickets.filter((t: Ticket) => t.status === 'done').length;
    const percent = tickets.length > 0 ? Math.round((doneTickets / tickets.length) * 100) : 0;
    const relativePath = getRelativeEpicPath(this.pmoPath, epic.id, epic.status, this.projectId);

    this.log(`\n🎯 Epic Progress: ${styles.emphasis(epic.id)} - ${epic.title}`);
    this.log('═'.repeat(55));
    this.log(`\nStatus: ${epic.status}`);
    this.log(`File: ${relativePath}`);
    this.log(`Tickets: ${doneTickets}/${tickets.length} complete (${percent}%)`);
    this.log(`\n${progressBar(percent)} ${percent}%`);

    // Group tickets by status/column
    const byStatus = new Map<string, Ticket[]>();
    for (const ticket of tickets) {
      const key = ticket.statusName || 'Unknown';
      const list = byStatus.get(key) || [];
      list.push(ticket);
      byStatus.set(key, list);
    }

    if (byStatus.size > 0) {
      this.log('\nBreakdown by column:');
      const statusEmoji: Record<string, string> = {
        done: '✅',
        'in_progress': '🚧',
        blocked: '🔴',
        ready: '📋',
        backlog: '📥',
      };

      for (const [status, statusTickets] of byStatus) {
        const emoji = statusEmoji[status.toLowerCase()] || '📋';
        this.log(`  ${emoji} ${status}: ${statusTickets.length} ticket${statusTickets.length === 1 ? '' : 's'}`);
      }
    }

    // Show remaining work
    const remaining = tickets.filter((t: Ticket) => t.status !== 'done');
    if (remaining.length > 0) {
      this.log('\nRemaining work:');
      for (const ticket of remaining) {
        const statusLabel = ticket.statusName || ticket.status;
        this.log(`  ${ticket.id}: ${ticket.title} [${statusLabel}]`);
      }
    }
  }

  private async showAllProgress(): Promise<void> {
    const epics = await this.storage.listEpics();

    if (epics.length === 0) {
      this.log(styles.muted('\nNo epics found.'));
      return;
    }

    this.log('\n📊 Epic Progress - All Epics');
    this.log('═'.repeat(55));

    // Group by status
    const grouped = new Map<EpicStatus, Epic[]>();
    for (const epic of epics) {
      const list = grouped.get(epic.status) || [];
      list.push(epic);
      grouped.set(epic.status, list);
    }

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
        const tickets = await this.storage.getTicketsForEpic(epic.id);
        const doneTickets = tickets.filter((t: Ticket) => t.status === 'done').length;
        const percent = tickets.length > 0 ? Math.round((doneTickets / tickets.length) * 100) : 0;
        const bar = progressBar(percent);
        const readyToArchive = percent === 100 && status === 'active' ? ' ← ready to archive' : '';

        this.log(`  ${epic.id.padEnd(10)} ${epic.title.substring(0, 30).padEnd(30)} ${bar} ${String(percent).padStart(3)}% (${doneTickets}/${tickets.length})${readyToArchive}`);
      }
    }

    this.log(styles.muted('\nCommands:'));
    this.log(styles.muted('  prlt epic progress <id>    View detailed progress'));
    this.log(styles.muted('  prlt epic archive <id>     Archive completed epic'));
  }
}
