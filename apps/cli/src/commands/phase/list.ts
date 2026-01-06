import { Command, Flags } from '@oclif/core';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { StateCategory, STATE_CATEGORY_ORDER, ProjectPhase } from '../../lib/pmo/types.js';

export default class PhaseList extends Command {
  static description = 'List all project lifecycle phases';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --category started',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    category: Flags.string({
      char: 'c',
      description: 'Filter by category',
      options: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PhaseList);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false  // Phases are workspace-scoped, no project selection needed
    );

    try {
      const phases = await storage.listPhases(
        flags.category ? { category: flags.category as StateCategory } : undefined
      );

      if (flags.json) {
        this.log(JSON.stringify(phases, null, 2));
        await storage.close();
        return;
      }

      if (phases.length === 0) {
        this.log(styles.muted('\nNo phases found.'));
        await storage.close();
        return;
      }

      // Group by category
      const grouped = this.groupByCategory(phases);

      this.log(`\n📊 ${styles.emphasis('Project Lifecycle Phases')}`);
      this.log('═'.repeat(60));

      const categoryEmoji: Record<StateCategory, string> = {
        backlog: '📥',
        unstarted: '📋',
        started: '🚀',
        completed: '✅',
        canceled: '🚫',
      };

      for (const category of STATE_CATEGORY_ORDER) {
        if (flags.category && flags.category !== category) continue;

        const categoryPhases = grouped.get(category);
        if (!categoryPhases || categoryPhases.length === 0) continue;

        const emoji = categoryEmoji[category];
        this.log(`\n${emoji} ${styles.emphasis(category.toUpperCase())}`);
        this.log('─'.repeat(40));

        for (const phase of categoryPhases) {
          const defaultBadge = phase.isDefault ? styles.muted(' (default)') : '';
          const colorPreview = phase.color ? `[${phase.color}]` : '';
          this.log(`  ${phase.name}${defaultBadge} ${styles.muted(colorPreview)}`);
          if (phase.description) {
            this.log(`    ${styles.muted(phase.description)}`);
          }
        }
      }

      this.log('');
      await storage.close();
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  private groupByCategory(phases: ProjectPhase[]): Map<StateCategory, ProjectPhase[]> {
    const grouped = new Map<StateCategory, ProjectPhase[]>();

    for (const phase of phases) {
      const existing = grouped.get(phase.category) || [];
      existing.push(phase);
      grouped.set(phase.category, existing);
    }

    return grouped;
  }
}
