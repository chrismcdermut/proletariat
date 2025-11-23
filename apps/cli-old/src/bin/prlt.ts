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
import { showBanner, log } from '../lib/utils/logger.js';
import { InitOptions, ListOptions } from '../types/index.js';
import { getManagers, findHQRoot } from '../lib/managers/index.js';
import inquirer from 'inquirer';

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

// Check if we're in HQ mode and get the theme
function getActiveTheme(): string | null {
  try {
    // Check for HQ config in parent directories
    let currentDir = process.cwd();
    for (let i = 0; i < 5; i++) {
      const hqConfigPath = path.join(currentDir, '.proletariat', 'config.json');
      if (fs.existsSync(hqConfigPath)) {
        const hqConfig = JSON.parse(fs.readFileSync(hqConfigPath, 'utf-8'));
        if (hqConfig.type === 'hq' && hqConfig.theme) {
          return hqConfig.theme;
        }
      }
      currentDir = path.dirname(currentDir);
    }
    
    // Check for repo config
    const repoConfigPath = path.join(process.cwd(), '.proletariat', 'repo.json');
    if (fs.existsSync(repoConfigPath)) {
      const repoConfig = JSON.parse(fs.readFileSync(repoConfigPath, 'utf-8'));
      return repoConfig.themeName || null;
    }
  } catch {
    // Ignore errors
  }
  return null;
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

// Theme-specific command aliases that map to standard commands
const activeThemeName = getActiveTheme();
const themesToRegister = activeThemeName 
  ? [THEMES[activeThemeName]].filter(Boolean)  // Only active theme
  : Object.values(THEMES);  // All themes for backwards compatibility

themesToRegister.forEach(theme => {
  if (!theme) return;
  
  const managers = getManagers();
  const isHQMode = managers !== null;
  
  // Theme aliases for agent commands
  program
    .command(`${theme.commands.create} [agents...]`)
    .description(`${theme.emoji} ${isHQMode ? 'Hire' : 'Create worktrees for'} ${theme.displayName} agents`)
    .action(async (agents: string[]) => {
      if (isHQMode) {
        await managers!.agent.add(agents.length > 0 ? agents : undefined);
      } else {
        await createWorktrees(agents);
      }
    });
    
  program
    .command(`${theme.commands.remove} [agents...]`)
    .description(`${theme.emoji} ${isHQMode ? 'Fire' : 'Remove worktrees for'} ${theme.displayName} agents`)
    .action(async (agents: string[]) => {
      if (isHQMode) {
        await managers!.agent.remove(agents.length > 0 ? agents : undefined);
      } else {
        await removeWorktrees(agents);
      }
    });
    
  program
    .command(theme.commands.list)
    .description(`${theme.emoji} Show active ${theme.displayName}`)
    .action(async () => {
      if (isHQMode) {
        await managers!.agent.list();
      } else {
        showStatus();
      }
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
    const managers = getManagers();
    if (!managers) {
      log.error('PMO requires HQ mode! Run `prlt init --hq` first.');
      return;
    }
    await managers.pmo.init();
  });

// Standard commands using managers
program
  .command('agent [action] [name]')
  .description('🧑‍💼 Manage agents (add/remove/list)')
  .action(async (action?: string, name?: string) => {
    const managers = getManagers();
    if (!managers) {
      log.error('Not in an HQ directory! Run `prlt init --hq <name>` first.');
      return;
    }
    
    // Interactive mode if no action provided
    if (!action) {
      const { selectedAction } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedAction',
          message: 'What would you like to do?',
          choices: [
            { name: 'Add agents', value: 'add' },
            { name: 'Remove agents', value: 'remove' },
            { name: 'List agents', value: 'list' },
            { name: 'Grant access', value: 'grant' },
            { name: 'Revoke access', value: 'revoke' },
            { name: 'Switch to agent', value: 'switch' }
          ]
        }
      ]);
      action = selectedAction;
    }
    
    switch(action) {
      case 'add':
        await managers.agent.add(name ? [name] : undefined);
        break;
      case 'remove':
        await managers.agent.remove(name ? [name] : undefined);
        break;
      case 'list':
        await managers.agent.list();
        break;
      case 'grant':
        await managers.agent.grant();
        break;
      case 'revoke':
        await managers.agent.revoke();
        break;
      case 'switch':
        if (name) {
          managers.agent.switch(name);
        } else {
          log.error('Agent name required for switch');
        }
        break;
      default:
        log.error(`Unknown action: ${action}`);
        log.info('Available actions: add, remove, list, grant, revoke, switch');
    }
  });

