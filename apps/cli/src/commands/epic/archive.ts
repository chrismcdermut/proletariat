import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { Ticket } from '../../lib/pmo/types.js';
import { moveEpicFile, getRelativeEpicPath } from '../../lib/pmo/epic-files.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class EpicArchive extends PMOCommand {
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
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Skip ticket completion check',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(EpicArchive);
    const projectId = await this.requireProject();

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('epic archive', flags));
        this.exit(1);
      }
      this.error(message);
    };

    let epicId = args.id;

    // If no ID provided, prompt for selection (show only non-complete epics)
    if (!epicId) {
      const epics = await this.storage.listEpics(projectId);
      const archivable = epics.filter(e => e.status !== 'complete' && e.status !== 'dropped');

      if (archivable.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_EPICS_TO_ARCHIVE', 'No epics available to archive.', createMetadata('epic archive', flags));
          return;
        }
        this.log(styles.muted('\nNo epics available to archive.'));
        return;
      }

      // Get ticket counts
      const choices = await Promise.all(archivable.map(async e => {
        const tickets = await this.storage.getTicketsForEpic(projectId, e.id);
        const done = tickets.filter((t: Ticket) => t.status === 'done').length;
        const complete = done === tickets.length && tickets.length > 0;
        return {
          name: `${e.id} ${e.title} (${e.status}) [${done}/${tickets.length} tickets complete]${complete ? ' ✅' : ''}`,
          value: e.id,
          command: `prlt epic archive ${e.id} --json`,
        };
      }));

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic archive' } : null;
      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select epic to archive:',
        choices,
      }], jsonModeConfig);
      epicId = selected;
    }

    const epic = await this.storage.getEpic(epicId!);
    if (!epic) {
      return handleError('EPIC_NOT_FOUND', `Epic not found: ${epicId}`);
    }

    if (epic.status === 'complete') {
      this.log(styles.muted(`Epic ${epicId} is already archived.`));
      return;
    }

    // Check ticket completion
    const tickets = await this.storage.getTicketsForEpic(projectId, epicId!);
    const doneTickets = tickets.filter((t: Ticket) => t.status === 'done').length;
    const allComplete = doneTickets === tickets.length;

    if (!allComplete && !flags.force) {
      if (!jsonMode) {
        this.log(styles.warning(`\n⚠️  Not all tickets are complete (${doneTickets}/${tickets.length} done)`));
      }

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic archive' } : null;
      const { confirm } = await this.prompt<{ confirm: boolean }>([{
        type: 'list',
        name: 'confirm',
        message: `Not all tickets are complete (${doneTickets}/${tickets.length} done). Continue archiving anyway?`,
        choices: [
          { name: 'No', value: false, command: '' },
          { name: 'Yes', value: true, command: `prlt epic archive ${epicId} --force --json` },
        ],
      }], jsonModeConfig);

      if (!confirm) {
        this.log(styles.muted('Cancelled.'));
        return;
      }
    }

    this.log(`\nArchiving: ${epicId} "${epic.title}"`);
    this.log(`Status: ${doneTickets}/${tickets.length} tickets complete${allComplete ? ' ✅' : ''}`);

    // Move the epic file to complete status directory
    const moveResult = moveEpicFile(this.pmoPath, epicId!, epic.status, 'complete', projectId);

    await this.storage.updateEpic(epicId!, { status: 'complete' });

    this.log(styles.success(`\n✅ Archived epic ${styles.emphasis(epicId)} "${epic.title}"`));
    this.log(styles.muted(`   Status: ${epic.status} → complete`));
    if (moveResult) {
      const relativePath = getRelativeEpicPath(this.pmoPath, epicId!, 'complete', projectId);
      this.log(styles.muted(`   File: ${relativePath}`));
    }
    this.log(styles.muted('\nView archived epics:'));
    this.log(styles.muted('  prlt epic list --status complete'));
  }
}
