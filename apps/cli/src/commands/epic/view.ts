import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Ticket } from '../../lib/pmo/types.js';
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

export default class EpicView extends PMOCommand {
  static description = 'View epic details and linked tickets';

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001',
    '<%= config.bin %> <%= command.id %>',
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
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(EpicView);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('epic view', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const projectId = await this.requireProject();

    let epicId = args.id;

    // If no ID provided, prompt for selection
    if (!epicId) {
      const epics = await this.storage.listEpics(projectId);
      if (epics.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_EPICS', 'No epics found.', createMetadata('epic view', flags));
          return;
        }
        this.log(styles.muted('\nNo epics found.'));
        this.log(styles.muted('Create one with: prlt epic create'));
        return;
      }

      const selected = await this.selectFromList({
        message: 'Select epic to view:',
        items: epics,
        getName: (e) => `${e.id} ${e.title} (${e.status})`,
        getValue: (e) => e.id,
        getCommand: (e) => `prlt epic view ${e.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'epic view' } : null,
      });

      if (!selected) {
        return;
      }
      epicId = selected;
    }

    const epic = await this.storage.getEpic(epicId!);
    if (!epic) {
      return handleError('EPIC_NOT_FOUND', `Epic not found: ${epicId}`);
    }

    const tickets = await this.storage.getTicketsForEpic(projectId, epicId!);
    const doneTickets = tickets.filter((t: Ticket) => t.statusCategory === 'completed').length;
    const percent = tickets.length > 0 ? Math.round((doneTickets / tickets.length) * 100) : 0;

    // Get linked spec if any
    let specTitle: string | undefined;
    if (epic.specId) {
      const spec = await this.storage.getSpec(epic.specId);
      specTitle = spec?.title;
    }

    const projectName = await this.getProjectName(projectId);

    this.log(`\n🎯 Epic: ${styles.emphasis(epic.id)} - ${epic.title}`);
    this.log('═'.repeat(55));
    this.log(`ID: ${epic.id}`);
    this.log(`Title: ${epic.title}`);
    this.log(`Project: ${projectName}`);
    this.log(`Status: ${epic.status}`);
    if (epic.specId) {
      this.log(`Spec: ${epic.specId}${specTitle ? ` - ${specTitle}` : ''}`);
    }
    this.log(`Created: ${epic.createdAt.toLocaleDateString()}`);
    if (epic.description) {
      this.log(`\nDescription: ${epic.description}`);
    }

    this.log(`\nProgress: ${percent}% (${doneTickets}/${tickets.length} tickets complete)`);
    this.log(progressBar(percent));

    if (tickets.length > 0) {
      this.log(`\n🎫 Tickets (${tickets.length}):`);
      for (const ticket of tickets) {
        const icon = ticket.statusCategory === 'completed' ? '✅' :
                     ticket.statusCategory === 'started' ? '🚧' :
                     ticket.statusCategory === 'unstarted' ? '📋' :
                     ticket.statusCategory === 'canceled' ? '🚫' : '📥';
        const statusLabel = ticket.statusName || 'Unknown';
        this.log(`  ${icon} ${ticket.id}: ${ticket.title} [${statusLabel}]`);
      }
    } else {
      this.log(styles.muted('\n  No tickets linked to this epic yet.'));
    }

    this.log('\n' + '═'.repeat(55));
    this.log(styles.muted('Commands:'));
    this.log(styles.muted(`  prlt epic progress ${epic.id}`));
    this.log(styles.muted(`  prlt ticket create --epic ${epic.id} "New task"`));
  }
}
