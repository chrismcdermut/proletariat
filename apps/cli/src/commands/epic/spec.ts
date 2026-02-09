import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class EpicSpec extends PMOCommand {
  static description = 'Assign a spec to an epic (design document)';

  static examples = [
    '<%= config.bin %> <%= command.id %> EPIC-001 SPEC-001',
    '<%= config.bin %> <%= command.id %> EPIC-001',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> EPIC-001 --unlink',
  ];

  static args = {
    epicId: Args.string({
      description: 'Epic ID',
      required: false,
    }),
    specId: Args.string({
      description: 'Spec ID to link',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    unlink: Flags.boolean({
      char: 'u',
      description: 'Remove spec from epic instead of adding',
      default: false,
    }),
    'align-tickets': Flags.boolean({
      description: 'Also update all tickets in the epic to use the same spec',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(EpicSpec);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('epic spec', flags));
        this.exit(1);
      }
      this.error(message);
    };

    const projectId = await this.requireProject();

    // Get all epics
    const epics = await this.storage.listEpics(projectId);
    if (epics.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_EPICS', 'No epics found.', createMetadata('epic spec', flags));
        return;
      }
      this.log(styles.muted('\nNo epics found. Create one with: prlt epic create'));
      return;
    }

    let epicId = args.epicId;

    // If no epic ID provided, prompt for selection
    if (!epicId) {
      const epicChoices = epics.map(e => {
        const specLabel = e.specId ? ` [spec: ${e.specId}]` : '';
        return {
          name: `${e.id} ${e.title} (${e.status})${specLabel}`,
          value: e.id,
          command: `prlt epic spec ${e.id} --json`,
        };
      });

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic spec' } : null;
      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select epic:',
        choices: epicChoices,
      }], jsonModeConfig);
      epicId = selected;
    }

    // Validate epic exists
    const epic = epics.find(e => e.id === epicId);
    if (!epic) {
      return handleError('EPIC_NOT_FOUND', `Epic not found: ${epicId}`);
    }

    // Handle unlink
    if (flags.unlink) {
      if (!epic.specId) {
        this.log(styles.muted(`\nEpic ${epicId} is not linked to any spec.`));
      } else {
        const oldSpecId = epic.specId;
        await this.storage.updateEpic(epicId!, { specId: undefined });
        this.log(styles.success(`\n✅ Unlinked spec "${styles.emphasis(oldSpecId)}" from epic ${styles.emphasis(epicId!)} "${epic.title}"`));
      }
      return;
    }

    // Get all specs
    const specs = await this.storage.listSpecs();
    if (specs.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_SPECS', 'No specs found.', createMetadata('epic spec', flags));
        return;
      }
      this.log(styles.muted('\nNo specs found. Create one with: prlt spec create'));
      return;
    }

    let specId = args.specId;

    // If no spec ID provided, prompt for selection
    if (!specId) {
      const specChoices = specs.map(s => ({
        name: `${s.id} - ${s.title} (${s.status})`,
        value: s.id,
        command: `prlt epic spec ${epicId} ${s.id} --json`,
      }));

      const jsonModeConfig = jsonMode ? { flags, commandName: 'epic spec' } : null;
      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: `Select spec to link to ${epicId}:`,
        choices: specChoices,
      }], jsonModeConfig);
      specId = selected;
    }

    // Validate spec exists
    const spec = specs.find(s => s.id === specId);
    if (!spec) {
      this.error(`Spec not found: ${specId}`);
    }

    // Check if already linked
    if (epic.specId === specId) {
      this.log(styles.muted(`\nEpic "${epicId}" is already linked to spec "${specId}".`));
      return;
    }

    // Warn if epic has different spec
    if (epic.specId) {
      this.log(styles.warning(`Epic "${epicId}" is currently linked to spec "${epic.specId}"`));
      this.log(styles.muted(`This will replace the existing spec link.`));
    }

    // Reconciliation: Check if epic's tickets have different specs
    const epicTickets = await this.storage.getTicketsForEpic(projectId, epicId!);
    const ticketsWithDifferentSpec = epicTickets.filter(t => t.specId && t.specId !== specId);

    if (ticketsWithDifferentSpec.length > 0) {
      // If --align-tickets flag provided, skip prompt and align all
      let action: string;
      if (flags['align-tickets']) {
        action = 'align_all';
      } else {
        if (!jsonMode) {
          this.log(styles.warning(`\n⚠️  ${ticketsWithDifferentSpec.length} ticket(s) in this epic have different specs:`));
          for (const t of ticketsWithDifferentSpec.slice(0, 5)) {
            this.log(styles.muted(`   - ${t.id}: spec "${t.specId}"`));
          }
          if (ticketsWithDifferentSpec.length > 5) {
            this.log(styles.muted(`   ... and ${ticketsWithDifferentSpec.length - 5} more`));
          }
        }

        const mismatchChoices = [
          { name: 'Update epic only (tickets keep their specs)', value: 'epic_only', command: `prlt epic spec ${epicId} ${specId} --json` },
          { name: `Update epic AND align all tickets to "${specId}"`, value: 'align_all', command: `prlt epic spec ${epicId} ${specId} --align-tickets --json` },
          { name: 'Cancel', value: 'cancel', command: '' },
        ];

        const jsonModeConfig = jsonMode ? { flags, commandName: 'epic spec' } : null;
        const result = await this.prompt<{ action: string }>([{
          type: 'list',
          name: 'action',
          message: `${ticketsWithDifferentSpec.length} ticket(s) in this epic have different specs. How to handle spec mismatch?`,
          choices: mismatchChoices,
        }], jsonModeConfig);
        action = result.action;
      }

      if (action === 'cancel') {
        return;
      }

      if (action === 'align_all') {
        // Update sequentially for clear logging
        for (const t of ticketsWithDifferentSpec) {
          // eslint-disable-next-line no-await-in-loop
          await this.storage.updateTicket(t.id, { specId });
          this.log(styles.muted(`   Updated ${t.id} to spec "${specId}"`));
        }
      }
    }

    // Link spec to epic
    await this.storage.updateEpic(epicId!, { specId });

    this.log(styles.success(`\n✅ Linked epic ${styles.emphasis(epicId!)} "${epic.title}" to spec ${styles.emphasis(specId!)}`));
    this.log(styles.muted(`   Spec: ${spec.title}`));
    this.log(styles.muted(`\nView epic: prlt epic view ${epicId}`));
  }
}
