import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { DEFAULT_AGENTS_DIR, isValidAgentName, getSuggestedAgentNames, normalizeAgentName, BUILTIN_THEMES } from '../themes.js';
import { getWorkspaceRepositories } from '../database/index.js';
import { styles } from '../styles.js';
import { createDevcontainerConfig } from '../execution/devcontainer.js';

export interface HQConfig {
  type: 'hq';
  created: string;
  workspaceName: string;
  hasPMO: boolean;
  agents: string[];
  repos: string[];
}

/**
 * Detect the current agent name from environment or directory structure.
 * Returns null if not running in an agent context.
 */
export function detectAgentName(): string | null {
  // Check environment variable first (set in devcontainer)
  if (process.env.PRLT_AGENT_NAME) {
    return process.env.PRLT_AGENT_NAME;
  }

  // Try to detect from directory structure
  const cwd = process.cwd();

  // Devcontainer pattern: /workspace/proletariat-{agent}
  const workspaceMatch = cwd.match(/\/workspace\/[^/]+-(\w+)/);
  if (workspaceMatch) {
    return workspaceMatch[1];
  }

  // Host pattern: agents/staff/{agent}
  const staffMatch = cwd.match(/agents\/staff\/(\w+)/);
  if (staffMatch) {
    return staffMatch[1];
  }

  // Try git branch pattern: agent-{name}
  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const agentBranchMatch = branch.match(/^agent-(\w+)$/);
    if (agentBranchMatch) {
      return agentBranchMatch[1];
    }
  } catch {
    // Ignore git errors
  }

  return null;
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
      } catch {
        // Ignore database errors and continue searching
      }
    }
    currentDir = path.dirname(currentDir);
  }
  
  return null;
}

/**
 * Prompt user to enter agent names
 */
export async function promptAgentNames(existingAgents: string[] = []): Promise<string[]> {
  const suggestions = getSuggestedAgentNames().filter(n => !existingAgents.includes(n));

  const { agentNames } = await inquirer.prompt([{
    type: 'input',
    name: 'agentNames',
    message: `Enter agent names (space-separated, e.g., "${suggestions.slice(0, 2).join(' ')}"):`,
    validate: (input: string) => {
      if (!input.trim()) {
        return 'Please enter at least one agent name';
      }
      const names = input.trim().split(/\s+/);
      const invalid = names.filter(n => !isValidAgentName(n));
      if (invalid.length > 0) {
        return `Invalid agent names: ${invalid.join(', ')}. Names must be lowercase alphanumeric with optional hyphens/underscores.`;
      }
      const duplicates = names.filter(n => existingAgents.includes(n));
      if (duplicates.length > 0) {
        return `These agents already exist: ${duplicates.join(', ')}`;
      }
      return true;
    },
  }]);

  return agentNames.trim().split(/\s+/).filter(Boolean);
}

export interface CreateAgentOptions {
  skipDevcontainer?: boolean;  // Skip devcontainer creation (default: false)
}

/**
 * Create agent worktrees (shared between HQ and workspace-only modes)
 */
