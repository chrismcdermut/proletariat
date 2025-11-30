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

    // Show what will be created
    this.log(styles.title(`\n📄 Generate Tickets from Spec: ${specId}`));
    this.log(styles.muted(`Project: ${projectName}`));
    this.log(styles.muted('═'.repeat(60)));
    this.log(styles.emphasis(`\nFound ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} to create:\n`));

    for (const ticket of tickets) {
      const priority = ticket.priority ? ` [${ticket.priority}]` : '';
      const category = ticket.category ? ` {${ticket.category}}` : '';
      this.log(`  ${styles.code(ticket.id || 'auto')}: ${ticket.title}${priority}${category}`);
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
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Create these tickets?',
      choices: [
        { name: 'Yes, create tickets', value: 'create' },
        { name: 'Cancel', value: 'cancel' },
      ],
      default: 'create',
    }]);

    if (action === 'cancel') {
      this.log(styles.warning('Cancelled.'));
      return;
    }

    // Check for existing tickets
    const existingTickets = [];
    const newTickets = [];
    for (const ticketData of tickets) {
      if (ticketData.id) {
        try {
          const existing = await storage.getTicket(ticketData.id);
          if (existing) {
            existingTickets.push({ data: ticketData, existing });
          } else {
            // Ticket doesn't exist (getTicket returned null)
            newTickets.push(ticketData);
          }
        } catch {
          // Ticket doesn't exist (error thrown)
          newTickets.push(ticketData);
        }
      } else {
        // No ID, will auto-generate
        newTickets.push(ticketData);
      }
    }

    // Handle existing tickets
    let shouldUpdateExisting = false;
    if (existingTickets.length > 0) {
      this.log(styles.warning(`\n⚠️  ${existingTickets.length} ticket${existingTickets.length === 1 ? '' : 's'} already exist${existingTickets.length === 1 ? 's' : ''}:`));
      for (const { data, existing } of existingTickets) {
        this.log(styles.muted(`  ${data.id}: ${existing?.title || 'Unknown'} (${existing?.column || 'Unknown'})`));
      }

      const { existingAction } = await inquirer.prompt([{
        type: 'list',
        name: 'existingAction',
        message: 'How should existing tickets be handled?',
        choices: [
          { name: 'Skip existing tickets (create only new ones)', value: 'skip' },
          { name: 'Update existing tickets from spec', value: 'update' },
          { name: 'Cancel', value: 'cancel' },
        ],
        default: 'skip',
      }]);

      if (existingAction === 'cancel') {
        this.log(styles.warning('Cancelled.'));
        return;
      }

      shouldUpdateExisting = existingAction === 'update';
    }

    // Ensure spec exists in database (create if needed)
    try {
      const existingSpec = await storage.getSpec(specId!);
      if (!existingSpec) {
        // Spec doesn't exist, create it
        const relativePath = path.relative(pmoPath, specPath!);
        this.log(styles.muted(`  Creating spec: ${specId} at ${relativePath}`));
        await storage.createSpec({
          id: specId!,
          path: relativePath,
        });
      }
    } catch (error) {
      // Spec doesn't exist, create it
      const relativePath = path.relative(pmoPath, specPath!);
      this.log(styles.muted(`  Creating spec: ${specId} at ${relativePath}`));
      try {
        await storage.createSpec({
          id: specId!,
          path: relativePath,
        });
      } catch (createError) {
        this.warn(`Failed to create spec "${specId}": ${createError}`);
        throw createError;
      }
    }

    // Create new tickets
    const createdTickets = [];
    for (const ticketData of newTickets) {
      try {
        const ticket = await storage.createTicket({
          id: ticketData.id,
          title: ticketData.title,
          // column intentionally omitted - defaults to first column
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

    // Update existing tickets if requested
    const updatedTickets = [];
    if (shouldUpdateExisting) {
      for (const { data } of existingTickets) {
        try {
          const ticket = await storage.updateTicket(data.id!, {
            title: data.title,
            // column intentionally omitted - preserve existing column when updating from spec
            priority: data.priority,
            category: data.category,
            description: data.description,
          });
          updatedTickets.push(ticket);
        } catch (error) {
          this.warn(`Failed to update ticket "${data.id}": ${error}`);
        }
      }
    }

    // Auto-export to board.md
    await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)));

    await storage.close();

    // Build summary message
    const summary = [];
    if (createdTickets.length > 0) {
      summary.push(`Created ${createdTickets.length} ticket${createdTickets.length === 1 ? '' : 's'}`);
    }
    if (updatedTickets.length > 0) {
      summary.push(`Updated ${updatedTickets.length} ticket${updatedTickets.length === 1 ? '' : 's'}`);
    }
    if (existingTickets.length > 0 && !shouldUpdateExisting) {
      summary.push(`Skipped ${existingTickets.length} existing ticket${existingTickets.length === 1 ? '' : 's'}`);
    }

    this.log(styles.success(`\n✅ ${summary.join(', ')} from spec "${specId}"`));
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
    // Match from "tickets:" to end (greedy match works since frontmatter is already extracted)
    const ticketsMatch = frontmatter.match(/^tickets:([\s\S]+)$/m);
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
