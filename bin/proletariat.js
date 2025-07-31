#!/usr/bin/env node

/**
 * 🚩 PROLETARIAT - Simple Themed Git Worktree Manager
 * ⚒️ Making git worktrees fun with themed agents!
 * 
 * Billionaires: "Workers of the codebase, unite!"
 * Cars: "Start your engines!"
 * Companies: "Time to make some acquisitions!"
 */

const { Command } = require('commander');
const chalk = require('chalk');

// Import modules
const { getAllThemes } = require('../lib/themes');
const { initProject, createWorktrees, removeWorktrees, showStatus } = require('../lib/worktree');
const { startTmuxSession } = require('../lib/tmux');
const { setupCaddyProxy } = require('../lib/caddy');
const { listAgents, listThemes } = require('../lib/utils/helpers');
const { showBanner } = require('../lib/utils/logger');

const program = new Command();

// Get themes for CLI setup
const THEMES = getAllThemes();

// CLI Program setup
program
  .name('proletariat')
  .description('⚒️ Simple Themed Git Worktree Manager (alias: prlt)')
  .version('2.0.0');

program
  .command('init')
  .description('🚩 Initialize themed worktree management')
  .option('-t, --theme <theme>', 'theme (billionaires, cars, companies)')
  .action(initProject);

// Dynamic theme commands
Object.values(THEMES).forEach(theme => {
  program
    .command(`${theme.commands.create} <agents...>`)
    .description(`${theme.emoji} Create worktrees for ${theme.name} agents`)
    .action(createWorktrees);
    
  program
    .command(`${theme.commands.remove} <agents...>`)
    .description(`${theme.emoji} Remove worktrees for ${theme.name} agents`)
    .action(removeWorktrees);
    
  program
    .command(theme.commands.list)
    .description(`${theme.emoji} Show active ${theme.name} agents`)
    .action(showStatus);
    
  program
    .command(`${theme.commands.session} <agents...>`)
    .description(`${theme.emoji} Start tmux sessions for ${theme.name} agents`)
    .action(startTmuxSession);
    
  program
    .command(`${theme.commands.proxy} <agents...>`)
    .description(`${theme.emoji} Setup Caddy proxy domains for ${theme.name} agents`)
    .action(setupCaddyProxy);
});

program
  .command('list')
  .description('📋 List available agents for a theme')
  .option('-t, --theme <theme>', 'theme to list agents for')
  .action(listAgents);

program
  .command('themes')
  .description('🎨 List available themes')
  .action(listThemes);

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  const theme = THEMES.billionaires;
  showBanner(theme);
  program.outputHelp();
  console.log(chalk.yellow('\n💡 Start with: prlt init'));
  console.log(chalk.cyan('💡 Simple themed git worktree management! ⚒️\n'));
}