import { Command, Flags } from '@oclif/core';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { SpecStatus, SpecType } from '../../lib/pmo/types.js';

export default class SpecList extends Command {
  static description = 'List all specs';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --status active',
    '<%= config.bin %> <%= command.id %> --type product',
  ];

  static flags = {
    status: Flags.string({
      char: 's',
      description: 'Filter by status',
      options: ['draft', 'active', 'implemented'],
    }),
    type: Flags.string({
      char: 't',
      description: 'Filter by type',
      options: ['product', 'platform', 'infra', 'integration'],
    }),
    search: Flags.string({
      description: 'Search in title/problem/solution',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SpecList);

    // Get PMO context
    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    // List specs with filters
    const specs = await storage.listSpecs({
      status: flags.status as SpecStatus | undefined,
      type: flags.type as SpecType | undefined,
      search: flags.search,
    });

    if (specs.length === 0) {
      this.log(styles.warning('\nNo specs found'));
      this.log(styles.muted('  Create your first spec: prlt spec create'));
      await storage.close();
      return;
    }

    // Display specs grouped by status
    this.log(styles.title('\n📄 Specs'));
    this.log(styles.muted('═'.repeat(60)));

    // Group by status
    const byStatus: Record<string, typeof specs> = {};
    for (const spec of specs) {
      if (!byStatus[spec.status]) byStatus[spec.status] = [];
      byStatus[spec.status].push(spec);
    }

    for (const status of ['draft', 'active', 'implemented']) {
      const statusSpecs = byStatus[status];
      if (!statusSpecs || statusSpecs.length === 0) continue;

      const statusEmoji = status === 'draft' ? '📝' : status === 'active' ? '🟢' : '✅';
      this.log(styles.emphasis(`\n${statusEmoji} ${status.toUpperCase()} (${statusSpecs.length})`));

      for (const spec of statusSpecs) {
        const typeTag = spec.type ? ` (${spec.type})` : '';
        const tags = spec.tags && spec.tags.length > 0 ? ` [${spec.tags.join(', ')}]` : '';
        this.log(`  ${styles.code(spec.id)}: ${spec.title}${typeTag}${tags}`);
        if (spec.problem) {
          const preview = spec.problem.length > 60
            ? spec.problem.substring(0, 60) + '...'
            : spec.problem;
          this.log(styles.muted(`     ${preview}`));
        }
      }
    }

    this.log(styles.muted('\n' + '═'.repeat(60)));
    this.log(styles.emphasis(`Total: ${specs.length} spec${specs.length === 1 ? '' : 's'}`));
    this.log(styles.muted('\nCommands:'));
    this.log(styles.primary('  prlt spec create      ') + styles.muted('Create a new spec'));
    this.log(styles.primary('  prlt spec view <id>   ') + styles.muted('View spec details'));
    this.log(styles.primary('  prlt spec plan <id>   ') + styles.muted('Generate tickets from spec'));

    await storage.close();
  }
}
