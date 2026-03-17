import { Args, Flags } from '@oclif/core';
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { deleteEpicFile } from '../../lib/pmo/epic-files.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

export default class EpicDelete extends PMOCommand {
  static description = 'Delete an epic permanently';

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001',
    '<%= config.bin %> <%= command.id %> EPIC-001 --force',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ];

  static args = {
    id: Args.string({
      description: 'Epic ID to delete',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(EpicDelete);
    const projectId = await this.requireProject();

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('epic delete', flags));
        return
      }
      this.error(message);
    };

    let epicId = args.id;

    // If no ID provided, prompt for selection
    if (!epicId) {
      const epics = await this.storage.listEpics(projectId);

      if (epics.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_EPICS', 'No epics found.', createMetadata('epic delete', flags));
          return;
        }
        this.log(styles.muted('\nNo epics found.'));
        return;
      }

      // Build choices with ticket counts
      const choices = await Promise.all(epics.map(async e => {
        const tickets = await this.storage.getTicketsForEpic(projectId, e.id);
        return {
          name: `${e.id} ${e.title} (${e.status}) [${tickets.length} tickets]`,
          value: e.id,
        };
      }));

      // In JSON mode, output epic selection prompt
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'id', 'Select epic to delete:', choices),
          createMetadata('epic delete', flags)
        );
        return;
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select epic to delete:',
        choices,
      }], null);
      epicId = selected;
    }

    // Get the epic to show details
    const epic = await this.storage.getEpic(epicId!);
    if (!epic) {
      return handleError('EPIC_NOT_FOUND', `Epic not found: ${epicId}`);
    }

    // Get associated tickets count
    const tickets = await this.storage.getTicketsForEpic(projectId, epicId!);

    // Confirmation prompt (unless --force)
    if (!flags.force) {
      // In JSON mode, output confirmation prompt
      if (jsonMode) {
        const confirmChoices = [
          { name: 'No, cancel', value: 'false' },
          { name: 'Yes, delete permanently', value: 'true' },
        ];
        outputPromptAsJson(
          buildPromptConfig('list', 'confirm', `Delete epic '${epic.title}'?`, confirmChoices),
          createMetadata('epic delete', flags)
        );
        return;
      }

      this.log(`\nDelete epic ${styles.emphasis(epicId)}?`);
      this.log(`  Title: ${epic.title}`);
      this.log(`  Status: ${epic.status}`);
      this.log(`  Tickets: ${tickets.length} (will be unlinked, not deleted)`);

      const { confirmed } = await this.prompt<{ confirmed: boolean }>([{
        type: 'list',
        name: 'confirmed',
        message: `Delete epic '${epic.title}'?`,
        choices: [
          { name: 'No, cancel', value: false },
          { name: 'Yes, delete permanently', value: true },
        ],
        default: 0,
      }], null);

      if (!confirmed) {
        this.log(styles.muted('Deletion cancelled.'));
        return;
      }
    }

    // Delete the epic file first
    const fileDeleted = deleteEpicFile(this.pmoPath, epicId!, epic.status, projectId);

    // Delete from database (this also unlinks tickets)
    await this.storage.deleteEpic(epicId!);

    // Auto-export to board.md after deletion
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\n✅ Deleted epic ${styles.emphasis(epicId)} "${epic.title}"`));
    if (tickets.length > 0) {
      this.log(styles.muted(`   ${tickets.length} ticket(s) unlinked from epic`));
    }
    if (fileDeleted) {
      this.log(styles.muted('   Epic file removed'));
    }
  }
}
