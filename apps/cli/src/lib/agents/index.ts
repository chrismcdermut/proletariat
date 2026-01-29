import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { isValidAgentName, getSuggestedAgentNames, BUILTIN_THEMES, getThemePersistentDir } from '../themes.js';
import { getWorkspaceRepositories, getActiveTheme } from '../database/index.js';
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
 * @deprecated Use findHQRoot from '../workspace.js' instead for PRLT_HQ_PATH support
 */
export { findHQRoot } from '../workspace.js';

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

export type MountMode = 'worktree' | 'clone';

export interface CreateAgentOptions {
  skipDevcontainer?: boolean;  // Skip devcontainer creation (default: false)
  mountMode?: MountMode;       // 'worktree' = git worktree (shared .git, default), 'clone' = independent clone
}

/**
 * Get the remote URL for a git repository
 */
function getRemoteUrl(repoPath: string): string | null {
  try {
    const url = execSync('git remote get-url origin', { cwd: repoPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Create agent repos (worktree or clone mode)
 * - worktree mode: Uses git worktree add (shared .git, requires parent repo mounts in container)
 * - clone mode: Uses git clone (independent repo, no path translation needed)
 */
export async function createAgentWorktrees(workspacePath: string, agents: string[], hqPath?: string, options?: CreateAgentOptions): Promise<void> {
  const mountMode = options?.mountMode || 'worktree';  // Default to worktree for real-time file sync
  const modeLabel = mountMode === 'worktree' ? 'worktree' : 'clone';

  if (hqPath) {
    // HQ mode - create worktrees/clones for all repos in repos/ directory
    const reposDir = path.join(hqPath, 'repos');

    // Get repositories from database instead of JSON config
    const repos = getWorkspaceRepositories(hqPath);

    if (repos.length > 0) {
      // Create worktrees/clones for each agent across all repositories
      for (const agent of agents) {
        const agentDir = path.join(workspacePath, agent);
        console.log(chalk.blue(`Creating agent: ${agent} (${modeLabel} mode)...`));

        try {
          // Create agent directory
          fs.mkdirSync(agentDir, { recursive: true });

          // Track which repos were successfully created
          const createdRepos: string[] = [];

          // Create repos for all repositories
          for (const repo of repos) {
            const sourceRepo = path.join(reposDir, repo.name);
            // Target directory is just the repo name (the agent name is already in the parent path)
            const targetDir = path.join(agentDir, repo.name);

            if (fs.existsSync(sourceRepo)) {
              // Check if repo is empty (no commits)
              let isEmptyRepo = false;
              try {
                execSync('git rev-parse HEAD', { cwd: sourceRepo, stdio: 'pipe' });
              } catch {
                isEmptyRepo = true;
              }

              if (isEmptyRepo) {
                console.log(chalk.yellow(`  Skipping ${repo.name} (empty repository with no commits)`));
                continue;
              }

              if (mountMode === 'clone') {
                // CLONE MODE: Create independent git clone
                console.log(styles.muted(`  Cloning ${repo.name}...`));

                // Get remote URL from source repo
                const remoteUrl = getRemoteUrl(sourceRepo);
                if (!remoteUrl) {
                  console.log(chalk.yellow(`  Skipping ${repo.name} (no remote URL configured)`));
                  continue;
                }

                try {
                  // Clone the repository
                  execSync(`git clone "${remoteUrl}" "${targetDir}"`, {
                    stdio: 'inherit'
                  });
                  createdRepos.push(repo.name);
                } catch (cloneError) {
                  console.log(chalk.yellow(`  Warning: Clone failed for ${repo.name}: ${cloneError}`));
                }
              } else {
                // WORKTREE MODE: Create git worktree (original behavior)
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

                // Determine the base ref to use (origin/main, main, or HEAD)
                let baseRef = 'origin/main';
                try {
                  execSync(`git rev-parse ${baseRef}`, { cwd: sourceRepo, stdio: 'pipe' });
                } catch {
                  // origin/main doesn't exist, try local main
                  try {
                    execSync('git rev-parse main', { cwd: sourceRepo, stdio: 'pipe' });
                    baseRef = 'main';
                  } catch {
                    // No main branch, use HEAD
                    baseRef = 'HEAD';
                  }
                }

                // Create git worktree for the agent
                const branchName = `agent-${agent}`;
                try {
                  execSync(`git worktree add "${targetDir}" -b ${branchName} ${baseRef}`, {
                    cwd: sourceRepo,
                    stdio: 'inherit'
                  });
                  createdRepos.push(repo.name);
                } catch {
                  // Branch might already exist, try to use it or clean up
                  console.log(chalk.yellow(`  Branch ${branchName} already exists, attempting to reuse or clean up...`));
                  try {
                    // Try without creating a new branch (use existing)
                    execSync(`git worktree add "${targetDir}" ${branchName}`, {
                      cwd: sourceRepo,
                      stdio: 'inherit'
                    });
                    createdRepos.push(repo.name);
                  } catch {
                    // If that fails too, clean up the orphaned branch and try again
                    try {
                      execSync(`git branch -D ${branchName}`, {
                        cwd: sourceRepo,
                        stdio: 'pipe'
                      });
                      execSync(`git worktree add "${targetDir}" -b ${branchName} ${baseRef}`, {
                        cwd: sourceRepo,
                        stdio: 'inherit'
                      });
                      createdRepos.push(repo.name);
                    } catch (finalError) {
                      throw new Error(`Failed to create worktree after cleanup: ${finalError}`);
                    }
                  }
                }
              }
            }
          }

          // Create devcontainer config for sandboxed execution (only for repos that were created)
          // Note: Agent metadata is stored in SQLite (agents table), not in config files
          if (!options?.skipDevcontainer && createdRepos.length > 0) {
            console.log(styles.muted(`  Creating devcontainer config...`));
            createDevcontainerConfig({
              agentName: agent,
              agentDir,
              repoWorktrees: mountMode === 'worktree' ? createdRepos : undefined,  // Only pass repos for worktree mode
              mountMode,
            });
          }

          console.log(chalk.green(`✅ Agent ${agent} created with ${createdRepos.length} ${modeLabel}(s)`));
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
      // Target directory is just the repo name (the agent name is already in the parent path)
      const targetDir = path.join(agentDir, repoName);

      console.log(chalk.blue(`Creating agent: ${agent} (${modeLabel} mode)...`));

      try {
        // Check if repo is empty (no commits)
        let isEmptyRepo = false;
        try {
          execSync('git rev-parse HEAD', { cwd: sourceRepo, stdio: 'pipe' });
        } catch {
          isEmptyRepo = true;
        }

        if (isEmptyRepo) {
          console.log(chalk.yellow(`  Skipping (empty repository with no commits)`));
          continue;
        }

        // Create agent directory
        fs.mkdirSync(agentDir, { recursive: true });

        if (mountMode === 'clone') {
          // CLONE MODE: Create independent git clone
          console.log(styles.muted(`  Cloning ${repoName}...`));

          // Get remote URL from source repo
          const remoteUrl = getRemoteUrl(sourceRepo);
          if (!remoteUrl) {
            console.log(chalk.yellow(`  Skipping ${repoName} (no remote URL configured)`));
            continue;
          }

          // Clone the repository
          execSync(`git clone "${remoteUrl}" "${targetDir}"`, {
            stdio: 'inherit'
          });
        } else {
          // WORKTREE MODE: Create git worktree (original behavior)
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

          // Determine the base ref to use (origin/main, main, or HEAD)
          let baseRef = 'origin/main';
          try {
            execSync(`git rev-parse ${baseRef}`, { cwd: sourceRepo, stdio: 'pipe' });
          } catch {
            // origin/main doesn't exist, try local main
            try {
              execSync('git rev-parse main', { cwd: sourceRepo, stdio: 'pipe' });
              baseRef = 'main';
            } catch {
              // No main branch, use HEAD
              baseRef = 'HEAD';
            }
          }

          // Create git worktree for the agent
          const branchName = `agent-${agent}`;
          try {
            execSync(`git worktree add "${targetDir}" -b ${branchName} ${baseRef}`, {
              cwd: sourceRepo,
              stdio: 'inherit'
            });
          } catch {
            // Branch might already exist, try to use it or clean up
            console.log(chalk.yellow(`  Branch ${branchName} already exists, attempting to reuse or clean up...`));
            try {
              // Try without creating a new branch (use existing)
              execSync(`git worktree add "${targetDir}" ${branchName}`, {
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
                execSync(`git worktree add "${targetDir}" -b ${branchName} ${baseRef}`, {
                  cwd: sourceRepo,
                  stdio: 'inherit'
                });
              } catch (finalError) {
                throw new Error(`Failed to create worktree after cleanup: ${finalError}`);
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
            repoWorktrees: mountMode === 'worktree' ? [repoName] : undefined,  // Only pass repos for worktree mode
            mountMode,
          });
        }

        console.log(chalk.green(`✅ Agent ${agent} created with ${modeLabel}`));
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
 * Simplified flow: pick theme -> auto-create 5 random agents
 */
export async function promptForAgentsWithTheme(): Promise<AgentPromptResult> {
  // Build theme choices with preview of names
  const themeChoices = BUILTIN_THEMES.map(t => ({
    name: `${t.displayName} (${t.names.slice(0, 4).join(', ')}...)`,
    value: t.id
  }));

  const { selectedTheme } = await inquirer.prompt([{
    type: 'list',
    name: 'selectedTheme',
    message: 'Agent naming theme:',
    choices: [
      ...themeChoices,
      new inquirer.Separator(),
      { name: 'Skip (add agents later)', value: 'skip' }
    ]
  }]);

  if (selectedTheme === 'skip') {
    return { agents: [] };
  }

  // Get the theme
  const theme = BUILTIN_THEMES.find(t => t.id === selectedTheme);
  if (!theme) {
    return { agents: [] };
  }

  // Randomly select 10 agents from the theme
  const shuffled = [...theme.names].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 10);

  console.log(chalk.blue(`\nCreating 10 staff agents: ${selected.join(', ')}`));

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

  // Create worktrees (use theme-specific directory)
  const activeTheme = getActiveTheme(hqPath);
  const persistentDir = getThemePersistentDir(activeTheme?.id);
  const workspacePath = path.join(hqPath, 'agents', persistentDir);
  await createAgentWorktrees(workspacePath, newAgents, hqPath);

  // Add agents to database
  addAgentsToDatabase(hqPath, newAgents);

  console.log(chalk.green(`\n🎉 Added ${newAgents.length} agent(s) successfully!`));
}