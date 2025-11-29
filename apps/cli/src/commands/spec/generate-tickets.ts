import { Command, Flags, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { findPMO, getPMOContext, autoExportToBoard } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

interface SpecTicket {
  id?: string;
  title: string;
  description?: string;
  column: string;
  priority?: string;
  category?: string;
}

export default class SpecGenerateTickets extends Command {
  static description = 'Generate tickets from a spec document';

  static examples = [
    '<%= config.bin %> <%= command.id %> user-authentication',
    '<%= config.bin %> <%= command.id %> --spec api-design --dry-run',
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
    'dry-run': Flags.boolean({
      description: 'Show what would be created without creating tickets',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SpecGenerateTickets);

    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    // Get PMO context (prompt for project if multiple exist)
    const { projectId, projectName, storage, columns } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true // prompt if multiple projects
    );

    // Get spec ID
    let specId = args.spec || flags.spec;
    if (!specId) {
      // List available specs and prompt
      const specs = await this.listAvailableSpecs(pmoPath, projectId);
      if (specs.length === 0) {
        this.error('No specs found. Create one first with: prlt spec create');
      }

      const { selectedSpec } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedSpec',
        message: 'Select spec to generate tickets from:',
        choices: specs.map(s => ({ name: `${s.name} (${s.status})`, value: s.id })),
      }]);
      specId = selectedSpec;
    }

    if (!specId) {
      this.error('No spec selected');
    }

    // Find the spec file
    const specPath = this.findSpecFile(pmoPath, projectId, specId);
    if (!specPath) {
      this.error(`Spec "${specId}" not found in project "${projectName}"`);
    }

    // Parse spec and extract tickets
    const specContent = fs.readFileSync(specPath, 'utf-8');
    const tickets = this.parseSpecTickets(specContent);

    if (tickets.length === 0) {
      this.error('No tickets found in spec frontmatter. Add a "tickets:" section to the frontmatter.');
    }

    // Validate columns
    const invalidColumns = tickets.filter(t => !columns.includes(t.column));
    if (invalidColumns.length > 0) {
      this.error(`Invalid columns found: ${invalidColumns.map(t => `"${t.column}"`).join(', ')}\nAvailable columns: ${columns.join(', ')}`);
    }

    // Show what will be created
    this.log(styles.title(`\n📄 Generate Tickets from Spec: ${specId}`));
    this.log(styles.muted(`Project: ${projectName}`));
    this.log(styles.muted('═'.repeat(60)));
    this.log(styles.emphasis(`\nFound ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} to create:\n`));

    for (const ticket of tickets) {
      const priority = ticket.priority ? ` [${ticket.priority}]` : '';
      const category = ticket.category ? ` {${ticket.category}}` : '';
      this.log(`  ${styles.code(ticket.id || 'auto')}: ${ticket.title}${priority}${category}`);
      this.log(styles.muted(`     Column: ${ticket.column}`));
      if (ticket.description) {
        const shortDesc = ticket.description.substring(0, 60);
        this.log(styles.muted(`     ${shortDesc}${ticket.description.length > 60 ? '...' : ''}`));
      }
    }

    if (flags['dry-run']) {
      this.log(styles.muted('\nDry run - no tickets created.'));
      return;
    }

    // Confirm creation
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Create these tickets?',
      default: true,
    }]);

    if (!confirm) {
      this.log(styles.warning('Cancelled.'));
      return;
    }

    // Create tickets
    const createdTickets = [];
    for (const ticketData of tickets) {
      try {
        const ticket = await storage.createTicket({
          id: ticketData.id,
          title: ticketData.title,
          column: ticketData.column,
          priority: ticketData.priority,
          category: ticketData.category,
          description: ticketData.description,
          specs: [specId!],
        });
        createdTickets.push(ticket);
      } catch (error) {
        this.warn(`Failed to create ticket "${ticketData.id || ticketData.title}": ${error}`);
      }
    }

    // Auto-export to board.md
    await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));

    await storage.close();

    this.log(styles.success(`\n✅ Created ${createdTickets.length} ticket${createdTickets.length === 1 ? '' : 's'} from spec "${specId}"`));
    this.log(styles.muted(`\nView the board:`));
    this.log(styles.muted(`  prlt board`));
    this.log(styles.muted(`  prlt ticket list`));
  }

  private async listAvailableSpecs(pmoPath: string, projectId: string): Promise<Array<{ id: string; name: string; status: string }>> {
    const specsBasePath = path.join(pmoPath, 'projects', projectId, 'specs');
    const specs: Array<{ id: string; name: string; status: string }> = [];

    if (!fs.existsSync(specsBasePath)) {
      return specs;
    }

    for (const status of ['active', 'draft']) {
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

  private parseSpecTickets(content: string): SpecTicket[] {
    const tickets: SpecTicket[] = [];

    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return tickets;
    }

    const frontmatter = frontmatterMatch[1];

    // Find tickets section in frontmatter
    const ticketsMatch = frontmatter.match(/^tickets:([\s\S]*?)(?=\n\w|$)/m);
    if (!ticketsMatch) {
      return tickets;
    }

    const ticketsSection = ticketsMatch[1];

    // Parse each ticket (YAML list format)
    // Split by "  - id:" to find individual tickets
    const ticketBlocks = ticketsSection.split(/\n  - id:/);

    for (let i = 1; i < ticketBlocks.length; i++) {
      const block = ticketBlocks[i];
      const lines = block.split('\n');

      const ticket: SpecTicket = {
        title: '',
        column: 'Ready',
      };

      // First line is the ID value
      const idMatch = lines[0].match(/^\s*(.+)/);
      if (idMatch) {
        ticket.id = idMatch[1].trim();
      }

      // Parse remaining fields
      for (const line of lines.slice(1)) {
        const titleMatch = line.match(/^\s+title:\s*(.+)/);
        if (titleMatch) {
          ticket.title = titleMatch[1].trim();
          continue;
        }

        const descMatch = line.match(/^\s+description:\s*(.+)/);
        if (descMatch) {
          ticket.description = descMatch[1].trim();
          continue;
        }

        const columnMatch = line.match(/^\s+column:\s*(.+)/);
        if (columnMatch) {
          ticket.column = columnMatch[1].trim();
          continue;
        }

        const priorityMatch = line.match(/^\s+priority:\s*(.+)/);
        if (priorityMatch) {
          ticket.priority = priorityMatch[1].trim();
          continue;
        }

        const categoryMatch = line.match(/^\s+category:\s*(.+)/);
        if (categoryMatch) {
          ticket.category = categoryMatch[1].trim();
          continue;
        }
      }

      if (ticket.title) {
        tickets.push(ticket);
      }
    }

    return tickets;
  }
}
