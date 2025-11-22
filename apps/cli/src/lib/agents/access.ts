/**
 * Unified access management for agents
 * Single command to grant or revoke repository access
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { log } from '../utils/logger.js';

interface HQConfig {
  version: string;
  type: 'hq';
  name: string;
  theme: string;
  themeDirectory: string;
  agents: string[];
  repos: string[];
  agentRepoMode: 'all' | 'ask' | 'manual';
  agentAccess?: Record<string, string[]>;
  initialized: string;
}

function findHQRoot(maxDepth: number = 10): string | null {
  let currentDir = process.cwd();
  for (let i = 0; i < maxDepth; i++) {
    const hqConfigPath = path.join(currentDir, '.proletariat', 'config.json');
    if (fs.existsSync(hqConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(hqConfigPath, 'utf-8'));
        if (config.type === 'hq') {
          return currentDir;
        }
      } catch {
        // Not an HQ config, continue searching
      }
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) break; // Reached root
    currentDir = parent;
  }
  return null;
}

function loadHQConfig(hqRoot: string): HQConfig {
  const configPath = path.join(hqRoot, '.proletariat', 'config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function saveHQConfig(hqRoot: string, config: HQConfig): void {
  const configPath = path.join(hqRoot, '.proletariat', 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export async function manageAccess(): Promise<void> {
  const hqRoot = findHQRoot();
  if (!hqRoot) {
    log.error('Not in an HQ directory! Run this command from anywhere inside your HQ.');
    return;
  }

  const config = loadHQConfig(hqRoot);
  log.info(`Managing access for ${chalk.bold(config.name)} HQ`);
  
  if (config.agents.length === 0) {
    log.warning('No agents hired yet! Run `prlt hire` first.');
    return;
  }
  
  if (config.repos.length === 0) {
    log.warning('No repositories added yet! Run `prlt add` first.');
    return;
  }

  // Choose action
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '🔑 Grant an agent access to repositories', value: 'grant' },
        { name: '🔒 Revoke an agent\'s repository access', value: 'revoke' },
        { name: '📊 View current access matrix', value: 'view' }
      ]
    }
  ]);

  if (action === 'view') {
    await viewAccessMatrix(config);
    return;
  }

  if (action === 'grant') {
    await grantAccessFlow(hqRoot, config);
  } else if (action === 'revoke') {
    await revokeAccessFlow(hqRoot, config);
  }
}

async function viewAccessMatrix(config: HQConfig): Promise<void> {
  console.log('\n📊 Access Matrix:\n');
  
  if (config.agents.length === 0) {
    console.log(chalk.dim('No agents hired'));
    return;
  }

  for (const agent of config.agents) {
    const repos = config.agentAccess?.[agent] || [];
    console.log(chalk.bold(`  ${agent}:`));
    
    if (repos.length === 0) {
      console.log(chalk.dim('    No repository access'));
    } else {
      for (const repo of repos) {
        console.log(chalk.green(`    ✓ ${repo}`));
      }
    }
    console.log();
  }
}

async function grantAccessFlow(hqRoot: string, config: HQConfig): Promise<void> {
  // Select agent
  const { selectedAgent } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedAgent',
      message: 'Which agent should get access?',
      choices: config.agents.map(agent => {
        const currentRepos = config.agentAccess?.[agent] || [];
        return {
          name: `${agent} (currently has: ${currentRepos.length > 0 ? currentRepos.join(', ') : 'no repos'})`,
          value: agent
        };
      })
    }
  ]);

  // Get repos this agent doesn't have
  const currentAccess = config.agentAccess?.[selectedAgent] || [];
  const availableRepos = config.repos.filter(repo => !currentAccess.includes(repo));

  if (availableRepos.length === 0) {
    log.info(`${selectedAgent} already has access to all repositories!`);
    return;
  }

  // Select repos to grant
  const { selectedRepos } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedRepos',
      message: `Grant ${selectedAgent} access to:`,
      choices: availableRepos,
      validate: (input) => input.length > 0 || 'Please select at least one repository'
    }
  ]);

  log.info(`Granting access to ${selectedRepos.length} repository(ies)...`);

  const { getAllThemes } = await import('../themes/index.js');
  const themes = getAllThemes();
  const theme = themes[config.theme];
  
  if (!theme) {
    log.error(`Theme ${config.theme} not found!`);
    return;
  }

  const agentsDir = path.join(hqRoot, '.proletariat', 'agents', theme.directory);
  const agentDir = path.join(agentsDir, selectedAgent);

  // Create worktrees for each repo
  for (const repo of selectedRepos) {
    const repoPath = path.join(hqRoot, 'repos', repo);
    const worktreePath = path.join(agentDir, repo);
    
    if (!fs.existsSync(repoPath)) {
      log.warning(`Repository ${repo} not found in HQ/repos`);
      continue;
    }

    if (fs.existsSync(worktreePath)) {
      log.info(`${selectedAgent} already has worktree for ${repo}`);
      continue;
    }

    try {
      const branchName = `${selectedAgent}-workspace`;
      // Try main first
      try {
        execSync(`git worktree add -b "${branchName}" "${worktreePath}" main`, {
          cwd: repoPath,
          stdio: 'ignore'
        });
      } catch {
        // Try master if main doesn't exist
        execSync(`git worktree add -b "${branchName}" "${worktreePath}" master`, {
          cwd: repoPath,
          stdio: 'ignore'
        });
      }
      log.success(`✓ Granted ${selectedAgent} access to ${repo}`);
    } catch (error) {
      log.error(`✗ Could not create worktree for ${repo}`);
    }
  }

  // Update config
  if (!config.agentAccess) {
    config.agentAccess = {};
  }
  if (!config.agentAccess[selectedAgent]) {
    config.agentAccess[selectedAgent] = [];
  }
  
  for (const repo of selectedRepos) {
    if (!config.agentAccess[selectedAgent].includes(repo)) {
      config.agentAccess[selectedAgent].push(repo);
    }
  }

  saveHQConfig(hqRoot, config);
  log.success(`✅ Access granted successfully!`);
}

async function revokeAccessFlow(hqRoot: string, config: HQConfig): Promise<void> {
  // Find agents with access to revoke
  const agentsWithAccess = config.agents.filter(
    agent => (config.agentAccess?.[agent]?.length || 0) > 0
  );

  if (agentsWithAccess.length === 0) {
    log.warning('No agents have repository access to revoke!');
    return;
  }

  // Select agent
  const { selectedAgent } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedAgent',
      message: 'Which agent should lose access?',
      choices: agentsWithAccess.map(agent => {
        const repos = config.agentAccess![agent];
        return {
          name: `${agent} (has: ${repos.join(', ')})`,
          value: agent
        };
      })
    }
  ]);

  const currentAccess = config.agentAccess![selectedAgent];

  // Select repos to revoke
  const { selectedRepos } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedRepos',
      message: `Revoke ${selectedAgent}'s access to:`,
      choices: currentAccess,
      validate: (input) => input.length > 0 || 'Please select at least one repository'
    }
  ]);

  // Confirm
  const { confirmRevoke } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmRevoke',
      message: `Remove ${selectedAgent}'s access to ${selectedRepos.join(', ')}?`,
      default: false
    }
  ]);

  if (!confirmRevoke) {
    log.info('Cancelled');
    return;
  }

  log.info(`Revoking access to ${selectedRepos.length} repository(ies)...`);

  const { getAllThemes } = await import('../themes/index.js');
  const themes = getAllThemes();
  const theme = themes[config.theme];
  
  if (!theme) {
    log.error(`Theme ${config.theme} not found!`);
    return;
  }

  const agentsDir = path.join(hqRoot, '.proletariat', 'agents', theme.directory);
  const agentDir = path.join(agentsDir, selectedAgent);

  // Remove worktrees
  for (const repo of selectedRepos) {
    const worktreePath = path.join(agentDir, repo);
    
    if (fs.existsSync(worktreePath)) {
      try {
        const repoPath = path.join(hqRoot, 'repos', repo);
        execSync(`git worktree remove "${worktreePath}"`, {
          cwd: repoPath,
          stdio: 'ignore'
        });
        log.success(`✓ Revoked ${selectedAgent}'s access to ${repo}`);
      } catch {
        // Force remove if git command fails
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
          log.success(`✓ Revoked ${selectedAgent}'s access to ${repo} (forced)`);
        } catch (error) {
          log.error(`✗ Could not remove worktree for ${repo}`);
        }
      }
    }
  }

  // Update config
  config.agentAccess![selectedAgent] = currentAccess.filter(
    repo => !selectedRepos.includes(repo)
  );

  // Clean up if agent has no access left
  if (config.agentAccess![selectedAgent].length === 0) {
    delete config.agentAccess![selectedAgent];
  }

  saveHQConfig(hqRoot, config);
  log.success(`✅ Access revoked successfully!`);
}