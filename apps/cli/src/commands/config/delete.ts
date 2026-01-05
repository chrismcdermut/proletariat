import { Command, Args, Flags } from '@oclif/core';
import * as path from 'path';
import Database from 'better-sqlite3';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { CONFIG_SETTINGS } from './index.js';
import { styles } from '../../lib/styles.js';

export default class ConfigDelete extends Command {
  static description = 'Delete a configuration value (revert to default)';

  static examples = [
    '<%= config.bin %> <%= command.id %> commit_namespace',
    '<%= config.bin %> <%= command.id %> commit_namespace --force',
  ];

  static args = {
    key: Args.string({
      description: 'Configuration key to delete',
      required: true,
    }),
  };

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigDelete);

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
      // Check if setting exists
      const row = db.prepare(
        `SELECT value FROM pmo_settings WHERE key = ?`
      ).get(args.key) as { value: string } | undefined;

      if (!row) {
        const configInfo = CONFIG_SETTINGS[args.key as keyof typeof CONFIG_SETTINGS];
        this.log(styles.info(`"${args.key}" is not set (using default: ${configInfo.default})`));
        return;
      }

      // Confirm deletion
      if (!flags.force) {
        const configInfo = CONFIG_SETTINGS[args.key as keyof typeof CONFIG_SETTINGS];
        const { confirmed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirmed',
          message: `Delete "${args.key}" and revert to default (${configInfo.default})?`,
          default: false,
        }]);

        if (!confirmed) {
          this.log(styles.muted('Cancelled.'));
          return;
        }
      }

      // Delete the setting
      db.prepare(`DELETE FROM pmo_settings WHERE key = ?`).run(args.key);

      const configInfo = CONFIG_SETTINGS[args.key as keyof typeof CONFIG_SETTINGS];
      this.log(styles.success(`Deleted: ${args.key}`));
      this.log(styles.muted(`  Previous: ${row.value}`));
      this.log(styles.muted(`  Reverted to default: ${configInfo.default}`));
    } finally {
      db.close();
    }
  }
}
