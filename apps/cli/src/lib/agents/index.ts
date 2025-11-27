import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { THEMES } from '../themes.js';
import { getWorkspaceRepositories } from '../database/index.js';
import { styles } from '../styles.js';

export interface HQConfig {
  type: 'hq';
  created: string;
  theme: string;
  workspaceName: string;
  hasPMO: boolean;
  agents: string[];
  repos: string[];
}

/**
 * Find the HQ root directory by looking for .proletariat/workspace.db
 */
export function findHQRoot(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;
  
  while (currentDir !== '/') {
    const dbPath = path.join(currentDir, '.proletariat', 'workspace.db');
    if (fs.existsSync(dbPath)) {
      // Check if it's an HQ workspace by querying the database
      try {
        const { getWorkspaceConfig } = require('../database/index.js');
        const config = getWorkspaceConfig(currentDir);
        if (config && config.type === 'hq') {
          return currentDir;
        }
      } catch (error) {
        // Ignore database errors and continue searching
      }
    }
    currentDir = path.dirname(currentDir);
  }
  
  return null;
}

/**
 * Prompt user to select agents from theme
 */
export async function selectAgentsFromTheme(theme: string, existingAgents: string[] = []): Promise<string[]> {
  const themeConfig = THEMES[theme];
  if (!themeConfig) {
    throw new Error(`Unknown theme: ${theme}`);
  }

  // Filter out already existing agents
  const availableAgents = themeConfig.agents.filter(a => !existingAgents.includes(a));
  
  if (availableAgents.length === 0) {
    console.log(chalk.yellow('All agents from this theme are already added.'));
    return [];
  }

  const { selected } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selected',
    message: 'Select agents (SPACE to select, ENTER when done):',
    choices: availableAgents.map(a => ({ name: a, value: a })),
    validate: (choices) => {
      if (choices.length === 0) {
        return 'No agents selected. Press SPACE to select agents, or ENTER to continue with none.';
      }
      return true;
    },
  }]);

  return selected;
}

/**
 * Create agent worktrees (shared between HQ and workspace-only modes)
 */
