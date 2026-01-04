import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Ticket } from '../../lib/pmo/types.js';

// Progress bar helper
function progressBar(percent: number, width = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export default class EpicView extends Command {
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
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EpicView);

    const { storage, projectName } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      let epicId = args.id;

      // If no ID provided, prompt for selection
      if (!epicId) {
        const epics = await storage.listEpics();
        if (epics.length === 0) {
          this.log(styles.muted('\nNo epics found.'));
          this.log(styles.muted('Create one with: prlt epic create'));
          await storage.close();
          return;
        }

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select epic to view:',
          choices: epics.map(e => ({
            name: `${e.id} ${e.title} (${e.status})`,
            value: e.id,
          })),
        }]);
        epicId = selected;
      }

      const epic = await storage.getEpic(epicId!);
      if (!epic) {
        this.error(`Epic not found: ${epicId}`);
      }

      const tickets = await storage.getTicketsForEpic(epicId!);
      const doneTickets = tickets.filter((t: Ticket) => t.status === 'done').length;
      const percent = tickets.length > 0 ? Math.round((doneTickets / tickets.length) * 100) : 0;

      // Get linked spec if any
      let specTitle: string | undefined;
      if (epic.specId) {
        const spec = await storage.getSpec(epic.specId);
        specTitle = spec?.title;
      }

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
          const icon = ticket.status === 'done' ? '✅' :
                       ticket.status === 'in_progress' ? '🚧' :
                       ticket.status === 'blocked' ? '🔴' : '📋';
          const statusLabel = ticket.status === 'done' ? 'Done' :
                             ticket.status === 'in_progress' ? 'In Progress' :
                             ticket.status === 'blocked' ? 'Blocked' :
                             ticket.column || ticket.status;
          this.log(`  ${icon} ${ticket.id}: ${ticket.title} [${statusLabel}]`);
        }
      } else {
        this.log(styles.muted('\n  No tickets linked to this epic yet.'));
      }

      this.log('\n' + '═'.repeat(55));
      this.log(styles.muted('Commands:'));
      this.log(styles.muted(`  prlt epic progress ${epic.id}`));
      this.log(styles.muted(`  prlt ticket create --epic ${epic.id} "New task"`));

      await storage.close();
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
