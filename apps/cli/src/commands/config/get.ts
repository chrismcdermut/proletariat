import { Command, Args } from '@oclif/core';
import * as path from 'path';
import Database from 'better-sqlite3';
import { getPMOContext } from '../../lib/pmo/index.js';
import { CONFIG_SETTINGS } from './index.js';
import { styles } from '../../lib/styles.js';

export default class ConfigGet extends Command {
  static description = 'Get a configuration value';

  static examples = [
    '<%= config.bin %> <%= command.id %> commit_namespace',
    '<%= config.bin %> <%= command.id %> commit_include_agent',
    '<%= config.bin %> <%= command.id %> column_done',
  ];

  static args = {
    key: Args.string({
      description: 'Configuration key to get',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(ConfigGet);

    // Validate key
    const validKeys = Object.keys(CONFIG_SETTINGS);
    if (!validKeys.includes(args.key)) {
      this.error(
        `Invalid configuration key: "${args.key}"\n\nValid keys:\n${validKeys.map(k => `  - ${k}`).join('\n')}`
      );
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
      const row = db.prepare(
        `SELECT value FROM pmo_settings WHERE key = ?`
      ).get(args.key) as { value: string } | undefined;

      const configInfo = CONFIG_SETTINGS[args.key as keyof typeof CONFIG_SETTINGS];
      const value = row?.value || configInfo.default;
      const isDefault = !row?.value;

      this.log(`${args.key}=${value}`);
      if (isDefault) {
        this.log(styles.muted('(default value)'));
      }
    } finally {
      db.close();
    }
  }
}
