import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { THEMES } from '../themes.js';

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
 * Find the HQ root directory by looking for .proletariat/config.json
 */
export function findHQRoot(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;
  
  while (currentDir !== '/') {
    const configPath = path.join(currentDir, '.proletariat', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.type === 'hq') {
        return currentDir;
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
    const configPath = path.join(hqPath, '.proletariat', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as HQConfig;
    
    if (config.repos.length > 0) {
      // Create worktrees for each agent across all repositories
      for (const agent of agents) {
        const agentDir = path.join(workspacePath, agent);
        console.log(chalk.blue(`Creating agent: ${agent}...`));
        
        try {
          // Create agent directory
          fs.mkdirSync(agentDir, { recursive: true });

          // Create worktrees for all repositories
          for (const repoName of config.repos) {
            const sourceRepo = path.join(reposDir, repoName);
            const worktreeDir = path.join(agentDir, repoName);
            
            if (fs.existsSync(sourceRepo)) {
              console.log(chalk.gray(`  Creating worktree for ${repoName}...`));
              
              // Create git worktree for the agent
              execSync(`git worktree add ${worktreeDir} -b agent-${agent}`, {
                cwd: sourceRepo,
                stdio: 'inherit'
              });
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
            repos: config.repos,
            branch: `agent-${agent}`
          };
          
          fs.writeFileSync(
            path.join(agentConfigDir, 'config.json'),
            JSON.stringify(agentConfig, null, 2)
          );

          console.log(chalk.green(`✅ Agent ${agent} created with ${config.repos.length} worktree(s)`));
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
        execSync(`git worktree add ${worktreeDir} -b agent-${agent}`, {
          cwd: sourceRepo,
          stdio: 'inherit'
        });

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
  // Update HQ config
  const configPath = path.join(hqPath, '.proletariat', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as HQConfig;
  
  // Filter out already existing agents
  const newAgents = agents.filter(name => {
    if (config.agents.includes(name)) {
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
  await createAgentWorktrees(hqPath, newAgents, theme);

  // Update config with new agents
  config.agents.push(...newAgents);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  console.log(chalk.green(`\n🎉 Added ${newAgents.length} agent(s) successfully!`));
}