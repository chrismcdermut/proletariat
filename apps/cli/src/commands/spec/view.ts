import { Command, Flags, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { findPMO, getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class SpecView extends Command {
  static description = 'View a spec document and its linked tickets';

  static examples = [
    '<%= config.bin %> <%= command.id %> user-authentication',
    '<%= config.bin %> <%= command.id %> --spec api-design',
  ];

  static args = {
    spec: Args.string({
      description: 'Spec ID (filename without .md)',
      required: false,
    }),
  };

  static flags = {
    spec: Flags.string({
      char: 's',
      description: 'Spec ID (filename without .md)',
    }),
    project: Flags.string({
      char: 'p',
      description: 'Project ID (will prompt if not specified)',
    }),
    full: Flags.boolean({
      char: 'f',
      description: 'Show full spec content',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SpecView);

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

    // Get spec ID
    let specId = args.spec || flags.spec;
    if (!specId) {
      const specs = await this.listAvailableSpecs(pmoPath, projectId);
      if (specs.length === 0) {
        this.error('No specs found. Create one first with: prlt spec create');
      }

      const { selectedSpec } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedSpec',
        message: 'Select spec to view:',
        choices: specs.map(s => ({ name: `${s.name} (${s.status})`, value: s.id })),
      }]);
      specId = selectedSpec;
    }

    if (!specId) {
      this.error('No spec selected');
    }

    // Find the spec file
    const specFile = this.findSpecFile(pmoPath, projectId, specId);
    if (!specFile) {
      this.error(`Spec "${specId}" not found in project "${projectName}"`);
    }

    // Read spec content
    const content = fs.readFileSync(specFile.path, 'utf-8');
    const metadata = this.parseSpecMetadata(content);

    // Find linked tickets
    const allTickets = await storage.listTickets();
    const linkedTickets = allTickets.filter(t => t.specs.includes(specId));

    // Display spec info
    this.log(styles.title(`\n📄 Spec: ${metadata.title || specId}`));
    this.log(styles.muted('═'.repeat(60)));
    this.log(styles.muted(`ID: ${specId}`));
    this.log(styles.muted(`Project: ${projectName}`));
    this.log(styles.muted(`Status: ${specFile.status}`));
    if (metadata.created) {
      this.log(styles.muted(`Created: ${new Date(metadata.created).toLocaleDateString()}`));
    }
    this.log(styles.muted(`File: ${path.relative(process.cwd(), specFile.path)}`));

    // Show linked tickets
    if (linkedTickets.length > 0) {
      this.log(styles.emphasis(`\n🎫 Linked Tickets (${linkedTickets.length}):`));
      for (const ticket of linkedTickets) {
        this.log(`  ${styles.code(ticket.id)}: ${ticket.title} [${ticket.column}]`);
      }
    } else {
      this.log(styles.muted('\n🎫 No linked tickets'));
    }

    // Show frontmatter tickets (if any)
    if (metadata.ticketDefinitions && metadata.ticketDefinitions.length > 0) {
      this.log(styles.emphasis(`\n📋 Ticket Definitions in Spec (${metadata.ticketDefinitions.length}):`));
      for (const ticket of metadata.ticketDefinitions) {
        this.log(`  ${styles.code(ticket.id || 'auto')}: ${ticket.title} [${ticket.column || 'Ready'}]`);
      }
      this.log(styles.muted('\nGenerate these tickets:'));
      this.log(styles.muted(`  prlt spec generate-tickets ${specId}`));
    }

    // Show full content if requested
    if (flags.full) {
      this.log(styles.muted('\n' + '═'.repeat(60)));
      this.log(styles.emphasis('\n📝 Content:\n'));
      this.log(content);
    } else {
      this.log(styles.muted('\n' + '═'.repeat(60)));
      this.log(styles.muted('To view full content, add --full flag'));
    }

    await storage.close();
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

  private findSpecFile(pmoPath: string, projectId: string, specId: string): { path: string; status: string } | null {
    const specsBasePath = path.join(pmoPath, 'projects', projectId, 'specs');

    for (const status of ['active', 'draft', 'archived']) {
      const specPath = path.join(specsBasePath, status, `${specId}.md`);
      if (fs.existsSync(specPath)) {
        return { path: specPath, status };
      }
    }

    return null;
  }

  private parseSpecMetadata(content: string): {
    title?: string;
    created?: string;
    ticketDefinitions?: Array<{ id?: string; title: string; column?: string }>;
  } {
    const metadata: {
      title?: string;
      created?: string;
      ticketDefinitions?: Array<{ id?: string; title: string; column?: string }>;
    } = {};

    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return metadata;
    }

    const frontmatter = frontmatterMatch[1];

    // Parse title
    const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
    if (titleMatch) {
      metadata.title = titleMatch[1].trim();
    }

    // Parse created date
    const createdMatch = frontmatter.match(/^created:\s*(.+)$/m);
    if (createdMatch) {
      metadata.created = createdMatch[1].trim();
    }

    // Parse ticket definitions
    const ticketsMatch = frontmatter.match(/^tickets:([\s\S]*?)(?=\n\w|$)/m);
    if (ticketsMatch) {
      const ticketsSection = ticketsMatch[1];
      const ticketBlocks = ticketsSection.split(/\n  - id:/);
      const tickets: Array<{ id?: string; title: string; column?: string }> = [];

      for (let i = 1; i < ticketBlocks.length; i++) {
        const block = ticketBlocks[i];
        const lines = block.split('\n');

        const ticket: { id?: string; title: string; column?: string } = { title: '' };

        // First line is the ID value
        const idMatch = lines[0].match(/^\s*(.+)/);
        if (idMatch) {
          ticket.id = idMatch[1].trim();
        }

        // Parse title and column
        for (const line of lines.slice(1)) {
          const titleMatch = line.match(/^\s+title:\s*(.+)/);
          if (titleMatch) {
            ticket.title = titleMatch[1].trim();
          }
          const columnMatch = line.match(/^\s+column:\s*(.+)/);
          if (columnMatch) {
            ticket.column = columnMatch[1].trim();
          }
        }

        if (ticket.title) {
          tickets.push(ticket);
        }
      }

      if (tickets.length > 0) {
        metadata.ticketDefinitions = tickets;
      }
    }

    return metadata;
  }
}
