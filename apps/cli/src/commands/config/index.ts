import { Command, Flags } from '@oclif/core';
import * as path from 'path';
import Database from 'better-sqlite3';
import { getPMOContext } from '../../lib/pmo/index.js';
import {
  DEFAULT_WORK_COLUMNS,
  DEFAULT_COMMIT_NAMESPACE_CONFIG,
} from '../../lib/pmo/utils.js';
import { styles } from '../../lib/styles.js';

/**
 * All available configuration settings with their descriptions and defaults.
 */
const CONFIG_SETTINGS = {
  // Work column settings
  column_planned: {
    description: 'Column name for planned/scheduled work',
    default: DEFAULT_WORK_COLUMNS.planned,
    category: 'columns',
  },
  column_in_progress: {
    description: 'Column name for work in progress',
    default: DEFAULT_WORK_COLUMNS.in_progress,
    category: 'columns',
  },
  column_done: {
    description: 'Column name for completed work',
    default: DEFAULT_WORK_COLUMNS.done,
    category: 'columns',
  },
  // Commit namespace settings
  commit_namespace: {
    description: 'Prefix for agent commit messages (e.g., "[prlt]")',
    default: DEFAULT_COMMIT_NAMESPACE_CONFIG.namespace,
    category: 'commit',
  },
  commit_include_agent: {
    description: 'Include agent name in commit namespace (true/false)',
    default: String(DEFAULT_COMMIT_NAMESPACE_CONFIG.includeAgent),
    category: 'commit',
  },
  commit_format: {
    description: 'Format template for commit messages',
    default: DEFAULT_COMMIT_NAMESPACE_CONFIG.format,
    category: 'commit',
  },
  commit_enabled: {
    description: 'Enable commit namespace prefixing (true/false)',
    default: String(DEFAULT_COMMIT_NAMESPACE_CONFIG.enabled),
    category: 'commit',
  },
} as const;

export { CONFIG_SETTINGS };

export default class ConfigList extends Command {
  static description = 'List all configuration settings';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --all',
  ];

  static flags = {
    all: Flags.boolean({
      char: 'a',
      description: 'Show all settings including defaults',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigList);

    // Get PMO context
    const { pmoPath } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    // Open database
    const dbPath = path.join(pmoPath, 'pmo.db');
    const db = new Database(dbPath);

    try {
      // Get all stored settings
      const rows = db.prepare(
        `SELECT key, value FROM pmo_settings ORDER BY key`
      ).all() as { key: string; value: string }[];

      const storedSettings = new Map(rows.map(r => [r.key, r.value]));

      this.log(styles.header('Configuration Settings'));
      this.log('');

      // Group settings by category
      const categories = {
        columns: 'Work Columns',
        commit: 'Commit Namespace',
      };

      for (const [category, categoryName] of Object.entries(categories)) {
        const categorySettings = Object.entries(CONFIG_SETTINGS).filter(
          ([, config]) => config.category === category
        );

        if (categorySettings.length === 0) continue;

        this.log(styles.subheader(categoryName));

        for (const [key, config] of categorySettings) {
          const storedValue = storedSettings.get(key);
          const isDefault = !storedValue;
          const displayValue = storedValue || config.default;

          if (flags.all || !isDefault) {
            const defaultIndicator = isDefault ? styles.muted(' (default)') : '';
            this.log(`  ${styles.code(key)}: ${displayValue}${defaultIndicator}`);
            if (flags.all) {
              this.log(styles.muted(`    ${config.description}`));
            }
          }
        }

        // Show message if no custom settings in this category
        const hasCustom = categorySettings.some(([key]) => storedSettings.has(key));
        if (!hasCustom && !flags.all) {
          this.log(styles.muted('  (using defaults)'));
        }

        this.log('');
      }

      if (!flags.all) {
        this.log(styles.muted('Use --all to see all settings including defaults'));
      }

      this.log('');
      this.log(styles.muted('Set a value: prlt config set <key> <value>'));
      this.log(styles.muted('Get a value: prlt config get <key>'));
      this.log(styles.muted('Delete a value: prlt config delete <key>'));
    } finally {
      db.close();
    }
  }
}
