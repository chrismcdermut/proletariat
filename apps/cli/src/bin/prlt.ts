#!/usr/bin/env node

/**
 * 🚩 PROLETARIAT - Simple Themed Git Worktree Manager
 * ⚒️ Making git worktrees fun with themed agents!
 * 
 * Billionaires: "Workers of the codebase, unite!"
 * Cars: "Start your engines!"
 * Companies: "Time to make some acquisitions!"
 */

import { Command } from 'commander';
import chalk from 'chalk';

// Import modules
import { getAllThemes } from '../lib/themes/index.js';
import { initProject, createWorktrees, removeWorktrees, showStatus } from '../lib/worktree/index.js';
import { repairWorktrees, checkWorktreeHealth } from '../lib/worktree/repair.js';
import { migrateToWorkspace } from '../lib/worktree/migrate.js';
import { upgradeConfig } from '../lib/config/upgrade.js';
import { listAgents, listThemes } from '../lib/utils/helpers.js';
import { showBanner } from '../lib/utils/logger.js';
import { InitOptions, ListOptions } from '../types/index.js';

const program = new Command();

// Get themes for CLI setup
const THEMES = getAllThemes();

// CLI Program setup
program
  .name('prlt')
  .description('⚒️ Simple Themed Git Worktree Manager')
  .version('2.0.0');

program
  .command('init')
  .description('🚩 Initialize themed worktree management')
  .option('-t, --theme <theme>', 'theme (billionaires, cars, companies)')
  .option('--workspace <name>', 'Create a workspace directory (e.g. acme-project) to hold the repo and agents')
  .option('--workspace-root <path>', 'Explicit path where agent worktrees should live')
  .action(async (options: InitOptions) => {
    await initProject(options);
  });

// Dynamic theme commands
Object.values(THEMES).forEach(theme => {
  program
    .command(`${theme.commands.create} <agents...>`)
    .description(`${theme.emoji} Create worktrees for ${theme.name} agents`)
    .action(async (agents: string[]) => {
      await createWorktrees(agents);
    });
    
  program
    .command(`${theme.commands.remove} <agents...>`)
    .description(`${theme.emoji} Remove worktrees for ${theme.name} agents`)
    .action(async (agents: string[]) => {
      await removeWorktrees(agents);
    });
    
  program
    .command(theme.commands.list)
    .description(`${theme.emoji} Show active ${theme.name} agents`)
    .action(() => {
      showStatus();
    });
});

program
  .command('list')
  .description('📋 List available agents for a theme')
  .option('-t, --theme <theme>', 'theme to list agents for')
  .action((options: ListOptions) => listAgents(options));

program
  .command('themes')
  .description('🎨 List available themes')
  .action(() => listThemes());

program
  .command('repair')
  .description('🔧 Repair broken worktree references (e.g., after moving the repository)')
  .action(() => repairWorktrees());

program
  .command('health')
  .description('🏥 Check health of all worktrees')
  .action(() => checkWorktreeHealth());

program
  .command('migrate')
  .description('📦 Migrate repository into workspace folder alongside worktrees')
  .action(() => migrateToWorkspace());

program
  .command('upgrade')
  .description('⬆️  Upgrade configuration to latest format')
  .action(() => upgradeConfig());

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
