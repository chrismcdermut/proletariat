import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class EpicSpec extends Command {
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
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
    unlink: Flags.boolean({
      char: 'u',
      description: 'Remove spec from epic instead of adding',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EpicSpec);

    const { storage } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Get all epics
      const epics = await storage.listEpics();
      if (epics.length === 0) {
        this.log(styles.muted('\nNo epics found. Create one with: prlt epic create'));
        await storage.close();
        return;
      }

      let epicId = args.epicId;

      // If no epic ID provided, prompt for selection
      if (!epicId) {
        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select epic:',
          choices: epics.map(e => {
            const specLabel = e.specId ? ` [spec: ${e.specId}]` : '';
            return {
              name: `${e.id} ${e.title} (${e.status})${specLabel}`,
              value: e.id,
            };
          }),
        }]);
        epicId = selected;
      }

      // Validate epic exists
      const epic = epics.find(e => e.id === epicId);
      if (!epic) {
        await storage.close();
        this.error(`Epic not found: ${epicId}`);
      }

      // Handle unlink
      if (flags.unlink) {
        if (!epic.specId) {
          this.log(styles.muted(`\nEpic ${epicId} is not linked to any spec.`));
        } else {
          const oldSpecId = epic.specId;
          await storage.updateEpic(epicId!, { specId: undefined });
          this.log(styles.success(`\n✅ Unlinked spec "${styles.emphasis(oldSpecId)}" from epic ${styles.emphasis(epicId!)} "${epic.title}"`));
        }
        await storage.close();
        return;
      }

      // Get all specs
      const specs = await storage.listSpecs();
      if (specs.length === 0) {
        this.log(styles.muted('\nNo specs found. Create one with: prlt spec create'));
        await storage.close();
        return;
      }

      let specId = args.specId;

      // If no spec ID provided, prompt for selection
      if (!specId) {
        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: `Select spec to link to ${epicId}:`,
          choices: specs.map(s => ({
            name: `${s.id} - ${s.title} (${s.status})`,
            value: s.id,
          })),
        }]);
        specId = selected;
      }

      // Validate spec exists
      const spec = specs.find(s => s.id === specId);
      if (!spec) {
        await storage.close();
        this.error(`Spec not found: ${specId}`);
      }

      // Check if already linked
      if (epic.specId === specId) {
        this.log(styles.muted(`\nEpic "${epicId}" is already linked to spec "${specId}".`));
        await storage.close();
        return;
      }

      // Warn if epic has different spec
      if (epic.specId) {
        this.log(styles.warning(`Epic "${epicId}" is currently linked to spec "${epic.specId}"`));
        this.log(styles.muted(`This will replace the existing spec link.`));
      }

      // Reconciliation: Check if epic's tickets have different specs
      const epicTickets = await storage.getTicketsForEpic(epicId!);
      const ticketsWithDifferentSpec = epicTickets.filter(t => t.specId && t.specId !== specId);

      if (ticketsWithDifferentSpec.length > 0) {
        this.log(styles.warning(`\n⚠️  ${ticketsWithDifferentSpec.length} ticket(s) in this epic have different specs:`));
        for (const t of ticketsWithDifferentSpec.slice(0, 5)) {
          this.log(styles.muted(`   - ${t.id}: spec "${t.specId}"`));
        }
        if (ticketsWithDifferentSpec.length > 5) {
          this.log(styles.muted(`   ... and ${ticketsWithDifferentSpec.length - 5} more`));
        }

        const { action } = await inquirer.prompt([{
          type: 'list',
          name: 'action',
          message: 'How to handle spec mismatch?',
          choices: [
            { name: 'Update epic only (tickets keep their specs)', value: 'epic_only' },
            { name: `Update epic AND align all tickets to "${specId}"`, value: 'align_all' },
            { name: 'Cancel', value: 'cancel' },
          ],
        }]);

        if (action === 'cancel') {
          await storage.close();
          return;
        }

        if (action === 'align_all') {
          for (const t of ticketsWithDifferentSpec) {
            await storage.updateTicket(t.id, { specId });
            this.log(styles.muted(`   Updated ${t.id} to spec "${specId}"`));
          }
        }
      }

      // Link spec to epic
      await storage.updateEpic(epicId!, { specId });
      await storage.close();

      this.log(styles.success(`\n✅ Linked epic ${styles.emphasis(epicId!)} "${epic.title}" to spec ${styles.emphasis(specId!)}`));
      this.log(styles.muted(`   Spec: ${spec.title}`));
      this.log(styles.muted(`\nView epic: prlt epic view ${epicId}`));

    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
