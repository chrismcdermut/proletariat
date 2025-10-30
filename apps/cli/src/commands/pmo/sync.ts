import { Command } from 'commander';
import { PMOManager } from '../../lib/pmo';
import chalk from 'chalk';

export const pmoSyncCommand = new Command('sync')
  .description('Sync kanban boards from multiple repositories (consolidated PMO)')
  .action(async () => {
    try {
      const pmo = new PMOManager();
      await pmo.sync();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });