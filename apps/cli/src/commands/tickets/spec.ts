import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class TicketsSpec extends Command {
  static description = 'Bulk assign tickets to a spec';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --spec SPEC-001',
  ];

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: current)',
    }),
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

  async run(): Promise<void> {
    const { flags } = await this.parse(TicketsSpec);

    const { storage, pmoPath } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Get all tickets
      const tickets = await storage.listTickets();
      if (tickets.length === 0) {
        this.log(styles.muted('\nNo tickets found.'));
        await storage.close();
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
        await storage.close();
        return;
      }

      // Handle unlink
      if (flags.unlink) {
        for (const ticketId of selectedTickets) {
          await storage.updateTicket(ticketId, { specId: undefined });
          this.log(styles.success(`  Unlinked spec from ${ticketId}`));
        }
        await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));
        await storage.close();
        this.log(styles.success(`\n✅ Unlinked spec from ${selectedTickets.length} ticket(s)`));
        return;
      }

      // Get spec to assign
      let specId = flags.spec;

      if (!specId) {
        const specs = await storage.listSpecs();
        if (specs.length === 0) {
          this.log(styles.muted('\nNo specs found. Create one with: prlt spec create'));
          await storage.close();
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
      const spec = await storage.getSpec(specId!);
      if (!spec) {
        await storage.close();
        this.error(`Spec not found: ${specId}`);
      }

      // Assign spec to all selected tickets
      for (const ticketId of selectedTickets) {
        await storage.updateTicket(ticketId, { specId });
        this.log(styles.success(`  Linked ${ticketId} to ${specId}`));
      }

      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));
      await storage.close();

      this.log(styles.success(`\n✅ Linked ${selectedTickets.length} ticket(s) to spec "${spec.title}"`));

    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
