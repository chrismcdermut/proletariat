import { Args, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { EpicStatus, Ticket } from '../../lib/pmo/types.js';
import { moveEpicFile, getRelativeEpicPath } from '../../lib/pmo/epic-files.js';

const STATUS_CHOICES = [
  { name: 'active (currently working on)', value: 'active' },
  { name: 'draft (planning phase)', value: 'draft' },
  { name: 'complete (all work done)', value: 'complete' },
  { name: 'dropped (cancelled/won\'t do)', value: 'dropped' },
  { name: 'future (backlog for later)', value: 'future' },
];

export default class EpicMove extends PMOCommand {
  static description = 'Move epic between status folders';

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-002 complete',
    '<%= config.bin %> <%= command.id %> --force',
  ];

  static args = {
    id: Args.string({
      description: 'Epic ID',
      required: false,
    }),
    status: Args.string({
      description: 'Target status',
      required: false,
      options: ['active', 'draft', 'complete', 'dropped', 'future'],
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip validation checks',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(EpicMove);

    let epicId = args.id;
    let targetStatus = args.status as EpicStatus | undefined;

    // If no ID provided, prompt for selection
    if (!epicId) {
      const epics = await this.storage.listEpics();
      if (epics.length === 0) {
        this.log(styles.muted('\nNo epics found.'));
        return;
      }

      // Get ticket counts
      const choices = await Promise.all(epics.map(async e => {
        const tickets = await this.storage.getTicketsForEpic(e.id);
        const done = tickets.filter((t: Ticket) => t.status === 'done').length;
        return {
          name: `${e.id} ${e.title} (${e.status}) [${done}/${tickets.length} complete]`,
          value: e.id,
        };
      }));

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select epic to move:',
        choices,
      }]);
      epicId = selected;
    }

    const epic = await this.storage.getEpic(epicId!);
    if (!epic) {
      this.error(`Epic not found: ${epicId}`);
    }

    // If no status provided, prompt for selection
    if (!targetStatus) {
      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Move to which status?',
        choices: STATUS_CHOICES.filter(c => c.value !== epic.status),
      }]);
      targetStatus = selected as EpicStatus;
    }

    if (targetStatus === epic.status) {
      this.log(styles.muted(`Epic ${epicId} is already in ${targetStatus} status.`));
      return;
    }

    // Validation checks
    const tickets = await this.storage.getTicketsForEpic(epicId!);
    const doneTickets = tickets.filter((t: Ticket) => t.status === 'done').length;
    const allComplete = doneTickets === tickets.length;

    // Moving to complete - check ticket completion
    if (targetStatus === 'complete' && !allComplete && !flags.force) {
      this.log(styles.warning(`\n⚠️  Not all tickets are complete (${doneTickets}/${tickets.length} done)`));
      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Continue moving to complete anyway?',
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

    // Moving to dropped - confirm cancellation
    if (targetStatus === 'dropped' && !flags.force) {
      this.log(styles.warning('\n⚠️  This will mark the epic as dropped/cancelled'));
      const { confirm } = await inquirer.prompt([{
        type: 'list',
        name: 'confirm',
        message: 'Continue?',
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

    this.log(`\nMoving: ${epicId} "${epic.title}"`);
    this.log(`From: ${epic.status} → ${targetStatus}`);

    // Move the epic file to new status directory
    const moveResult = moveEpicFile(this.pmoPath, epicId!, epic.status, targetStatus, this.projectId);

    await this.storage.updateEpic(epicId!, { status: targetStatus });

    this.log(styles.success(`\n✅ Moved epic ${styles.emphasis(epicId)} "${epic.title}" to ${targetStatus}`));
    if (moveResult) {
      const relativePath = getRelativeEpicPath(this.pmoPath, epicId!, targetStatus, this.projectId);
      this.log(styles.muted(`   File: ${relativePath}`));
    }
  }
}
