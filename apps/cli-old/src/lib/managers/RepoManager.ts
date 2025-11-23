/**
 * Repository management class
 * Handles adding, removing, and managing repositories
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { log } from '../utils/logger.js';
import { HQConfig, IRepoManager } from './types.js';

export class RepoManager implements IRepoManager {
  constructor(
    private hqRoot: string,
    private config: HQConfig
  ) {}

  /**
   * Add a repository to HQ
   */
  async add(repoPath?: string): Promise<void> {
    // Interactive mode if no path provided
    if (!repoPath) {
      const { addMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'addMode',
          message: 'How would you like to add a repository?',
          choices: [
            { name: '📦 Clone from GitHub', value: 'clone' },
            { name: '📁 Add existing local repository', value: 'existing' },
            { name: '✨ Create new repository', value: 'new' },
            { name: '🔄 Move current directory into HQ', value: 'current' }
          ]
        }
      ]);

      switch (addMode) {
        case 'clone':
          await this.cloneFromGitHub();
          break;
        case 'existing':
          await this.addExistingRepo();
          break;
        case 'new':
          await this.createNewRepo();
          break;
        case 'current':
          await this.moveCurrentRepo();
          break;
      }
    } else {
      // Direct path provided - add existing repo
      await this.addRepoByPath(repoPath);
    }
  }

  /**
   * Remove a repository from HQ
   */
  async remove(repoName?: string): Promise<void> {
    let repo = repoName;
    
    if (!repo) {
      if (this.config.repos.length === 0) {
        log.warning('No repositories to remove!');
        return;
      }

      const { selectedRepo } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedRepo',
          message: 'Which repository should be removed?',
          choices: this.config.repos
        }
      ]);
      repo = selectedRepo;
    }

    if (!repo || !this.config.repos.includes(repo)) {
      log.error(`Repository '${repo}' not found in HQ`);
      return;
    }

    // Confirm removal
    const { confirmRemove } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmRemove',
        message: `Remove '${repo}' from HQ? This will delete all agent worktrees.`,
        default: false
      }
    ]);

    if (!confirmRemove) {
      log.info('Cancelled');
      return;
    }

    // Remove all agent worktrees for this repo
    await this.removeAllWorktrees(repo);

    // Remove repo directory
    const repoPath = path.join(this.hqRoot, 'repos', repo);
    if (fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }

    // Update config
    this.config.repos = this.config.repos.filter(r => r !== repo!);
    
    // Remove from agent access
    if (this.config.agentAccess) {
      for (const agent in this.config.agentAccess) {
        this.config.agentAccess[agent] = this.config.agentAccess[agent].filter(
          r => r !== repo
        );
      }
    }

    this.saveConfig();
    log.success(`✅ Removed repository '${repo}' from HQ`);
  }

  /**
   * List all repositories and their status
   */
  async list(): Promise<void> {
    console.log(chalk.blue(`\n📦 Repositories in ${this.config.name} HQ\n`));

    if (this.config.repos.length === 0) {
      console.log(chalk.yellow('No repositories added yet'));
      console.log(chalk.dim(`Run 'prlt add' to add repositories\n`));
      return;
    }

    const reposDir = path.join(this.hqRoot, 'repos');
    
    for (const repo of this.config.repos) {
      const repoPath = path.join(reposDir, repo);
      
      console.log(chalk.bold(`  ${repo}`));
      
      if (!fs.existsSync(repoPath)) {
        console.log(chalk.red('    ✗ Directory not found'));
        continue;
      }

      try {
        // Get current branch
        const branch = execSync('git branch --show-current', {
          cwd: repoPath,
          encoding: 'utf-8'
        }).trim();

        // Get status
        const status = execSync('git status --porcelain', {
          cwd: repoPath,
          encoding: 'utf-8'
        }).trim();

        const isDirty = status.length > 0;
        
        console.log(chalk.green(`    ✓ Branch: ${branch}`) + 
                   (isDirty ? chalk.yellow(' (uncommitted changes)') : ''));

        // Show which agents have access
        const agentsWithAccess = [];
        for (const [agent, repos] of Object.entries(this.config.agentAccess || {})) {
          if (repos.includes(repo)) {
            agentsWithAccess.push(agent);
          }
        }
        
        if (agentsWithAccess.length > 0) {
          console.log(chalk.dim(`    Agents: ${agentsWithAccess.join(', ')}`));
        } else {
          console.log(chalk.dim('    No agents have access'));
        }
      } catch (error) {
        console.log(chalk.red('    ✗ Not a git repository'));
      }
      
      console.log('');
    }
  }

  // Private helper methods
  
  private async cloneFromGitHub(): Promise<void> {
    const { repoUrl } = await inquirer.prompt([
      {
        type: 'input',
        name: 'repoUrl',
        message: 'GitHub repository URL (or owner/repo):',
        validate: (input) => input.length > 0 || 'Please provide a repository URL'
      }
    ]);

    // Parse repo name from URL
    let repoName: string;
    if (repoUrl.includes('github.com')) {
      repoName = repoUrl.split('/').pop()?.replace('.git', '') || '';
    } else if (repoUrl.includes('/')) {
      repoName = repoUrl.split('/')[1];
    } else {
      repoName = repoUrl;
    }

    const reposDir = path.join(this.hqRoot, 'repos');
    const repoPath = path.join(reposDir, repoName);

    if (fs.existsSync(repoPath)) {
      log.error(`Repository '${repoName}' already exists in HQ`);
      return;
    }

    log.info(`Cloning ${repoName}...`);

    try {
      const fullUrl = repoUrl.includes('github.com') 
        ? repoUrl 
        : `https://github.com/${repoUrl}`;
      
      execSync(`git clone "${fullUrl}" "${repoPath}"`, {
        stdio: 'inherit'
      });

      this.config.repos.push(repoName);
      await this.createWorktreesForRepo(repoName);
      this.saveConfig();
      
      log.success(`✅ Added repository '${repoName}' to HQ`);
    } catch (error) {
      log.error(`Failed to clone repository: ${error}`);
    }
  }

  private async addExistingRepo(): Promise<void> {
    const { repoPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'repoPath',
        message: 'Path to existing repository:',
        validate: (input) => {
          if (!input) return 'Please provide a path';
          if (!fs.existsSync(input)) return 'Path does not exist';
          const gitPath = path.join(input, '.git');
          if (!fs.existsSync(gitPath)) return 'Not a git repository';
          return true;
        }
      }
    ]);

    await this.addRepoByPath(repoPath);
  }

  private async addRepoByPath(repoPath: string): Promise<void> {
    const absolutePath = path.resolve(repoPath);
    const repoName = path.basename(absolutePath);
    const targetPath = path.join(this.hqRoot, 'repos', repoName);

    if (this.config.repos.includes(repoName)) {
      log.error(`Repository '${repoName}' already exists in HQ`);
      return;
    }

    const { moveOrSymlink } = await inquirer.prompt([
      {
        type: 'list',
        name: 'moveOrSymlink',
        message: `How should '${repoName}' be added to HQ?`,
        choices: [
          { name: '📦 Move repository into HQ', value: 'move' },
          { name: '🔗 Create symbolic link (keep original location)', value: 'symlink' }
        ]
      }
    ]);

    try {
      if (moveOrSymlink === 'move') {
        fs.renameSync(absolutePath, targetPath);
        log.success(`✅ Moved '${repoName}' into HQ`);
      } else {
        fs.symlinkSync(absolutePath, targetPath, 'dir');
        log.success(`✅ Linked '${repoName}' to HQ`);
      }

      this.config.repos.push(repoName);
      await this.createWorktreesForRepo(repoName);
      this.saveConfig();
      
      log.success(`✅ Added repository '${repoName}' to HQ`);
    } catch (error) {
      log.error(`Failed to add repository: ${error}`);
    }
  }

  private async createNewRepo(): Promise<void> {
    const { repoName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'repoName',
        message: 'New repository name:',
        validate: (input) => {
          if (!input) return 'Please provide a name';
          if (this.config.repos.includes(input)) return 'Repository already exists';
          return true;
        }
      }
    ]);

    const repoPath = path.join(this.hqRoot, 'repos', repoName);
    
    try {
      fs.mkdirSync(repoPath, { recursive: true });
      execSync('git init', { cwd: repoPath });
      
      // Create initial commit
      const readmePath = path.join(repoPath, 'README.md');
      fs.writeFileSync(readmePath, `# ${repoName}\n\nCreated with Proletariat HQ\n`);
      execSync('git add .', { cwd: repoPath });
      execSync('git commit -m "Initial commit"', { cwd: repoPath });

      this.config.repos.push(repoName);
      await this.createWorktreesForRepo(repoName);
      this.saveConfig();
      
      log.success(`✅ Created new repository '${repoName}' in HQ`);
    } catch (error) {
      log.error(`Failed to create repository: ${error}`);
    }
  }

  private async moveCurrentRepo(): Promise<void> {
    const currentDir = process.cwd();
    const gitPath = path.join(currentDir, '.git');
    
    if (!fs.existsSync(gitPath)) {
      log.error('Current directory is not a git repository');
      return;
    }

    const repoName = path.basename(currentDir);
    await this.addRepoByPath(currentDir);
  }

  private async createWorktreesForRepo(repoName: string): Promise<void> {
    if (this.config.agentRepoMode === 'manual') {
      return; // Manual mode - don't auto-create worktrees
    }

    const agents = this.config.agentRepoMode === 'all' 
      ? this.config.agents 
      : await this.selectAgentsForRepo(repoName);

    if (agents.length === 0) return;

    log.info(`Creating worktrees for ${agents.length} agent(s)...`);

    const { getAllThemes } = await import('../themes/index.js');
    const themes = getAllThemes();
    const theme = themes[this.config.theme];
    
    if (!theme) {
      log.error(`Theme ${this.config.theme} not found!`);
      return;
    }

    const repoPath = path.join(this.hqRoot, 'repos', repoName);
    const agentsDir = path.join(this.hqRoot, '.proletariat', 'agents', theme.directory);

    for (const agent of agents) {
      const agentDir = path.join(agentsDir, agent);
      const worktreePath = path.join(agentDir, repoName);

      if (!fs.existsSync(agentDir)) {
        fs.mkdirSync(agentDir, { recursive: true });
      }

      if (!fs.existsSync(worktreePath)) {
        try {
          const branchName = `${agent}-workspace`;
          execSync(`git worktree add -b "${branchName}" "${worktreePath}" HEAD`, {
            cwd: repoPath,
            stdio: 'ignore'
          });
          
          // Update agent access
          if (!this.config.agentAccess) {
            this.config.agentAccess = {};
          }
          if (!this.config.agentAccess[agent]) {
            this.config.agentAccess[agent] = [];
          }
          if (!this.config.agentAccess[agent].includes(repoName)) {
            this.config.agentAccess[agent].push(repoName);
          }
          
          log.success(`  ✓ Created worktree for ${agent}`);
        } catch (error) {
          log.warning(`  ✗ Could not create worktree for ${agent}`);
        }
      }
    }
  }

  private async selectAgentsForRepo(repoName: string): Promise<string[]> {
    if (this.config.agents.length === 0) {
      return [];
    }

    const { selectedAgents } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedAgents',
        message: `Which agents should have access to '${repoName}'?`,
        choices: this.config.agents,
        default: this.config.agents
      }
    ]);

    return selectedAgents;
  }

  private async removeAllWorktrees(repoName: string): Promise<void> {
    const { getAllThemes } = await import('../themes/index.js');
    const themes = getAllThemes();
    const theme = themes[this.config.theme];
    
    if (!theme) return;

    const repoPath = path.join(this.hqRoot, 'repos', repoName);
    const agentsDir = path.join(this.hqRoot, '.proletariat', 'agents', theme.directory);

    for (const agent of this.config.agents) {
      const worktreePath = path.join(agentsDir, agent, repoName);
      
      if (fs.existsSync(worktreePath)) {
        try {
          execSync(`git worktree remove "${worktreePath}"`, {
            cwd: repoPath,
            stdio: 'ignore'
          });
        } catch {
          // Force remove if git command fails
          fs.rmSync(worktreePath, { recursive: true, force: true });
        }
      }
    }
  }

  private saveConfig(): void {
    const configPath = path.join(this.hqRoot, '.proletariat', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
  }
}