export async function createAgentWorktrees(workspacePath: string, agents: string[], hqPath?: string, options?: CreateAgentOptions): Promise<void> {
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
            // Name worktree directory as {repoName}-{agentName} so git creates unique worktree entries
            // e.g., proletariat-altman instead of just proletariat (which causes proletariat1, proletariat2, etc.)
            const worktreeDirName = `${repo.name}-${agent}`;
            const worktreeDir = path.join(agentDir, worktreeDirName);
            
            if (fs.existsSync(sourceRepo)) {
              console.log(styles.muted(`  Creating worktree for ${repo.name}...`));

              // Fetch latest from origin to ensure we have up-to-date main
              try {
                execSync(`git fetch origin main`, {
                  cwd: sourceRepo,
                  stdio: 'pipe'
                });
              } catch {
                // Ignore fetch errors (might be offline)
                console.log(chalk.yellow(`  Warning: Could not fetch origin/main, using local state`));
              }

              // Create git worktree for the agent from origin/main
              const branchName = `agent-${agent}`;
              try {
                execSync(`git worktree add ${worktreeDir} -b ${branchName} origin/main`, {
                  cwd: sourceRepo,
                  stdio: 'inherit'
                });
              } catch {
                // Branch might already exist, try to use it or clean up
                console.log(chalk.yellow(`  Branch ${branchName} already exists, attempting to reuse or clean up...`));
                try {
                  // Try without creating a new branch (use existing)
                  execSync(`git worktree add ${worktreeDir} ${branchName}`, {
                    cwd: sourceRepo,
                    stdio: 'inherit'
                  });
                } catch {
                  // If that fails too, clean up the orphaned branch and try again
                  try {
                    execSync(`git branch -D ${branchName}`, {
                      cwd: sourceRepo,
                      stdio: 'pipe'
                    });
                    execSync(`git worktree add ${worktreeDir} -b ${branchName} origin/main`, {
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

          // Create devcontainer config for sandboxed execution
          // Note: Agent metadata is stored in SQLite (agents table), not in config files
          if (!options?.skipDevcontainer) {
            console.log(styles.muted(`  Creating devcontainer config...`));
            createDevcontainerConfig({
              agentName: agent,
              agentDir,
              repoWorktrees: repos.map(r => r.name),
            });
          }

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
      // Name worktree directory as {repoName}-{agentName} for unique git worktree entries
      const worktreeDirName = `${repoName}-${agent}`;
      const worktreeDir = path.join(agentDir, worktreeDirName);
      
      console.log(chalk.blue(`Creating agent: ${agent}...`));

      try {
        // Create agent directory
        fs.mkdirSync(agentDir, { recursive: true });

        // Fetch latest from origin to ensure we have up-to-date main
        try {
          execSync(`git fetch origin main`, {
            cwd: sourceRepo,
            stdio: 'pipe'
          });
        } catch {
          // Ignore fetch errors (might be offline)
          console.log(chalk.yellow(`  Warning: Could not fetch origin/main, using local state`));
        }

        // Create git worktree for the agent from origin/main
        const branchName = `agent-${agent}`;
        try {
          execSync(`git worktree add ${worktreeDir} -b ${branchName} origin/main`, {
            cwd: sourceRepo,
            stdio: 'inherit'
          });
        } catch {
          // Branch might already exist, try to use it or clean up
          console.log(chalk.yellow(`  Branch ${branchName} already exists, attempting to reuse or clean up...`));
          try {
            // Try without creating a new branch (use existing)
            execSync(`git worktree add ${worktreeDir} ${branchName}`, {
              cwd: sourceRepo,
              stdio: 'inherit'
            });
          } catch {
            // If that fails too, clean up the orphaned branch and try again
            try {
              execSync(`git branch -D ${branchName}`, {
                cwd: sourceRepo,
                stdio: 'pipe'
              });
              execSync(`git worktree add ${worktreeDir} -b ${branchName} origin/main`, {
                cwd: sourceRepo,
                stdio: 'inherit'
              });
            } catch (finalError) {
              throw new Error(`Failed to create worktree after cleanup: ${finalError}`);
            }
          }
        }

        // Create devcontainer config for sandboxed execution
        // Note: Agent metadata is stored in SQLite (agents table), not in config files
        if (!options?.skipDevcontainer) {
          console.log(styles.muted(`  Creating devcontainer config...`));
          createDevcontainerConfig({
            agentName: agent,
            agentDir,
            repoWorktrees: [repoName],
          });
        }

        console.log(chalk.green(`✅ Agent ${agent} created with worktree`));
      } catch (error) {
        console.log(chalk.red(`Failed to create agent ${agent}: ${error}`));
      }
    }
  }
}

/**
 * Result from agent prompt including optional theme info
 */
export interface AgentPromptResult {
  agents: string[];
  themeId?: string;  // Selected theme ID (builtin or custom)
  customTheme?: {
    name: string;
    displayName: string;
    names: string[];
  };
}

/**
 * Prompt user for agent selection with theme options
 */
export async function promptForAgents(): Promise<string[]> {
  const result = await promptForAgentsWithTheme();
  return result.agents;
}

/**
 * Prompt user for agent selection with theme options (returns full result)
 */
export async function promptForAgentsWithTheme(): Promise<AgentPromptResult> {
  const { addAgents } = await inquirer.prompt([{
    type: 'list',
    name: 'addAgents',
    message: 'Add agents now?',
    choices: [
      { name: 'Yes, pick from a theme', value: 'theme' },
      { name: 'Yes, enter custom names', value: 'custom' },
      { name: 'Yes, create a custom theme', value: 'create-theme' },
      { name: 'No, I\'ll add agents later', value: 'no' }
    ],
    default: 'theme',
  }]);

  if (addAgents === 'no') {
    return { agents: [] };
  }

  if (addAgents === 'custom') {
    const agents = await promptAgentNames([]);
    return { agents };
  }

  if (addAgents === 'create-theme') {
    // Create a custom theme
    const { themeName } = await inquirer.prompt([{
      type: 'input',
      name: 'themeName',
      message: 'Theme name (e.g., "Greek Gods", "Star Wars"):',
      validate: (input: string) => input.trim() ? true : 'Theme name is required'
    }]);

    // Normalize theme ID
    const themeId = themeName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const displayName = themeName.trim();

    if (themeName.trim() !== themeId) {
      console.log(chalk.blue(`Theme ID: ${themeId}`));
    }

    // Prompt for names to add to the theme
    const { themeNames } = await inquirer.prompt([{
      type: 'input',
      name: 'themeNames',
      message: 'Enter names for this theme (space-separated):',
      validate: (input: string) => {
        if (!input.trim()) return 'Please enter at least one name';
        return true;
      }
    }]);

    // Normalize names
    const rawNames = themeNames.trim().split(/\s+/);
    const normalizedNames = rawNames.map((n: string) => normalizeAgentName(n)).filter((n: string) => n && isValidAgentName(n));

    if (normalizedNames.length === 0) {
      console.log(chalk.yellow('No valid names after normalization.'));
      return { agents: [] };
    }

    // Show normalized names
    const changed = rawNames.filter((n: string, i: number) => n !== normalizedNames[i]);
    if (changed.length > 0) {
      console.log(chalk.blue('Normalized names:'));
      rawNames.forEach((n: string, i: number) => {
        if (n !== normalizedNames[i] && normalizedNames[i]) {
          console.log(chalk.dim(`   ${n} → ${normalizedNames[i]}`));
        }
      });
    }

    // Now select which agents to create from the theme
    const { selected } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selected',
      message: 'Select agents to create now:',
      choices: normalizedNames.map((name: string) => ({ name, value: name, checked: true })),
      validate: (input) => input.length > 0 || 'Please select at least one agent'
    }]);

    return {
      agents: selected,
      themeId: themeId,  // Custom theme ID
      customTheme: {
        name: themeId,
        displayName,
        names: normalizedNames
      }
    };
  }

  // Theme selection mode
  // Build theme choices
  const themeChoices = BUILTIN_THEMES.map(t => ({
    name: `${t.displayName} (${t.names.length} names)`,
    value: t.id
  }));

  const { selectedTheme } = await inquirer.prompt([{
    type: 'list',
    name: 'selectedTheme',
    message: 'Select a theme:',
    choices: themeChoices
  }]);

  // Get the theme
  const theme = BUILTIN_THEMES.find(t => t.id === selectedTheme);
  if (!theme) {
    return { agents: [] };
  }

  // Select names from the theme
  const { selected } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selected',
    message: `Select agents from ${theme.displayName}:`,
    choices: theme.names.map(name => ({ name, value: name })),
    pageSize: 15,
    validate: (input) => input.length > 0 || 'Please select at least one agent'
  }]);

  return { agents: selected, themeId: selectedTheme };
}

/**
 * Add agents to HQ (used by both init and agent add commands)
 */
export async function addAgentsToHQ(
  hqPath: string,
  agents: string[]
): Promise<void> {
  // Import database functions for getting/adding agents
  const { getWorkspaceAgents, addAgentsToDatabase } = await import('../database/index.js');

  // Get existing agents from database
  const existingAgents = getWorkspaceAgents(hqPath);
  const existingAgentNames = new Set(existingAgents.map(a => a.name));

  // Filter out already existing agents
  const newAgents = agents.filter(name => {
    if (existingAgentNames.has(name)) {
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
  const workspacePath = path.join(hqPath, 'agents', DEFAULT_AGENTS_DIR);
  await createAgentWorktrees(workspacePath, newAgents, hqPath);

  // Add agents to database
  addAgentsToDatabase(hqPath, newAgents);

  console.log(chalk.green(`\n🎉 Added ${newAgents.length} agent(s) successfully!`));
}