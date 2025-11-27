import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { runWatcherForeground } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

interface PMOConfigFile {
  storage: 'sqlite' | 'git';
  template: string;
  boardName: string;
  columns: string[];
  created: string;
}

export default class BoardWatch extends Command {
  static description = 'Watch board.md for changes and auto-sync to SQLite';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --debounce 1000',
  ];

  static flags = {
    debounce: Flags.integer({
      char: 'd',
      description: 'Debounce delay in milliseconds',
      default: 500,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(BoardWatch);

    // Find PMO directory
    const pmoPath = this.findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    // Load PMO config
    const configPath = path.join(pmoPath, 'config.json');
    if (!fs.existsSync(configPath)) {
      this.error('PMO config not found. Run "prlt pmo init" first.');
    }

    const config: PMOConfigFile = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Header
    this.log(styles.title('\n🔄 Board Watcher'));
    this.log(styles.muted(`Storage: ${config.storage} | Debounce: ${flags.debounce}ms`));
    this.log(styles.muted(`Path: ${pmoPath}`));
    this.log(styles.muted('Press Ctrl+C to stop\n'));

    // Run watcher (blocks until SIGINT/SIGTERM)
    await runWatcherForeground(pmoPath, config.storage, {
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

  private findPMO(): string | null {
    let currentDir = process.cwd();

    while (currentDir !== '/') {
      const configPath = path.join(currentDir, '.proletariat', 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (config.type === 'hq') {
            const pmoPath = path.join(currentDir, 'pmo');
            if (fs.existsSync(path.join(pmoPath, 'config.json'))) {
              return pmoPath;
            }
          }
          if (config.pmoPath) {
            const absolutePath = path.isAbsolute(config.pmoPath)
              ? config.pmoPath
              : path.join(currentDir, config.pmoPath);
            if (fs.existsSync(path.join(absolutePath, 'config.json'))) {
              return absolutePath;
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      const dotPmoPath = path.join(currentDir, '.pmo');
      if (fs.existsSync(path.join(dotPmoPath, 'config.json'))) {
        return dotPmoPath;
      }

      const pmoPath = path.join(currentDir, 'pmo');
      if (fs.existsSync(path.join(pmoPath, 'config.json'))) {
        return pmoPath;
      }

      currentDir = path.dirname(currentDir);
    }

    const globalConfigPath = path.join(process.env.HOME || '', '.proletariat', 'config.json');
    if (fs.existsSync(globalConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
        if (config.defaultPMO && fs.existsSync(path.join(config.defaultPMO, 'config.json'))) {
          return config.defaultPMO;
        }
      } catch {
        // Ignore parse errors
      }
    }

    return null;
  }
}
