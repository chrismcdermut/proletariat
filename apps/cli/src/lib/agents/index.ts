/**
 * Agent management for HQ mode
 * Handles hiring, firing, and managing agents across repositories
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

function findHQRoot(): string | null {
  let currentDir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const hqConfigPath = path.join(currentDir, '.proletariat', 'config.json');
    if (fs.existsSync(hqConfigPath)) {
      const config = JSON.parse(fs.readFileSync(hqConfigPath, 'utf-8'));
      if (config.type === 'hq') {
        return currentDir;
      }
    }
    currentDir = path.dirname(currentDir);
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

export async function hireAgents(agentNames?: string[]): Promise<void> {
  const hqRoot = findHQRoot();
  if (!hqRoot) {
    log.error('Not in an HQ directory! Run `prlt init --hq` first.');
    return;
  }

  const config = loadHQConfig(hqRoot);
  const { getAllThemes } = await import('../themes/index.js');
  const themes = getAllThemes();
  const theme = themes[config.theme];
  
  if (!theme) {
    log.error(`Theme ${config.theme} not found!`);
    return;
  }

  let agents = agentNames || [];
  
  // Interactive selection if no agents specified
  if (agents.length === 0) {
    const availableAgents = theme.agents.filter(a => !config.agents.includes(a));
    
    if (availableAgents.length === 0) {
      log.warning('All available agents are already hired!');
      return;
    }
    
    const { selectedAgents } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedAgents',
        message: `Select ${theme.displayName} to hire:`,
        choices: availableAgents.map(agent => ({
          name: agent,
          value: agent
        })),
        validate: (input) => input.length > 0 || 'Please select at least one agent'
      }
    ]);
    
    agents = selectedAgents;
  }

  // Validate agents
  const validAgents = agents.filter(agent => {
    if (!theme.agents.includes(agent)) {
      log.warning(`${agent} is not a valid ${theme.name} agent`);
      return false;
    }
    if (config.agents.includes(agent)) {
      log.warning(`${agent} is already hired`);
      return false;
    }
    return true;
  });

  if (validAgents.length === 0) {
    return;
  }

  log.info(`Hiring ${validAgents.join(', ')}...`);

  // Create agent directories
  const agentsDir = path.join(hqRoot, '.proletariat', 'agents', theme.directory);
  
  for (const agent of validAgents) {
    const agentDir = path.join(agentsDir, agent);
    
    if (!fs.existsSync(agentDir)) {
      fs.mkdirSync(agentDir, { recursive: true });
      log.success(`Created workspace for ${agent}`);
    }

    // Determine which repos this agent should have access to
    let reposToAdd = config.repos;
    
    if (config.agentRepoMode === 'ask' && config.repos.length > 0) {
      const { selectedRepos } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedRepos',
          message: `Which repositories should ${agent} have access to?`,
          choices: config.repos,
          default: config.repos
        }
      ]);
      reposToAdd = selectedRepos;
    } else if (config.agentRepoMode === 'manual') {
      reposToAdd = []; // Manual mode - don't add any repos automatically
    }

    // Create worktrees for each repo
    for (const repo of reposToAdd) {
      const repoPath = path.join(hqRoot, 'repos', repo);
      const worktreePath = path.join(agentDir, repo);
      
      if (fs.existsSync(repoPath) && !fs.existsSync(worktreePath)) {
        try {
          const branchName = `${agent}-workspace`;
          execSync(`git worktree add -b "${branchName}" "${worktreePath}" main`, {
            cwd: repoPath,
            stdio: 'ignore'
          });
          log.success(`  ✓ Added ${repo} worktree for ${agent}`);
        } catch (error) {
          log.warning(`  ✗ Could not create ${repo} worktree for ${agent}`);
        }
      }
    }

    // Update agent access in config
    if (!config.agentAccess) {
      config.agentAccess = {};
    }
    config.agentAccess[agent] = reposToAdd;
  }

  // Update config
  config.agents.push(...validAgents);
  saveHQConfig(hqRoot, config);

  log.success(`✅ Hired ${validAgents.length} agent(s)!`);
  log.info(`Workspaces created at: ${agentsDir}`);
  
  if (config.repos.length === 0) {
    log.info(`💡 No repositories yet. Run 'prlt add' to add repositories.`);
  }
}

export async function fireAgents(agentNames?: string[]): Promise<void> {
  const hqRoot = findHQRoot();
  if (!hqRoot) {
    log.error('Not in an HQ directory!');
    return;
  }

  const config = loadHQConfig(hqRoot);
  const { getAllThemes } = await import('../themes/index.js');
  const themes = getAllThemes();
  const theme = themes[config.theme];
  
  if (!theme) {
    log.error(`Theme ${config.theme} not found!`);
    return;
  }

  let agents = agentNames || [];
  
  // Interactive selection if no agents specified
  if (agents.length === 0) {
    if (config.agents.length === 0) {
      log.warning('No agents to fire!');
      return;
    }
    
    const { selectedAgents } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedAgents',
        message: 'Select agents to fire:',
        choices: config.agents
      }
    ]);
    
    agents = selectedAgents;
  }

  const validAgents = agents.filter(agent => config.agents.includes(agent));
  
  if (validAgents.length === 0) {
    log.warning('No valid agents to fire');
    return;
  }

  const { confirmFire } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmFire',
      message: `Are you sure you want to fire ${validAgents.join(', ')}? This will remove their workspaces.`,
      default: false
    }
  ]);

  if (!confirmFire) {
    log.info('Cancelled');
    return;
  }

  const agentsDir = path.join(hqRoot, '.proletariat', 'agents', theme.directory);
  
  for (const agent of validAgents) {
    const agentDir = path.join(agentsDir, agent);
    
    if (fs.existsSync(agentDir)) {
      // Remove worktrees first
      const repos = config.agentAccess?.[agent] || [];
      for (const repo of repos) {
        const worktreePath = path.join(agentDir, repo);
        if (fs.existsSync(worktreePath)) {
          try {
            const repoPath = path.join(hqRoot, 'repos', repo);
            execSync(`git worktree remove "${worktreePath}"`, {
              cwd: repoPath,
              stdio: 'ignore'
            });
          } catch {
            // Force remove if git worktree remove fails
            fs.rmSync(worktreePath, { recursive: true, force: true });
          }
        }
      }
      
      // Remove agent directory
      fs.rmSync(agentDir, { recursive: true, force: true });
      log.success(`Fired ${agent}`);
    }
    
    // Remove from config
    config.agents = config.agents.filter(a => a !== agent);
    if (config.agentAccess) {
      delete config.agentAccess[agent];
    }
  }

  saveHQConfig(hqRoot, config);
  log.success(`✅ Fired ${validAgents.length} agent(s)`);
}

export async function showAgentStatus(): Promise<void> {
  const hqRoot = findHQRoot();
  if (!hqRoot) {
    log.error('Not in an HQ directory!');
    return;
  }

  const config = loadHQConfig(hqRoot);
  const { getAllThemes } = await import('../themes/index.js');
  const themes = getAllThemes();
  const theme = themes[config.theme];
  
  if (!theme) {
    log.error(`Theme ${config.theme} not found!`);
    return;
  }

  console.log(chalk.blue(`\n🏢 ${config.name} HQ`));
  console.log(chalk.cyan(`Theme: ${theme.displayName}`));
  console.log(chalk.dim(`Location: ${hqRoot}\n`));

  if (config.agents.length === 0) {
    console.log(chalk.yellow('No agents hired yet'));
    console.log(chalk.dim(`Run 'prlt ${theme.commands.create}' to hire agents\n`));
    return;
  }

  console.log(chalk.green(`Active ${theme.displayName}:`));
  
  const agentsDir = path.join(hqRoot, '.proletariat', 'agents', theme.directory);
  
  for (const agent of config.agents) {
    const agentDir = path.join(agentsDir, agent);
    const repos = config.agentAccess?.[agent] || [];
    
    console.log(`\n  ${chalk.bold(agent)}`);
    
    if (repos.length === 0) {
      console.log(chalk.dim('    No repository access'));
    } else {
      for (const repo of repos) {
        const worktreePath = path.join(agentDir, repo);
        if (fs.existsSync(worktreePath)) {
          try {
            const branch = execSync('git branch --show-current', {
              cwd: worktreePath,
              encoding: 'utf-8'
            }).trim();
            console.log(chalk.green(`    ✓ ${repo}`) + chalk.dim(` (${branch})`));
          } catch {
            console.log(chalk.yellow(`    ⚠ ${repo}`) + chalk.dim(' (worktree issue)'));
          }
        } else {
          console.log(chalk.red(`    ✗ ${repo}`) + chalk.dim(' (not created)'));
        }
      }
    }
    
    // Check for current ticket
    const currentFile = path.join(agentDir, '.current');
    if (fs.existsSync(currentFile)) {
      try {
        const current = JSON.parse(fs.readFileSync(currentFile, 'utf-8'));
        console.log(chalk.magenta(`    📋 Working on: ${current.ticket}`));
      } catch {
        // Ignore parse errors
      }
    }
  }
  
  console.log('');
  console.log(chalk.cyan(theme.messages.slogan));
}

export async function grantAccess(): Promise<void> {
  const hqRoot = findHQRoot();
  if (!hqRoot) {
    log.error('Not in an HQ directory!');
    return;
  }

  const config = loadHQConfig(hqRoot);
  
  if (config.agents.length === 0) {
    log.warning('No agents hired yet! Run `prlt hire` first.');
    return;
  }
  
  if (config.repos.length === 0) {
    log.warning('No repositories added yet! Run `prlt add` first.');
    return;
  }

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

export async function revokeAccess(): Promise<void> {
  const hqRoot = findHQRoot();
  if (!hqRoot) {
    log.error('Not in an HQ directory!');
    return;
  }

  const config = loadHQConfig(hqRoot);
  
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