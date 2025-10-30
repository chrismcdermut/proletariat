import { Command } from 'commander';
import { PMOManager } from '../../lib/pmo';
import chalk from 'chalk';

export const pmoStatusCommand = new Command('status')
  .description('Show PMO status and kanban overview')
  .action(async () => {
    try {
      const pmo = new PMOManager();
      await pmo.status();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });