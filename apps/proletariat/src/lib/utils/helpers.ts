import chalk from 'chalk';
import { getAllThemes } from '../themes/index.js';
import { ListOptions } from '../../types/index.js';

export function listAgents(options: ListOptions): void {
  const themeName = options.theme || 'billionaires';
  const themes = getAllThemes();
  const theme = themes[themeName];
  
  if (!theme) {
    console.log(chalk.red('❌'), `Theme '${themeName}' not found!`);
    console.log(chalk.blue('ℹ️'), `Available themes: ${Object.keys(themes).join(', ')}`);
    return;
  }
  
  console.log(chalk.blue(`\n${theme.emoji} Available ${theme.displayName} Agents:\n`));
  
  theme.agents.forEach(agent => {
    console.log(`  ${chalk.green(agent)}`);
  });
  
  console.log('\n' + chalk.yellow('Usage Examples:'));
  console.log(`  prlt ${theme.commands.create} ${theme.agents.slice(0, 2).join(' ')}`);
  console.log(`  prlt ${theme.commands.remove} ${theme.agents[0]}`);
  console.log(`  prlt ${theme.commands.list}`);
}

export function listThemes(): void {
  console.log(chalk.blue('\n🎨 Available Themes:\n'));
  
  const themes = getAllThemes();
  Object.values(themes).forEach(theme => {
    console.log(`${chalk.green(theme.emoji)} ${chalk.bold(theme.name)}`);
    console.log(`   ${theme.description}`);
    console.log(`   Commands: ${theme.commands.create}, ${theme.commands.remove}, ${theme.commands.list}`);
    console.log(`   Agents: ${theme.agents.slice(0, 4).join(', ')}...`);
    console.log('');
  });
}