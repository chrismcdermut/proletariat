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
import * as fs from 'fs';
import * as path from 'path';

// Import modules
import { getAllThemes } from '../lib/themes/index.js';
import { initProject, createWorktrees, removeWorktrees, showStatus } from '../lib/worktree/index.js';
import { repairWorktrees, checkWorktreeHealth } from '../lib/worktree/repair.js';
import { migrateToHQ } from '../lib/worktree/migrate.js';
import { upgradeConfig } from '../lib/config/upgrade.js';
import { listAgents, listThemes } from '../lib/utils/helpers.js';
import { showBanner } from '../lib/utils/logger.js';
import { InitOptions, ListOptions } from '../types/index.js';
import { initPMO, createTicket, claimTicket } from '../lib/pmo/index.js';

const program = new Command();

// Get version from package.json dynamically
function getVersion(): string {
  try {
    const packageJsonPath = path.join(__dirname, '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version;
  } catch {
    return '0.0.0'; // Fallback version if package.json can't be read
  }
}

// Get themes for CLI setup
const THEMES = getAllThemes();

// CLI Program setup
program
  .name('prlt')
  .description('⚒️ Simple Themed Git Worktree Manager')
  .version(getVersion());

program
  .command('init')
  .description('🚩 Initialize themed worktree management')
  .option('-t, --theme <theme>', 'theme (billionaires, cars, companies)')
  .option('--hq <name>', 'Create an HQ directory (e.g. your-company-hq) to hold repos and agent workspaces')
  .option('--hq-root <path>', 'Explicit path where agent workspaces should live')
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
  .command('migrate <hq-name>')
  .description('📦 Migrate repository into HQ folder alongside agent workspaces')
  .action((hqName: string) => migrateToHQ(hqName));

program
  .command('upgrade')
  .description('⬆️  Upgrade configuration to latest format')
  .action(() => upgradeConfig());

// PMO Commands
program
  .command('pmo:init')
  .description('🎯 Initialize Project Management Office (PMO)')
  .action(async () => {
    await initPMO();
  });

program
  .command('add')
  .alias('create')
  .description('📝 Create a new ticket in the PMO')
  .action(async () => {
    await createTicket();
  });

program
  .command('claim [ticketId]')
  .description('🎯 Claim a ticket and launch Claude with context')
  .action(async (ticketId?: string) => {
    await claimTicket(ticketId);
  });

program
  .command('go <agent>')
  .alias('switch')
  .description('🚀 Switch to an agent workspace')
  .action((agent: string) => {
    try {
      const configPath = path.join(process.cwd(), '.proletariat', 'repo.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const worktreePath = path.join('..', '.proletariat', 'worktrees', agent);
      
      if (fs.existsSync(worktreePath)) {
        console.log(chalk.green(`📍 Switching to ${agent} workspace at: ${worktreePath}`));
        console.log(chalk.cyan(`Run: cd ${worktreePath}`));
      } else {
        console.log(chalk.red(`Agent workspace not found: ${agent}`));
        console.log(chalk.yellow(`Available agents: ${config.agents?.join(', ') || 'none'}`));
      }
    } catch (error) {
      console.log(chalk.red('No Proletariat config found. Run `prlt init` first.'));
    }
  });

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
