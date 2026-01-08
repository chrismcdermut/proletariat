import { Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TicketsSpec extends PMOCommand {
  static description = 'Bulk assign tickets to a spec';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --spec SPEC-001',
  ];

  static flags = {
    ...pmoBaseFlags,
    spec: Flags.string({
      char: 's',
      description: 'Spec ID to assign to all selected tickets',
    }),
    unlink: Flags.boolean({
      char: 'u',
      description: 'Remove spec from selected tickets instead',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(TicketsSpec);

    // Get all tickets
    const tickets = await this.storage.listTickets();
    if (tickets.length === 0) {
      this.log(styles.muted('\nNo tickets found.'));
      return;
    }

    // Select tickets
    const { selectedTickets } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedTickets',
      message: 'Select tickets to update:',
      choices: tickets.map(t => {
        const specLabel = t.specId ? ` [spec: ${t.specId}]` : '';
        return {
          name: `${t.id} - ${t.title}${specLabel}`,
          value: t.id,
        };
      }),
    }]);

    if (selectedTickets.length === 0) {
      this.log(styles.muted('No tickets selected.'));
      return;
    }

    // Handle unlink
    if (flags.unlink) {
      for (const ticketId of selectedTickets) {
        await this.storage.updateTicket(ticketId, { specId: undefined });
        this.log(styles.success(`  Unlinked spec from ${ticketId}`));
      }
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));
      this.log(styles.success(`\n✅ Unlinked spec from ${selectedTickets.length} ticket(s)`));
      return;
    }

    // Get spec to assign
    let specId = flags.spec;

    if (!specId) {
      const specs = await this.storage.listSpecs();
      if (specs.length === 0) {
        this.log(styles.muted('\nNo specs found. Create one with: prlt spec create'));
        return;
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select spec to assign:',
        choices: specs.map(s => ({
          name: `${s.id} - ${s.title} (${s.status})`,
          value: s.id,
        })),
      }]);
      specId = selected;
    }

    // Validate spec
    const spec = await this.storage.getSpec(specId!);
    if (!spec) {
      this.error(`Spec not found: ${specId}`);
    }

    // Assign spec to all selected tickets
    for (const ticketId of selectedTickets) {
      await this.storage.updateTicket(ticketId, { specId });
      this.log(styles.success(`  Linked ${ticketId} to ${specId}`));
    }

    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    this.log(styles.success(`\n✅ Linked ${selectedTickets.length} ticket(s) to spec "${spec.title}"`));
  }
}
