import chalk from 'chalk';
import { Theme, Logger } from '../../types/index.js';

export const log: Logger = {
  theme: (theme: Theme, msg: string): void => console.log(chalk.cyan(`${theme.emoji}`), chalk.bold(msg)),
  success: (msg: string): void => console.log(chalk.green('✅'), msg),
  warning: (msg: string): void => console.log(chalk.yellow('⚠️'), msg),
  error: (msg: string): void => console.log(chalk.red('❌'), msg),
  info: (msg: string): void => console.log(chalk.blue('ℹ️'), msg),
  agent: (agent: string, msg: string, theme: Theme): void => {
    console.log(chalk.cyan(`${theme.emoji} ${agent.toUpperCase()}:`), msg);
  }
};

export function showBanner(theme: Theme): void {
  console.log(`
${chalk.red('⚒️  PROLETARIAT ⚒️')}
${chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
${chalk.green(`${theme.emoji} ${theme.displayName} ${theme.emoji}`)}
${chalk.cyan(theme.description)}
${chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
`);
}