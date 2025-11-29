import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { findPMO, getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

interface SpecFile {
  id: string;
  name: string;
  status: string;
  path: string;
  created?: string;
  ticketCount?: number;
}

export default class SpecList extends Command {
  static description = 'List all spec documents';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --status active',
    '<%= config.bin %> <%= command.id %> --project my-project',
  ];

  static flags = {
    status: Flags.string({
      char: 's',
      description: 'Filter by status (active, draft, archived)',
      options: ['active', 'draft', 'archived'],
    }),
    project: Flags.string({
      char: 'p',
      description: 'Project ID (will prompt if not specified)',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SpecList);

    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    // Get PMO context (prompt for project if multiple exist)
    const { projectId, projectName } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true // prompt if multiple projects
    );

    const specsBasePath = path.join(pmoPath, 'projects', projectId, 'specs');

    if (!fs.existsSync(specsBasePath)) {
      this.log(styles.warning(`\nNo specs directory found for project "${projectName}"`));
      this.log(styles.muted(`  Create your first spec: prlt spec create`));
      return;
    }

    // Collect all specs
    const specs: SpecFile[] = [];
    const statuses = flags.status ? [flags.status] : ['active', 'draft', 'archived'];

    for (const status of statuses) {
      const statusPath = path.join(specsBasePath, status);
      if (!fs.existsSync(statusPath)) {
        continue;
      }

      const files = fs.readdirSync(statusPath).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const specPath = path.join(statusPath, file);
        const spec = this.parseSpecFile(specPath, status);
        if (spec) {
          specs.push(spec);
        }
      }
    }

    if (specs.length === 0) {
      this.log(styles.warning(`\nNo specs found for project "${projectName}"`));
      this.log(styles.muted(`  Create your first spec: prlt spec create`));
      return;
    }

    // Display specs grouped by status
    this.log(styles.title(`\n📄 Specs - ${projectName}`));
    this.log(styles.muted('═'.repeat(60)));

    for (const status of ['active', 'draft', 'archived']) {
      const statusSpecs = specs.filter(s => s.status === status);
      if (statusSpecs.length === 0) continue;

      const statusEmoji = status === 'active' ? '🟢' : status === 'draft' ? '🟡' : '⚪';
      this.log(styles.emphasis(`\n${statusEmoji} ${status.toUpperCase()} (${statusSpecs.length})`));

      for (const spec of statusSpecs) {
        const ticketInfo = spec.ticketCount ? ` [${spec.ticketCount} ticket${spec.ticketCount === 1 ? '' : 's'}]` : '';
        this.log(`  ${styles.code(spec.id)}: ${spec.name}${ticketInfo}`);
        this.log(styles.muted(`     ${path.relative(process.cwd(), spec.path)}`));
      }
    }

    this.log(styles.muted('\n' + '═'.repeat(60)));
    this.log(styles.emphasis(`Total: ${specs.length} spec${specs.length === 1 ? '' : 's'}`));
    this.log(styles.muted('\nCommands:'));
    this.log(styles.primary('  prlt spec create           ') + styles.muted('Create a new spec'));
    this.log(styles.primary('  prlt spec view <id>        ') + styles.muted('View spec details'));
    this.log(styles.primary('  prlt spec generate-tickets ') + styles.muted('Generate tickets from spec'));
  }

  private parseSpecFile(filePath: string, status: string): SpecFile | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const fileName = path.basename(filePath, '.md');

      // Try to parse frontmatter
      let title = fileName;
      let created: string | undefined;
      let ticketCount: number | undefined;

      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
        if (titleMatch) {
          title = titleMatch[1].trim();
        }
        const createdMatch = frontmatter.match(/^created:\s*(.+)$/m);
        if (createdMatch) {
          created = createdMatch[1].trim();
        }
        // Count tickets in frontmatter
        const ticketsMatch = frontmatter.match(/^tickets:/m);
        if (ticketsMatch) {
          const ticketMatches = frontmatter.match(/- id:/g);
          ticketCount = ticketMatches ? ticketMatches.length : 0;
        }
      }

      return {
        id: fileName,
        name: title,
        status,
        path: filePath,
        created,
        ticketCount,
      };
    } catch (error) {
      return null;
    }
  }
}
