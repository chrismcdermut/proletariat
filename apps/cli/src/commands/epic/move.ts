import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { EpicStatus, Ticket } from '../../lib/pmo/types.js';
import { moveEpicFile, getRelativeEpicPath } from '../../lib/pmo/epic-files.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

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
    const projectId = await this.requireProject();

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('epic move', flags));
        this.exit(1);
      }
      this.error(message);
    };

    let epicId = args.id;
    let targetStatus = args.status as EpicStatus | undefined;

    // If no ID provided, prompt for selection
    if (!epicId) {
      const epics = await this.storage.listEpics(projectId);
      if (epics.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_EPICS', 'No epics found.', createMetadata('epic move', flags));
          return;
        }
        this.log(styles.muted('\nNo epics found.'));
        return;
      }

      // Get ticket counts
      const choices = await Promise.all(epics.map(async e => {
        const tickets = await this.storage.getTicketsForEpic(projectId, e.id);
        const done = tickets.filter((t: Ticket) => t.status === 'done').length;
        return {
          name: `${e.id} ${e.title} (${e.status}) [${done}/${tickets.length} complete]`,
          value: e.id,
          command: `prlt epic move ${e.id} --json`,
        };
      }));

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic move' } : null;
      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select epic to move:',
        choices,
      }], jsonModeConfig);
      epicId = selected;
    }

    const epic = await this.storage.getEpic(epicId!);
    if (!epic) {
      return handleError('EPIC_NOT_FOUND', `Epic not found: ${epicId}`);
    }

    // If no status provided, prompt for selection
    if (!targetStatus) {
      const statusChoices = STATUS_CHOICES.filter(c => c.value !== epic.status).map(c => ({
        ...c,
        command: `prlt epic move ${epicId} ${c.value} --json`,
      }));

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic move' } : null;
      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Move to which status?',
        choices: statusChoices,
      }], jsonModeConfig);
      targetStatus = selected as EpicStatus;
    }

    if (targetStatus === epic.status) {
      this.log(styles.muted(`Epic ${epicId} is already in ${targetStatus} status.`));
      return;
    }

    // Validation checks
    const tickets = await this.storage.getTicketsForEpic(projectId, epicId!);
    const doneTickets = tickets.filter((t: Ticket) => t.status === 'done').length;
    const allComplete = doneTickets === tickets.length;

    // Moving to complete - check ticket completion
    if (targetStatus === 'complete' && !allComplete && !flags.force) {
      if (!jsonMode) {
        this.log(styles.warning(`\n⚠️  Not all tickets are complete (${doneTickets}/${tickets.length} done)`));
      }

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic move' } : null;
      const { confirm } = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: `Not all tickets are complete (${doneTickets}/${tickets.length} done). Continue moving to complete anyway?`,
        choices: [
          { name: 'No', value: false, command: '' },
          { name: 'Yes', value: true, command: `prlt epic move ${epicId} complete --force --json` },
        ],
      }], jsonModeConfig);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    // Moving to dropped - confirm cancellation
    if (targetStatus === 'dropped' && !flags.force) {
      if (!jsonMode) {
        this.log(styles.warning('\n⚠️  This will mark the epic as dropped/cancelled'));
      }

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic move' } : null;
      const { confirm } = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: 'This will mark the epic as dropped/cancelled. Continue?',
        choices: [
          { name: 'No', value: false, command: '' },
          { name: 'Yes', value: true, command: `prlt epic move ${epicId} dropped --force --json` },
        ],
      }], jsonModeConfig);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    this.log(`\nMoving: ${epicId} "${epic.title}"`);
    this.log(`From: ${epic.status} → ${targetStatus}`);

    // Move the epic file to new status directory
    const moveResult = moveEpicFile(this.pmoPath, epicId!, epic.status, targetStatus, projectId);

    await this.storage.updateEpic(epicId!, { status: targetStatus });

    this.log(styles.success(`\n✅ Moved epic ${styles.emphasis(epicId)} "${epic.title}" to ${targetStatus}`));
    if (moveResult) {
      const relativePath = getRelativeEpicPath(this.pmoPath, epicId!, targetStatus, projectId);
      this.log(styles.muted(`   File: ${relativePath}`));
    }
  }
}