export async function createAgentWorktrees(workspacePath: string, agents: string[], hqPath?: string): Promise<void> {
  if (hqPath) {
    // HQ mode - create worktrees for all repos in repos/ directory
    const reposDir = path.join(hqPath, 'repos');
    
    // Get repositories from database instead of JSON config
    const repos = getWorkspaceRepositories(hqPath);
    
    if (repos.length > 0) {
      // Create worktrees for each agent across all repositories
      for (const agent of agents) {
        const agentDir = path.join(workspacePath, agent);
        console.log(chalk.blue(`Creating agent: ${agent}...`));
        
        try {
          // Create agent directory
          fs.mkdirSync(agentDir, { recursive: true });

          // Create worktrees for all repositories
          for (const repo of repos) {
            const sourceRepo = path.join(reposDir, repo.name);
            const worktreeDir = path.join(agentDir, repo.name);
            
            if (fs.existsSync(sourceRepo)) {
              console.log(styles.muted(`  Creating worktree for ${repo.name}...`));
              
              // Create git worktree for the agent
              const branchName = `agent-${agent}`;
              try {
                execSync(`git worktree add ${worktreeDir} -b ${branchName}`, {
                  cwd: sourceRepo,
                  stdio: 'inherit'
                });
              } catch (error) {
                // Branch might already exist, try to use it or clean up
                console.log(chalk.yellow(`  Branch ${branchName} already exists, attempting to reuse or clean up...`));
                try {
                  // Try without creating a new branch (use existing)
                  execSync(`git worktree add ${worktreeDir} ${branchName}`, {
                    cwd: sourceRepo,
                    stdio: 'inherit'
                  });
                } catch (secondError) {
                  // If that fails too, clean up the orphaned branch and try again
                  try {
                    execSync(`git branch -D ${branchName}`, {
                      cwd: sourceRepo,
                      stdio: 'pipe'
                    });
                    execSync(`git worktree add ${worktreeDir} -b ${branchName}`, {
                      cwd: sourceRepo,
                      stdio: 'inherit'
                    });
                  } catch (finalError) {
                    throw new Error(`Failed to create worktree after cleanup: ${finalError}`);
                  }
                }
              }
            }
          }

          // Create agent config in the agent directory
          const agentConfigDir = path.join(agentDir, '.proletariat');
          fs.mkdirSync(agentConfigDir, { recursive: true });
          
          const agentConfig = {
            type: 'agent',
            agentName: agent,
            created: new Date().toISOString(),
            workspacePath: path.relative(agentDir, hqPath),
            repos: repos.map(r => r.name),
            branch: `agent-${agent}`
          };
          
          fs.writeFileSync(
            path.join(agentConfigDir, 'config.json'),
            JSON.stringify(agentConfig, null, 2)
          );

          console.log(chalk.green(`✅ Agent ${agent} created with ${repos.length} worktree(s)`));
        } catch (error) {
          console.log(chalk.red(`Failed to create agent ${agent}: ${error}`));
        }
      }
    } else {
      console.log(chalk.yellow('No repositories found in HQ. Creating placeholder agent directories.'));
      // Create placeholder directories for now
      for (const agent of agents) {
        const agentDir = path.join(workspacePath, agent);
        fs.mkdirSync(agentDir, { recursive: true });
        console.log(chalk.green(`✅ Placeholder agent ${agent} created`));
      }
    }
  } else {
    // Workspace-only mode - use current repo
    const sourceRepo = process.cwd();
    const repoName = path.basename(sourceRepo);

    for (const agent of agents) {
      const agentDir = path.join(workspacePath, agent);
      const worktreeDir = path.join(agentDir, repoName);
      
      console.log(chalk.blue(`Creating agent: ${agent}...`));
      
      try {
        // Create agent directory
        fs.mkdirSync(agentDir, { recursive: true });
        
        // Create git worktree for the agent
        const branchName = `agent-${agent}`;
        try {
          execSync(`git worktree add ${worktreeDir} -b ${branchName}`, {
            cwd: sourceRepo,
            stdio: 'inherit'
          });
        } catch (error) {
          // Branch might already exist, try to use it or clean up
          console.log(chalk.yellow(`  Branch ${branchName} already exists, attempting to reuse or clean up...`));
          try {
            // Try without creating a new branch (use existing)
            execSync(`git worktree add ${worktreeDir} ${branchName}`, {
              cwd: sourceRepo,
              stdio: 'inherit'
            });
          } catch (secondError) {
            // If that fails too, clean up the orphaned branch and try again
            try {
              execSync(`git branch -D ${branchName}`, {
                cwd: sourceRepo,
                stdio: 'pipe'
              });
              execSync(`git worktree add ${worktreeDir} -b ${branchName}`, {
                cwd: sourceRepo,
                stdio: 'inherit'
              });
            } catch (finalError) {
              throw new Error(`Failed to create worktree after cleanup: ${finalError}`);
            }
          }
        }

        // Create agent config in the agent directory (not the worktree)
        const agentConfigDir = path.join(agentDir, '.proletariat');
        fs.mkdirSync(agentConfigDir, { recursive: true });
        
        const agentConfig = {
          type: 'agent',
          agentName: agent,
          created: new Date().toISOString(),
          workspacePath: path.relative(agentDir, workspacePath),
          sourceRepo: path.relative(agentDir, sourceRepo),
          worktreeDir: repoName,
          branch: `agent-${agent}`
        };
        
        fs.writeFileSync(
          path.join(agentConfigDir, 'config.json'),
          JSON.stringify(agentConfig, null, 2)
        );

        console.log(chalk.green(`✅ Agent ${agent} created with worktree`));
      } catch (error) {
        console.log(chalk.red(`Failed to create agent ${agent}: ${error}`));
      }
    }
  }
}

/**
 * Prompt user for agent selection
 */
export async function promptForAgents(theme: string): Promise<string[]> {
  const { addAgents } = await inquirer.prompt([{
    type: 'list',
    name: 'addAgents',
    message: 'Add agents now?',
    choices: [
      { name: 'Yes', value: true },
      { name: 'No', value: false }
    ],
    default: true,
  }]);

  if (!addAgents) {
    return [];
  }

  return await selectAgentsFromTheme(theme, []);
}

/**
 * Add agents to HQ (used by both init and agent add commands)
 */
export async function addAgentsToHQ(
  hqPath: string,
  agents: string[],
  theme: string
): Promise<void> {
  // Import database functions for getting/adding agents
  const { getWorkspaceAgents, addAgentsToDatabase } = await import('../database/index.js');
  
  // Get existing agents from database
  const existingAgents = getWorkspaceAgents(hqPath);
  const existingAgentNames = existingAgents.map(a => a.name);
  
  // Filter out already existing agents
  const newAgents = agents.filter(name => {
    if (existingAgentNames.includes(name)) {
      console.log(chalk.yellow(`Agent ${name} already exists`));
      return false;
    }
    return true;
  });

  if (newAgents.length === 0) {
    console.log(chalk.yellow('No new agents to add.'));
    return;
  }

  // Create worktrees
  const themeConfig = THEMES[theme];
  const workspacePath = path.join(hqPath, 'agents', themeConfig.workspaceDir);
  await createAgentWorktrees(workspacePath, newAgents, hqPath);

  // Add agents to database
  addAgentsToDatabase(hqPath, newAgents, theme);
  
  console.log(chalk.green(`\n🎉 Added ${newAgents.length} agent(s) successfully!`));
}