import { Command } from 'commander';
import { PMOManager } from '../../lib/pmo';
import chalk from 'chalk';

export const pmoInitCommand = new Command('init')
  .description('Initialize PMO structure in current repository')
  .option('-f, --force', 'Overwrite existing PMO directory')
  .action(async (options) => {
    try {
      const pmo = new PMOManager();
      await pmo.init(options.force);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });