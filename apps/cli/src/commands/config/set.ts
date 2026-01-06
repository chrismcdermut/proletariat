import { Command, Args } from '@oclif/core';
import * as path from 'path';
import Database from 'better-sqlite3';
import { getPMOContext } from '../../lib/pmo/index.js';
import { CONVENTIONAL_COMMIT_TYPES } from '../../lib/pmo/utils.js';
import { CONFIG_SETTINGS } from './index.js';
import { styles } from '../../lib/styles.js';

export default class ConfigSet extends Command {
  static description = 'Set a configuration value';

  static examples = [
    '<%= config.bin %> <%= command.id %> commit_types "feat,fix,docs,chore"',
    '<%= config.bin %> <%= command.id %> commit_types all',
    '<%= config.bin %> <%= command.id %> commit_scope_format agent',
    '<%= config.bin %> <%= command.id %> column_done "Completed"',
  ];

  static args = {
    key: Args.string({
      description: 'Configuration key to set',
      required: true,
    }),
    value: Args.string({
      description: 'Value to set',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigSet);

    // Validate key
    const validKeys = Object.keys(CONFIG_SETTINGS);
    if (!validKeys.includes(args.key)) {
      this.error(
        `Invalid configuration key: "${args.key}"\n\nValid keys:\n${validKeys.map(k => `  - ${k}`).join('\n')}`
      );
    }

    // Validate boolean values
    if (args.key === 'commit_require_scope' || args.key === 'commit_enforced') {
      const lowerValue = args.value.toLowerCase();
      if (lowerValue !== 'true' && lowerValue !== 'false') {
        this.error(`Value for "${args.key}" must be "true" or "false"`);
      }
      // Normalize to lowercase
      args.value = lowerValue;
    }

    // Validate commit_types
    if (args.key === 'commit_types') {
      if (args.value !== 'all') {
        const types = args.value.split(',').map(t => t.trim());
        const validTypes = Object.keys(CONVENTIONAL_COMMIT_TYPES);
        const invalidTypes = types.filter(t => !validTypes.includes(t));
        if (invalidTypes.length > 0) {
          this.error(
            `Invalid commit type(s): ${invalidTypes.join(', ')}\n\nValid types: ${validTypes.join(', ')}`
          );
        }
      }
    }

    // Validate commit_scope_format
    if (args.key === 'commit_scope_format') {
      const validFormats = ['agent', 'ticket', 'none'];
      if (!validFormats.includes(args.value)) {
        this.error(`Value for commit_scope_format must be one of: ${validFormats.join(', ')}`);
      }
    }

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
      // Get previous value if any
      const row = db.prepare(
        `SELECT value FROM pmo_settings WHERE key = ?`
      ).get(args.key) as { value: string } | undefined;

      const previousValue = row?.value;
      const configInfo = CONFIG_SETTINGS[args.key as keyof typeof CONFIG_SETTINGS];

      // Set the value
      db.prepare(`
        INSERT INTO pmo_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = ?
      `).run(args.key, args.value, args.value);

      this.log(styles.success(`Configuration updated: ${args.key}`));
      if (previousValue) {
        this.log(styles.muted(`  Previous: ${previousValue}`));
      } else {
        this.log(styles.muted(`  Previous: ${configInfo.default} (default)`));
      }
      this.log(styles.muted(`  New: ${args.value}`));
    } finally {
      db.close();
    }
  }
}
