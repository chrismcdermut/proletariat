/**
 * Repository management for HQ mode
 * Handles adding, removing, and managing repositories
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

function isGitRepo(dir: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd: dir, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getGitRemote(dir: string): string | null {
  try {
    return execSync('git config --get remote.origin.url', { 
      cwd: dir, 
      encoding: 'utf-8' 
    }).trim();
  } catch {
    return null;
  }
}

export async function addRepo(repoPath?: string): Promise<void> {
  // Step 1: Find or ask for HQ
  let hqRoot = findHQRoot();
  
  if (!hqRoot) {
    // Not in an HQ, ask for HQ location
    const { hqLocation } = await inquirer.prompt([
      {
        type: 'input',
        name: 'hqLocation',
        message: 'Path to HQ directory:',
        validate: (input: string) => {
          const hqPath = path.resolve(input);
          const configPath = path.join(hqPath, '.proletariat', 'config.json');
          if (!fs.existsSync(configPath)) {
            return 'Not an HQ directory (no .proletariat/config.json)';
          }
          try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.type !== 'hq') {
              return 'Not an HQ directory (config.type is not "hq")';
            }
            return true;
          } catch {
            return 'Invalid HQ config';
          }
        }
      }
    ]);
    hqRoot = path.resolve(hqLocation);
  }
  
  const config = loadHQConfig(hqRoot);
  log.info(`Adding repository to ${chalk.bold(config.name)} HQ`);
  
  // Step 2: Determine what to add
  let repoSource: string = repoPath || '';
  let repoName: string = '';
  let isClone: boolean = false;
  
  if (!repoSource) {
    // Check if current directory is a git repo
    if (isGitRepo(process.cwd())) {
      const currentRepoName = path.basename(process.cwd());
      const { addCurrent } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'addCurrent',
          message: `Add current repository '${currentRepoName}' to HQ?`,
          default: true
        }
      ]);
      
      if (addCurrent) {
        repoSource = process.cwd();
        repoName = currentRepoName;
      }
    }
    
    // If not adding current, ask what to add
    if (!repoSource) {
      const { addChoice } = await inquirer.prompt([
        {
          type: 'list',
          name: 'addChoice',
          message: 'What would you like to add?',
          choices: [
            { name: 'Clone from GitHub/GitLab/etc', value: 'clone' },
            { name: 'Add existing local repository', value: 'existing' },
            { name: 'Create new repository', value: 'new' }
          ]
        }
      ]);
      
      if (addChoice === 'clone') {
        const { gitUrl } = await inquirer.prompt([
          {
            type: 'input',
            name: 'gitUrl',
            message: 'Git URL to clone:',
            validate: (input: string) => {
              if (!input) return 'URL is required';
              if (!input.includes('://') && !input.includes('@')) {
                return 'Invalid git URL';
              }
              return true;
            }
          }
        ]);
        repoSource = gitUrl;
        isClone = true;
        // Extract repo name from URL
        repoName = path.basename(gitUrl, '.git');
      } else if (addChoice === 'existing') {
        const { localPath } = await inquirer.prompt([
          {
            type: 'input',
            name: 'localPath',
            message: 'Path to existing repository:',
            validate: (input: string) => {
              const resolved = path.resolve(input);
              if (!fs.existsSync(resolved)) {
                return 'Path does not exist';
              }
              if (!isGitRepo(resolved)) {
                return 'Not a git repository';
              }
              return true;
            }
          }
        ]);
        repoSource = path.resolve(localPath);
        repoName = path.basename(repoSource);
      } else if (addChoice === 'new') {
        const { newRepoName } = await inquirer.prompt([
          {
            type: 'input',
            name: 'newRepoName',
            message: 'Name for new repository:',
            validate: (input: string) => {
              if (!input) return 'Name is required';
              if (!/^[a-zA-Z0-9-_]+$/.test(input)) {
                return 'Use only letters, numbers, hyphens, and underscores';
              }
              return true;
            }
          }
        ]);
        repoName = newRepoName;
        repoSource = 'new';
      }
    }
  } else {
    // Repo path was provided as argument
    if (repoSource.includes('://') || repoSource.includes('@')) {
      // It's a git URL
      isClone = true;
      repoName = path.basename(repoSource, '.git');
    } else {
      // It's a local path
      repoSource = path.resolve(repoSource);
      repoName = path.basename(repoSource);
      if (!fs.existsSync(repoSource)) {
        log.error(`Path does not exist: ${repoSource}`);
        return;
      }
      if (!isGitRepo(repoSource)) {
        log.error(`Not a git repository: ${repoSource}`);
        return;
      }
    }
  }
  
  // Check if repo already added
  if (config.repos.includes(repoName)) {
    log.warning(`Repository '${repoName}' is already in the HQ`);
    return;
  }
  
  // Step 3: Add the repository
  const repoDir = path.join(hqRoot, 'repos', repoName);
  
  if (fs.existsSync(repoDir)) {
    log.error(`Repository already exists at ${repoDir}`);
    return;
  }
  
  if (isClone) {
    // Clone the repository
    log.info(`Cloning ${repoSource}...`);
    try {
      execSync(`git clone "${repoSource}" "${repoDir}"`, { stdio: 'inherit' });
      log.success(`✅ Cloned ${repoName}`);
    } catch (error) {
      log.error(`Failed to clone repository`);
      return;
    }
  } else if (repoSource === 'new') {
    // Create new repository
    log.info(`Creating new repository ${repoName}...`);
    fs.mkdirSync(repoDir, { recursive: true });
    execSync('git init', { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, 'README.md'), `# ${repoName}\n\nCreated by Proletariat HQ\n`);
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -m "Initial commit"', { cwd: repoDir });
    log.success(`✅ Created ${repoName}`);
  } else {
    // Add existing repository
    const remote = getGitRemote(repoSource);
    
    if (remote) {
      // Has remote, can clone
      log.info(`Cloning from ${remote}...`);
      try {
        execSync(`git clone "${remote}" "${repoDir}"`, { stdio: 'inherit' });
        log.success(`✅ Cloned ${repoName} from existing remote`);
      } catch (error) {
        log.error(`Failed to clone repository`);
        return;
      }
    } else {
      // No remote, need to copy or link
      const { addMethod } = await inquirer.prompt([
        {
          type: 'list',
          name: 'addMethod',
          message: `Repository has no remote. How should we add it?`,
          choices: [
            { name: 'Copy repository to HQ', value: 'copy' },
            { name: 'Create symbolic link (advanced)', value: 'link' },
            { name: 'Skip for now', value: 'skip' }
          ]
        }
      ]);
      
      if (addMethod === 'copy') {
        log.info(`Copying repository...`);
        execSync(`cp -r "${repoSource}" "${repoDir}"`);
        log.success(`✅ Copied ${repoName}`);
      } else if (addMethod === 'link') {
        log.info(`Creating symbolic link...`);
        fs.symlinkSync(repoSource, repoDir, 'dir');
        log.success(`✅ Linked ${repoName}`);
      } else {
        log.info('Skipped adding repository');
        return;
      }
    }
  }
  
  // Step 4: Update config
  config.repos.push(repoName);
  saveHQConfig(hqRoot, config);
  
  // Step 5: Create worktrees for agents
  if (config.agents.length > 0) {
    let agentsToAdd: string[] = [];
    
    if (config.agentRepoMode === 'all') {
      agentsToAdd = config.agents;
    } else if (config.agentRepoMode === 'ask') {
      const { selectedAgents } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedAgents',
          message: `Which agents should have access to ${repoName}?`,
          choices: config.agents,
          default: config.agents
        }
      ]);
      agentsToAdd = selectedAgents;
    }
    // Manual mode: don't add any automatically
    
    if (agentsToAdd.length > 0) {
      log.info(`Creating worktrees for ${agentsToAdd.length} agent(s)...`);
      
      const { getAllThemes } = await import('../themes/index.js');
      const themes = getAllThemes();
      const theme = themes[config.theme];
      
      if (theme) {
        const agentsDir = path.join(hqRoot, '.proletariat', 'agents', theme.directory);
        
        for (const agent of agentsToAdd) {
          const agentDir = path.join(agentsDir, agent);
          const worktreePath = path.join(agentDir, repoName);
          
          if (fs.existsSync(agentDir) && !fs.existsSync(worktreePath)) {
            try {
              const branchName = `${agent}-workspace`;
              execSync(`git worktree add -b "${branchName}" "${worktreePath}" main`, {
                cwd: repoDir,
                stdio: 'ignore'
              });
              log.success(`  ✓ Created worktree for ${agent}`);
              
              // Update agent access
              if (!config.agentAccess) {
                config.agentAccess = {};
              }
              if (!config.agentAccess[agent]) {
                config.agentAccess[agent] = [];
              }
              config.agentAccess[agent].push(repoName);
            } catch (error) {
              // Try with master branch if main doesn't exist
              try {
                const branchName = `${agent}-workspace`;
                execSync(`git worktree add -b "${branchName}" "${worktreePath}" master`, {
                  cwd: repoDir,
                  stdio: 'ignore'
                });
                log.success(`  ✓ Created worktree for ${agent}`);
                
                if (!config.agentAccess) {
                  config.agentAccess = {};
                }
                if (!config.agentAccess[agent]) {
                  config.agentAccess[agent] = [];
                }
                config.agentAccess[agent].push(repoName);
              } catch {
                log.warning(`  ✗ Could not create worktree for ${agent}`);
              }
            }
          }
        }
        
        // Save updated agent access
        saveHQConfig(hqRoot, config);
      }
    }
  }
  
  log.success(`\n✅ Added ${repoName} to ${config.name} HQ!`);
  
  if (config.agents.length === 0) {
    log.info(`💡 No agents hired yet. Run 'prlt hire' to create agents.`);
  }
}