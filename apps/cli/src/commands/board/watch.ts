import { Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { PMOCommand, pmoBaseFlags, runWatcherForeground } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

interface PMOConfigFile {
  storage: 'sqlite' | 'git';
  template: string;
  boardName: string;
  columns: string[];
  created: string;
}

export default class BoardWatch extends PMOCommand {
  static description = 'Watch board.md for changes and auto-sync to SQLite';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --debounce 1000',
  ];

  static flags = {
    ...pmoBaseFlags,
    debounce: Flags.integer({
      char: 'd',
      description: 'Debounce delay in milliseconds',
      default: 500,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(BoardWatch);

    // Load PMO config
    const configPath = path.join(this.pmoPath, 'config.json');
    if (!fs.existsSync(configPath)) {
      this.error('PMO config not found. Run "prlt pmo init" first.');
    }

    const config: PMOConfigFile = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Header
    this.log(styles.title('\n🔄 Board Watcher'));
    this.log(styles.muted(`Storage: ${config.storage} | Debounce: ${flags.debounce}ms`));
    this.log(styles.muted(`Path: ${this.pmoPath}`));
    this.log(styles.muted('Press Ctrl+C to stop\n'));

    // Run watcher (blocks until SIGINT/SIGTERM)
    await runWatcherForeground(this.pmoPath, config.storage, {
      debounceMs: flags.debounce,
      logger: (msg) => {
        const timestamp = new Date().toLocaleTimeString();
        this.log(styles.muted(`[${timestamp}]`) + ' ' + msg);
      },
      onSync: () => {
        // Already logged by logger
      },
      onError: (error) => {
        this.log(chalk.red(`Error: ${error.message}`));
      },
    });
  }
}
