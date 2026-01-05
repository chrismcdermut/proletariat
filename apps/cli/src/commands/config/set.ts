import { Command, Args } from '@oclif/core';
import * as path from 'path';
import Database from 'better-sqlite3';
import { getPMOContext } from '../../lib/pmo/index.js';
import { CONFIG_SETTINGS } from './index.js';
import { styles } from '../../lib/styles.js';

export default class ConfigSet extends Command {
  static description = 'Set a configuration value';

  static examples = [
    '<%= config.bin %> <%= command.id %> commit_namespace "[myteam]"',
    '<%= config.bin %> <%= command.id %> commit_include_agent true',
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
    if (args.key === 'commit_include_agent' || args.key === 'commit_enabled') {
      const lowerValue = args.value.toLowerCase();
      if (lowerValue !== 'true' && lowerValue !== 'false') {
        this.error(`Value for "${args.key}" must be "true" or "false"`);
      }
      // Normalize to lowercase
      args.value = lowerValue;
    }

    // Validate commit_format contains required placeholders
    if (args.key === 'commit_format') {
      if (!args.value.includes('{message}')) {
        this.error('commit_format must include {message} placeholder');
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