program
  .command('repo [action] [path]')
  .alias('add')
  .description('📦 Manage repositories')
  .action(async (action?: string, path?: string) => {
    const managers = getManagers();
    if (!managers) {
      log.error('Not in an HQ directory! Run `prlt init --hq <name>` first.');
      return;
    }
    
    // For backwards compatibility, 'prlt add' defaults to 'add' action
    if (!action || (action && !['add', 'remove', 'list'].includes(action))) {
      path = action; // First arg might be the path
      action = 'add';
    }
    
    switch(action) {
      case 'add':
        await managers.repo.add(path);
        break;
      case 'remove':
        await managers.repo.remove(path);
        break;
      case 'list':
        await managers.repo.list();
        break;
      default:
        log.error(`Unknown action: ${action}`);
        log.info('Available actions: add, remove, list');
    }
  });

program
  .command('ticket [action] [ticketId] [agentName]')
  .description('🎯 Manage tickets')
  .action(async (action?: string, ticketId?: string, agentName?: string) => {
    const managers = getManagers();
    if (!managers) {
      log.error('Not in an HQ directory! Run `prlt init --hq <name>` first.');
      return;
    }
    
    // Interactive mode if no action provided
    if (!action) {
      const { selectedAction } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedAction',
          message: 'What would you like to do?',
          choices: [
            { name: 'Create ticket', value: 'create' },
            { name: 'Claim ticket', value: 'claim' },
            { name: 'Assign ticket', value: 'assign' },
            { name: 'Reassign ticket', value: 'reassign' },
            { name: 'Unassign ticket', value: 'unassign' },
            { name: 'Complete ticket', value: 'complete' },
            { name: 'List tickets', value: 'list' }
          ]
        }
      ]);
      action = selectedAction;
    }
    
    switch(action) {
      case 'create':
        await managers.pmo.create();
        break;
      case 'claim':
        await managers.pmo.claim(ticketId);
        break;
      case 'assign':
        await managers.pmo.assign(ticketId, agentName);
        break;
      case 'reassign':
        await managers.pmo.reassign(ticketId, agentName);
        break;
      case 'unassign':
        await managers.pmo.unassign(ticketId);
        break;
      case 'complete':
        if (ticketId) {
          await managers.pmo.complete(ticketId);
        } else {
          log.error('Ticket ID required for complete');
        }
        break;
      case 'list':
        await managers.pmo.list();
        break;
      default:
        log.error(`Unknown action: ${action}`);
        log.info('Available actions: create, claim, assign, reassign, unassign, complete, list');
    }
  });

program
  .command('access')
  .description('🔑 Manage agent repository access')
  .action(async () => {
    const managers = getManagers();
    if (!managers) {
      log.error('Not in an HQ directory! Run `prlt init --hq <name>` first.');
      return;
    }
    
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Grant access', value: 'grant' },
          { name: 'Revoke access', value: 'revoke' }
        ]
      }
    ]);
    
    if (action === 'grant') {
      await managers.agent.grant();
    } else {
      await managers.agent.revoke();
    }
  });

program
  .command('go <agent>')
  .alias('switch')
  .description('🚀 Switch to an agent workspace')
  .action((agent: string) => {
    const managers = getManagers();
    if (managers) {
      // HQ mode - use manager
      managers.agent.switch(agent);
    } else {
      // Simple mode - use direct path
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
