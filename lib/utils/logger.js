const chalk = require('chalk');

const log = {
  theme: (theme, msg) => console.log(chalk.cyan(`${theme.emoji}`), chalk.bold(msg)),
  success: (msg) => console.log(chalk.green('✅'), msg),
  warning: (msg) => console.log(chalk.yellow('⚠️'), msg),
  error: (msg) => console.log(chalk.red('❌'), msg),
  info: (msg) => console.log(chalk.blue('ℹ️'), msg),
  agent: (agent, msg, theme) => {
    console.log(chalk.cyan(`${theme.emoji} ${agent.toUpperCase()}:`), msg);
  }
};

function showBanner(theme) {
  console.log(`
${chalk.red('⚒️  PROLETARIAT ⚒️')}
${chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
${chalk.green(`${theme.emoji} ${theme.displayName} ${theme.emoji}`)}
${chalk.cyan(theme.description)}
${chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
`);
}

module.exports = {
  log,
  showBanner
};