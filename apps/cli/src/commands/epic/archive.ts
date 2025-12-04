import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Ticket } from '../../lib/pmo/types.js';
import { moveEpicFile, getRelativeEpicPath } from '../../lib/pmo/epic-files.js';

export default class EpicArchive extends Command {
  static description = 'Archive a completed epic';

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-002',
    '<%= config.bin %> <%= command.id %> --force',
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
    force: Flags.boolean({
      char: 'f',
      description: 'Skip ticket completion check',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EpicArchive);

    const { storage, pmoPath, projectId } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      let epicId = args.id;

      // If no ID provided, prompt for selection (show only non-complete epics)
      if (!epicId) {
        const epics = await storage.listEpics();
        const archivable = epics.filter(e => e.status !== 'complete' && e.status !== 'dropped');

        if (archivable.length === 0) {
          this.log(styles.muted('\nNo epics available to archive.'));
          await storage.close();
          return;
        }

        // Get ticket counts
        const choices = await Promise.all(archivable.map(async e => {
          const tickets = await storage.getTicketsForEpic(e.id);
          const done = tickets.filter((t: Ticket) => t.status === 'done').length;
          const complete = done === tickets.length && tickets.length > 0;
          return {
            name: `${e.id} ${e.title} (${e.status}) [${done}/${tickets.length} tickets complete]${complete ? ' ✅' : ''}`,
            value: e.id,
          };
        }));

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select epic to archive:',
          choices,
        }]);
        epicId = selected;
      }

      const epic = await storage.getEpic(epicId!);
      if (!epic) {
        this.error(`Epic not found: ${epicId}`);
      }

      if (epic.status === 'complete') {
        this.log(styles.muted(`Epic ${epicId} is already archived.`));
        await storage.close();
        return;
      }

      // Check ticket completion
      const tickets = await storage.getTicketsForEpic(epicId!);
      const doneTickets = tickets.filter((t: Ticket) => t.status === 'done').length;
      const allComplete = doneTickets === tickets.length;

      if (!allComplete && !flags.force) {
        this.log(styles.warning(`\n⚠️  Not all tickets are complete (${doneTickets}/${tickets.length} done)`));
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: 'Continue archiving anyway?',
          default: false,
        }]);

        if (!confirm) {
          this.log(styles.muted('Cancelled.'));
          await storage.close();
          return;
        }
      }

      this.log(`\nArchiving: ${epicId} "${epic.title}"`);
      this.log(`Status: ${doneTickets}/${tickets.length} tickets complete${allComplete ? ' ✅' : ''}`);

      // Move the epic file to complete status directory
      const moveResult = moveEpicFile(pmoPath, epicId!, epic.status, 'complete', projectId);

      await storage.updateEpic(epicId!, { status: 'complete' });

      this.log(styles.success(`\n✅ Archived epic ${styles.emphasis(epicId)} "${epic.title}"`));
      this.log(styles.muted(`   Status: ${epic.status} → complete`));
      if (moveResult) {
        const relativePath = getRelativeEpicPath(pmoPath, epicId!, 'complete', projectId);
        this.log(styles.muted(`   File: ${relativePath}`));
      }
      this.log(styles.muted('\nView archived epics:'));
      this.log(styles.muted('  prlt epic list --status complete'));

      await storage.close();
    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
