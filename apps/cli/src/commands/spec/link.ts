import { Command, Flags, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { findPMO, getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class SpecLink extends Command {
  static description = 'Link a ticket to a spec document';

  static examples = [
    '<%= config.bin %> <%= command.id %> PRLT-001 user-authentication',
    '<%= config.bin %> <%= command.id %> --ticket PRLT-001 --spec api-design',
  ];

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID',
      required: false,
    }),
    specId: Args.string({
      description: 'Spec ID (filename without .md)',
      required: false,
    }),
  };

  static flags = {
    ticket: Flags.string({
      char: 't',
      description: 'Ticket ID',
    }),
    spec: Flags.string({
      char: 's',
      description: 'Spec ID (filename without .md)',
    }),
    project: Flags.string({
      char: 'p',
      description: 'Project ID (will prompt if not specified)',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SpecLink);

    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    // Get PMO context (prompt for project if multiple exist)
    const { projectId, projectName, storage } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true // prompt if multiple projects
    );

    // Get ticket ID
    let ticketId = args.ticketId || flags.ticket;
    if (!ticketId) {
      const tickets = await storage.listTickets();
      if (tickets.length === 0) {
        this.error('No tickets found. Create one first with: prlt ticket create');
      }

      const { selectedTicket } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedTicket',
        message: 'Select ticket to link:',
        choices: tickets.map(t => ({ name: `${t.id}: ${t.title}`, value: t.id })),
      }]);
      ticketId = selectedTicket;
    }

    if (!ticketId) {
      this.error('No ticket selected');
    }

    // Get ticket
    const ticket = await storage.getTicket(ticketId);
    if (!ticket) {
      this.error(`Ticket "${ticketId}" not found in project "${projectName}"`);
    }

    // Get spec ID
    let specId = args.specId || flags.spec;
    if (!specId) {
      const specs = await this.listAvailableSpecs(pmoPath, projectId);
      if (specs.length === 0) {
        this.error('No specs found. Create one first with: prlt spec create');
      }

      const { selectedSpec } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedSpec',
        message: 'Select spec to link:',
        choices: specs.map(s => ({ name: `${s.name} (${s.status})`, value: s.id })),
      }]);
      specId = selectedSpec;
    }

    if (!specId) {
      this.error('No spec selected');
    }

    // Verify spec exists
    const specPath = this.findSpecFile(pmoPath, projectId, specId);
    if (!specPath) {
      this.error(`Spec "${specId}" not found in project "${projectName}"`);
    }

    // Check if already linked
    if (ticket.specs.includes(specId)) {
      this.log(styles.warning(`Ticket "${ticketId}" is already linked to spec "${specId}"`));
      await storage.close();
      return;
    }

    // Add spec to ticket
    const updatedSpecs = [...ticket.specs, specId];
    await storage.updateTicket(ticketId, { specs: updatedSpecs });

    // Auto-export to board.md
    await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));

    await storage.close();

    this.log(styles.success(`\n✅ Linked ticket "${styles.emphasis(ticketId)}" to spec "${styles.emphasis(specId)}"`));
    this.log(styles.muted(`\nView ticket:`));
    this.log(styles.muted(`  prlt ticket view ${ticketId}`));
  }

  private async listAvailableSpecs(pmoPath: string, projectId: string): Promise<Array<{ id: string; name: string; status: string }>> {
    const specsBasePath = path.join(pmoPath, 'projects', projectId, 'specs');
    const specs: Array<{ id: string; name: string; status: string }> = [];

    if (!fs.existsSync(specsBasePath)) {
      return specs;
    }

    for (const status of ['active', 'draft', 'archived']) {
      const statusPath = path.join(specsBasePath, status);
      if (!fs.existsSync(statusPath)) {
        continue;
      }

      const files = fs.readdirSync(statusPath).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const id = path.basename(file, '.md');
        specs.push({ id, name: id, status });
      }
    }

    return specs;
  }

  private findSpecFile(pmoPath: string, projectId: string, specId: string): string | null {
    const specsBasePath = path.join(pmoPath, 'projects', projectId, 'specs');

    for (const status of ['active', 'draft', 'archived']) {
      const specPath = path.join(specsBasePath, status, `${specId}.md`);
      if (fs.existsSync(specPath)) {
        return specPath;
      }
    }

    return null;
  }
}
