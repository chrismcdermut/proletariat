/**
 * Agent management class
 * Handles hiring, firing, and managing agents
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { log } from '../utils/logger.js';
import { HQConfig, IAgentManager } from './types.js';
import { getAllThemes } from '../themes/index.js';

export class AgentManager implements IAgentManager {
  private theme: any;
  
  constructor(
    private hqRoot: string,
    private config: HQConfig
  ) {
    const themes = getAllThemes();
    this.theme = themes[config.theme];
  }

  /**
   * Add new agents (hire/drive/acquire)
   */
  async add(agentNames?: string[]): Promise<void> {
    if (!this.theme) {
      log.error(`Theme ${this.config.theme} not found!`);
      return;
    }

    let agents = agentNames || [];
    
    // Interactive selection if no agents specified
    if (agents.length === 0) {
      const availableAgents = this.theme.agents.filter(
        (a: string) => !this.config.agents.includes(a)
      );
      
      if (availableAgents.length === 0) {
        log.warning('All available agents are already hired!');
        return;
      }
      
      const { selectedAgents } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedAgents',
          message: `Select ${this.theme.displayName} to hire:`,
          choices: availableAgents.map((agent: string) => ({
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
      if (!this.theme.agents.includes(agent)) {
        log.warning(`${agent} is not a valid ${this.theme.name} agent`);
        return false;
      }
      if (this.config.agents.includes(agent)) {
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
    const agentsDir = path.join(this.hqRoot, '.proletariat', 'agents', this.theme.directory);
    
    for (const agent of validAgents) {
      const agentDir = path.join(agentsDir, agent);
      
      if (!fs.existsSync(agentDir)) {
        fs.mkdirSync(agentDir, { recursive: true });
        log.success(`Created workspace for ${agent}`);
      }

      // Handle repo access based on mode
      await this.setupAgentRepos(agent, agentDir);
    }

    // Update config
    this.config.agents.push(...validAgents);
    this.saveConfig();

    log.success(`✅ Hired ${validAgents.length} agent(s)!`);
    log.info(`Workspaces created at: ${agentsDir}`);
  }

  /**
   * Remove agents (fire/park/divest)
   */
  async remove(agentNames?: string[]): Promise<void> {
    let agents = agentNames || [];
    
    // Interactive selection if no agents specified
    if (agents.length === 0) {
      if (this.config.agents.length === 0) {
        log.warning('No agents to remove!');
        return;
      }
      
      const { selectedAgents } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedAgents',
          message: 'Select agents to remove:',
          choices: this.config.agents
        }
      ]);
      
      agents = selectedAgents;
    }

    const validAgents = agents.filter(agent => this.config.agents.includes(agent));
    
    if (validAgents.length === 0) {
      log.warning('No valid agents to remove');
      return;
    }

    const { confirmRemove } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmRemove',
        message: `Are you sure you want to remove ${validAgents.join(', ')}?`,
        default: false
      }
    ]);

    if (!confirmRemove) {
      log.info('Cancelled');
      return;
    }

    const agentsDir = path.join(this.hqRoot, '.proletariat', 'agents', this.theme.directory);
    
    for (const agent of validAgents) {
      const agentDir = path.join(agentsDir, agent);
      
      if (fs.existsSync(agentDir)) {
        // Remove worktrees first
        await this.removeAgentWorktrees(agent, agentDir);
        
        // Remove agent directory
        fs.rmSync(agentDir, { recursive: true, force: true });
        log.success(`Removed ${agent}`);
      }
      
      // Update config
      this.config.agents = this.config.agents.filter(a => a !== agent);
      if (this.config.agentAccess) {
        delete this.config.agentAccess[agent];
      }
    }

    this.saveConfig();
    log.success(`✅ Removed ${validAgents.length} agent(s)`);
  }

  /**
   * List all agents and their status
   */
  async list(): Promise<void> {
    console.log(chalk.blue(`\n🏢 ${this.config.name} HQ`));
    console.log(chalk.cyan(`Theme: ${this.theme.displayName}`));
    console.log(chalk.dim(`Location: ${this.hqRoot}\n`));

    if (this.config.agents.length === 0) {
      console.log(chalk.yellow('No agents hired yet'));
      console.log(chalk.dim(`Run 'prlt ${this.theme.commands.create}' to hire agents\n`));
      return;
    }

    console.log(chalk.green(`Active ${this.theme.displayName}:`));
    
    const agentsDir = path.join(this.hqRoot, '.proletariat', 'agents', this.theme.directory);
    
    for (const agent of this.config.agents) {
      const agentDir = path.join(agentsDir, agent);
      const repos = this.config.agentAccess?.[agent] || [];
      
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
    }
    
    console.log('');
    console.log(chalk.cyan(this.theme.messages.slogan));
  }

  /**
   * Grant agent access to repositories
   */
  async grant(): Promise<void> {
    if (this.config.agents.length === 0) {
      log.warning('No agents hired yet! Run `prlt hire` first.');
      return;
    }
    
    if (this.config.repos.length === 0) {
      log.warning('No repositories added yet! Run `prlt add` first.');
      return;
    }

    // Select agent
    const { selectedAgent } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedAgent',
        message: 'Which agent should get access?',
        choices: this.config.agents.map(agent => {
          const currentRepos = this.config.agentAccess?.[agent] || [];
          return {
            name: `${agent} (has: ${currentRepos.length > 0 ? currentRepos.join(', ') : 'no repos'})`,
            value: agent
          };
        })
      }
    ]);

    // Get repos this agent doesn't have
    const currentAccess = this.config.agentAccess?.[selectedAgent] || [];
    const availableRepos = this.config.repos.filter(repo => !currentAccess.includes(repo));

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

    await this.grantAgentAccess(selectedAgent, selectedRepos);
  }

  /**
   * Revoke agent access from repositories
   */
  async revoke(): Promise<void> {
    // Find agents with access
    const agentsWithAccess = this.config.agents.filter(
      agent => (this.config.agentAccess?.[agent]?.length || 0) > 0
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
          const repos = this.config.agentAccess![agent];
          return {
            name: `${agent} (has: ${repos.join(', ')})`,
            value: agent
          };
        })
      }
    ]);

    const currentAccess = this.config.agentAccess![selectedAgent];

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

    await this.revokeAgentAccess(selectedAgent, selectedRepos);
  }

  /**
   * Switch to an agent's workspace
   */
  switch(agent: string): void {
    if (!this.config.agents.includes(agent)) {
      log.error(`Agent '${agent}' not found!`);
      log.info(`Available agents: ${this.config.agents.join(', ')}`);
      return;
    }

    const agentPath = path.join(
      this.hqRoot,
      '.proletariat',
      'agents',
      this.theme.directory,
      agent
    );

    if (fs.existsSync(agentPath)) {
      console.log(chalk.green(`📍 Agent workspace: ${agentPath}`));
      console.log(chalk.cyan(`Run: cd "${agentPath}"`));
    } else {
      log.error(`Workspace for ${agent} not found`);
    }
  }

  // Private helper methods
  
  private async setupAgentRepos(agent: string, agentDir: string): Promise<void> {
    let reposToAdd = this.config.repos;
    
    if (this.config.agentRepoMode === 'ask' && this.config.repos.length > 0) {
      const { selectedRepos } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedRepos',
          message: `Which repositories should ${agent} have access to?`,
          choices: this.config.repos,
          default: this.config.repos
        }
      ]);
      reposToAdd = selectedRepos;
    } else if (this.config.agentRepoMode === 'manual') {
      reposToAdd = []; // Manual mode - don't add any repos automatically
    }

    if (reposToAdd.length > 0) {
      await this.createWorktrees(agent, agentDir, reposToAdd);
    }

    // Update agent access
    if (!this.config.agentAccess) {
      this.config.agentAccess = {};
    }
    this.config.agentAccess[agent] = reposToAdd;
  }

  private async createWorktrees(agent: string, agentDir: string, repos: string[]): Promise<void> {
    for (const repo of repos) {
      const repoPath = path.join(this.hqRoot, 'repos', repo);
      const worktreePath = path.join(agentDir, repo);
      
      if (fs.existsSync(repoPath) && !fs.existsSync(worktreePath)) {
        try {
          const branchName = `${agent}-workspace`;
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
          log.success(`  ✓ Added ${repo} worktree for ${agent}`);
        } catch (error) {
          log.warning(`  ✗ Could not create ${repo} worktree for ${agent}`);
        }
      }
    }
  }

  private async removeAgentWorktrees(agent: string, agentDir: string): Promise<void> {
    const repos = this.config.agentAccess?.[agent] || [];
    for (const repo of repos) {
      const worktreePath = path.join(agentDir, repo);
      if (fs.existsSync(worktreePath)) {
        try {
          const repoPath = path.join(this.hqRoot, 'repos', repo);
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
  }

  private async grantAgentAccess(agent: string, repos: string[]): Promise<void> {
    log.info(`Granting access to ${repos.length} repository(ies)...`);

    const agentsDir = path.join(this.hqRoot, '.proletariat', 'agents', this.theme.directory);
    const agentDir = path.join(agentsDir, agent);

    await this.createWorktrees(agent, agentDir, repos);

    // Update config
    if (!this.config.agentAccess) {
      this.config.agentAccess = {};
    }
    if (!this.config.agentAccess[agent]) {
      this.config.agentAccess[agent] = [];
    }
    
    for (const repo of repos) {
      if (!this.config.agentAccess[agent].includes(repo)) {
        this.config.agentAccess[agent].push(repo);
      }
    }

    this.saveConfig();
    log.success(`✅ Access granted successfully!`);
  }

  private async revokeAgentAccess(agent: string, repos: string[]): Promise<void> {
    const { confirmRevoke } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmRevoke',
        message: `Remove ${agent}'s access to ${repos.join(', ')}?`,
        default: false
      }
    ]);

    if (!confirmRevoke) {
      log.info('Cancelled');
      return;
    }

    log.info(`Revoking access to ${repos.length} repository(ies)...`);

    const agentsDir = path.join(this.hqRoot, '.proletariat', 'agents', this.theme.directory);
    const agentDir = path.join(agentsDir, agent);

    // Remove worktrees
    for (const repo of repos) {
      const worktreePath = path.join(agentDir, repo);
      
      if (fs.existsSync(worktreePath)) {
        try {
          const repoPath = path.join(this.hqRoot, 'repos', repo);
          execSync(`git worktree remove "${worktreePath}"`, {
            cwd: repoPath,
            stdio: 'ignore'
          });
          log.success(`✓ Revoked ${agent}'s access to ${repo}`);
        } catch {
          try {
            fs.rmSync(worktreePath, { recursive: true, force: true });
            log.success(`✓ Revoked ${agent}'s access to ${repo} (forced)`);
          } catch (error) {
            log.error(`✗ Could not remove worktree for ${repo}`);
          }
        }
      }
    }

    // Update config
    this.config.agentAccess![agent] = this.config.agentAccess![agent].filter(
      r => !repos.includes(r)
    );

    if (this.config.agentAccess![agent].length === 0) {
      delete this.config.agentAccess![agent];
    }

    this.saveConfig();
    log.success(`✅ Access revoked successfully!`);
  }

  private saveConfig(): void {
    const configPath = path.join(this.hqRoot, '.proletariat', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
  }
}