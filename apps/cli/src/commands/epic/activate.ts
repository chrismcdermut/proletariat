import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Ticket } from '../../lib/pmo/types.js';
import { moveEpicFile, getRelativeEpicPath } from '../../lib/pmo/epic-files.js';

export default class EpicActivate extends PMOCommand {
  static description = 'Activate a draft or archived epic';

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-004',
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
  };

  async execute(): Promise<void> {
    const { args } = await this.parse(EpicActivate);

    let epicId = args.id;

    // If no ID provided, prompt for selection (show only non-active epics)
    if (!epicId) {
      const epics = await this.storage.listEpics();
      const activatable = epics.filter(e => e.status !== 'active');

      if (activatable.length === 0) {
        this.log(styles.muted('\nNo epics available to activate.'));
        return;
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select epic to activate:',
        choices: activatable.map(e => ({
          name: `${e.id} ${e.title} (${e.status})`,
          value: e.id,
        })),
      }]);
      epicId = selected;
    }

    const epic = await this.storage.getEpic(epicId!);
    if (!epic) {
      this.error(`Epic not found: ${epicId}`);
    }

    if (epic.status === 'active') {
      this.log(styles.muted(`Epic ${epicId} is already active.`));
      return;
    }

    // Warn if reactivating a complete epic
    if (epic.status === 'complete') {
      const tickets = await this.storage.getTicketsForEpic(epicId!);
      const doneTickets = tickets.filter((t: Ticket) => t.status === 'done').length;

      this.log(styles.warning(`\n⚠️  This epic was previously completed (${doneTickets}/${tickets.length} tickets done)`));
      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Reactivate this epic?',
        choices: [
          { name: 'No', value: false },
          { name: 'Yes', value: true },
        ],
        default: false,
      }]);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    this.log(`\nActivating: ${epicId} "${epic.title}"`);
    this.log(`Current status: ${epic.status}`);

    const previousStatus = epic.status;

    // Move the epic file to active status directory
    const moveResult = moveEpicFile(this.pmoPath, epicId!, previousStatus, 'active', this.projectId);

    await this.storage.updateEpic(epicId!, { status: 'active' });

    this.log(styles.success(`\n✅ Activated epic ${styles.emphasis(epicId)} "${epic.title}"`));
    this.log(styles.muted(`   Status: ${previousStatus} → active`));
    if (moveResult) {
      const relativePath = getRelativeEpicPath(this.pmoPath, epicId!, 'active', this.projectId);
      this.log(styles.muted(`   File: ${relativePath}`));
    }
    this.log(styles.muted('\nNext steps:'));
    this.log(styles.muted(`  prlt epic view ${epicId}`));
    this.log(styles.muted(`  prlt ticket create --epic ${epicId} "First task"`));
  }
}
