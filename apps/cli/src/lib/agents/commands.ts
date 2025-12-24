/**
 * Shared utilities for agent commands - implementing DRY principles
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  getWorkspaceConfig,
  getWorkspaceAgents,
  getWorkspaceRepositories,
  addAgentsToDatabase,
  removeAgentsFromDatabase,
  Agent,
  Repository
} from '../database/index.js';
import { THEMES } from '../themes.js';
import { getPMOContext } from '../pmo/index.js';

export interface AgentStatus {
  name: string;
  exists: boolean;
  branch?: string;
  lastActivity?: Date;
  assignedTickets: string[];
  completedTickets: string[];
  repositories: { name: string; status: string; commitsAhead: number }[];
}

export interface WorkspaceInfo {
  path: string;
  type: 'hq' | 'workspace';
  theme: string;
  workspaceName: string;
  hasPMO: boolean;
  agents: Agent[];
  repositories: Repository[];
  agentsPath: string;
}

/**
 * Find workspace root and return workspace information.
 *
 * Search priority:
 * 1. PRLT_HQ_PATH environment variable (used in devcontainers where HQ is mounted at /hq)
 * 2. Current directory tree for HQ with workspace.db
 */
export function getWorkspaceInfo(): WorkspaceInfo {
  // Check PRLT_HQ_PATH environment variable first (used in devcontainers)
  const hqPath = process.env.PRLT_HQ_PATH;
  if (hqPath) {
    const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
    if (fs.existsSync(dbPath)) {
      try {
        const config = getWorkspaceConfig(hqPath);
        if (config) {
          const agents = getWorkspaceAgents(hqPath);
          const repositories = getWorkspaceRepositories(hqPath);
          const themeConfig = THEMES[config.theme];

          const agentsPath = config.type === 'hq'
            ? path.join(hqPath, 'agents', themeConfig.workspaceDir)
            : hqPath;

          return {
            path: hqPath,
            type: config.type,
            theme: config.theme,
            workspaceName: config.workspace_name,
            hasPMO: config.has_pmo,
            agents,
            repositories,
            agentsPath
          };
        }
      } catch {
        // Continue to directory tree search if PRLT_HQ_PATH is invalid
      }
    }
  }

  // Search up the directory tree
  let currentDir = process.cwd();

  while (currentDir !== '/') {
    const dbPath = path.join(currentDir, '.proletariat', 'workspace.db');
    if (fs.existsSync(dbPath)) {
      try {
        const config = getWorkspaceConfig(currentDir);
        if (config) {
          const agents = getWorkspaceAgents(currentDir);
          const repositories = getWorkspaceRepositories(currentDir);
          const themeConfig = THEMES[config.theme];

          const agentsPath = config.type === 'hq'
            ? path.join(currentDir, 'agents', themeConfig.workspaceDir)
            : currentDir;

          return {
            path: currentDir,
            type: config.type,
            theme: config.theme,
            workspaceName: config.workspace_name,
            hasPMO: config.has_pmo,
            agents,
            repositories,
            agentsPath
          };
        }
      } catch {
        // Continue searching if database is corrupted
      }
    }
    currentDir = path.dirname(currentDir);
  }

  throw new Error('Not in an HQ or workspace directory. Run "prlt init" first.');
}

/**
 * Get available agents from theme (not yet added to workspace)
 */
export function getAvailableAgents(workspaceInfo: WorkspaceInfo): string[] {
  const themeConfig = THEMES[workspaceInfo.theme];
  const existingAgentNames = workspaceInfo.agents.map(a => a.name);
  return themeConfig.agents.filter(name => !existingAgentNames.includes(name));
}

/**
 * Interactive agent selection from available agents
 */
export async function selectAgentsInteractively(workspaceInfo: WorkspaceInfo, message: string = 'Select agents:'): Promise<string[]> {
  const availableAgents = getAvailableAgents(workspaceInfo);
  
  if (availableAgents.length === 0) {
    throw new Error('No available agents to add. All agents from this theme are already in the workspace.');
  }

  const { selected } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selected',
    message,
    choices: availableAgents.map(name => ({ name, value: name })),
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
 * Interactive selection from existing agents
 */
export async function selectExistingAgentsInteractively(workspaceInfo: WorkspaceInfo, message: string = 'Select agents:'): Promise<string[]> {
  if (workspaceInfo.agents.length === 0) {
    throw new Error('No agents found in workspace.');
  }

  const { selected } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selected',
    message,
    choices: workspaceInfo.agents.map(agent => ({ name: agent.name, value: agent.name })),
    validate: (input) => input.length > 0 || 'Please select at least one agent'
  }]);

  return selected;
}

/**
 * Get detailed status for a specific agent
 */
export function getAgentStatus(workspaceInfo: WorkspaceInfo, agentName: string): AgentStatus {
  const agentDir = path.join(workspaceInfo.agentsPath, agentName);
  const dirExists = fs.existsSync(agentDir);
  
  // Check if agent has valid worktrees, not just if directory exists
  let hasValidWorktrees = false;
  if (dirExists && workspaceInfo.repositories.length > 0) {
    // Check if all expected repository worktrees exist and are valid git directories
    hasValidWorktrees = workspaceInfo.repositories.every(repo => {
      const repoWorktreePath = path.join(agentDir, repo.name);
      const gitFile = path.join(repoWorktreePath, '.git');
      return fs.existsSync(repoWorktreePath) && fs.existsSync(gitFile);
    });
  } else if (dirExists && workspaceInfo.repositories.length === 0) {
    // For HQ mode with no repos, just having the directory is sufficient
    hasValidWorktrees = true;
  }
  
  const exists = dirExists && hasValidWorktrees;
  
  const status: AgentStatus = {
    name: agentName,
    exists,
    assignedTickets: [],
    completedTickets: [],
    repositories: []
  };

  if (!dirExists) {
    return status;
  }

  // Get git branch info
  try {
    const gitDir = path.join(agentDir, '.git');
    if (fs.existsSync(gitDir)) {
      const gitContent = fs.readFileSync(gitDir, 'utf-8');
      const branchMatch = gitContent.match(/gitdir: (.+)/);
      if (branchMatch) {
        status.branch = branchMatch[1].split('/').pop()?.replace('.git', '');
      }
    }
  } catch {
    // Ignore git reading errors
  }

  // Get repository status
  status.repositories = workspaceInfo.repositories.map(repo => {
    const repoPath = path.join(agentDir, repo.name);
    const repoExists = fs.existsSync(repoPath);
    
    let repoStatus = 'missing';
    let commitsAhead = 0;
    
    if (repoExists) {
      try {
        // Check if clean
        const gitStatus = execSync('git status --porcelain', { 
          cwd: repoPath, 
          encoding: 'utf-8',
          stdio: 'pipe'
        });
        repoStatus = gitStatus.trim() === '' ? 'clean' : 'dirty';
        
        // Check commits ahead
        try {
          const ahead = execSync('git rev-list --count HEAD ^origin/main', { 
            cwd: repoPath, 
            encoding: 'utf-8',
            stdio: 'pipe'
          }).trim();
          commitsAhead = parseInt(ahead) || 0;
        } catch {
          // Ignore if can't determine commits ahead
        }
      } catch {
        repoStatus = 'error';
      }
    }
    
    return {
      name: repo.name,
      status: repoStatus,
      commitsAhead
    };
  });

  // Get last activity from database
  const agentRecord = workspaceInfo.agents.find(a => a.name === agentName);
  if (agentRecord?.last_activity) {
    status.lastActivity = new Date(agentRecord.last_activity);
  }

  // Get ticket assignments (if PMO enabled)
  if (workspaceInfo.hasPMO) {
    try {
      const ticketsFile = path.join(workspaceInfo.path, 'pmo', 'tickets.json');
      if (fs.existsSync(ticketsFile)) {
        const tickets = JSON.parse(fs.readFileSync(ticketsFile, 'utf-8'));
        status.assignedTickets = tickets
          .filter((t: any) => t.assignee === agentName && t.status !== 'done')
          .map((t: any) => t.id);
        status.completedTickets = tickets
          .filter((t: any) => t.assignee === agentName && t.status === 'done')
          .map((t: any) => t.id);
      }
    } catch {
      // Ignore ticket loading errors
    }
  }

  return status;
}

/**
 * Get status for all agents
 */
export function getAllAgentsStatus(workspaceInfo: WorkspaceInfo): AgentStatus[] {
  return workspaceInfo.agents.map(agent => getAgentStatus(workspaceInfo, agent.name));
}

/**
 * Format time ago string
 */
export function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffHours < 1) {
    return '< 1 hour ago';
  } else if (diffHours < 24) {
    return `${diffHours} hours ago`;
  } else {
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day(s) ago`;
  }
}

/**
 * Validate agent names against theme
 */
export function validateAgentNames(workspaceInfo: WorkspaceInfo, agentNames: string[]): { valid: string[]; invalid: string[] } {
  const themeConfig = THEMES[workspaceInfo.theme];
  const valid: string[] = [];
  const invalid: string[] = [];
  
  for (const name of agentNames) {
    if (themeConfig.agents.includes(name)) {
      valid.push(name);
    } else {
      invalid.push(name);
    }
  }
  
  return { valid, invalid };
}

export interface AddAgentOptions {
  skipDevcontainer?: boolean;  // Skip devcontainer creation (default: false)
}

/**
 * Create agent worktrees and update database
 */
export async function addAgentsToWorkspace(workspaceInfo: WorkspaceInfo, agentNames: string[], options?: AddAgentOptions): Promise<string[]> {
  // Import dynamically to avoid circular dependency
  const { createAgentWorktrees } = await import('./index.js');

  // Filter out existing agents
  const existingNames = workspaceInfo.agents.map(a => a.name);
  const newAgents = agentNames.filter(name => !existingNames.includes(name));

  if (newAgents.length === 0) {
    return [];
  }

  // Create worktrees
  if (workspaceInfo.type === 'hq') {
    await createAgentWorktrees(workspaceInfo.agentsPath, newAgents, workspaceInfo.path, options);
  } else {
    await createAgentWorktrees(workspaceInfo.agentsPath, newAgents, undefined, options);
  }

  // Add to database
  addAgentsToDatabase(workspaceInfo.path, newAgents, workspaceInfo.theme);

  return newAgents;
}

/**
 * Remove agents and clean up worktrees
 */
export async function removeAgentsFromWorkspace(workspaceInfo: WorkspaceInfo, agentNames: string[]): Promise<{ removed: string[]; failed: string[] }> {
  const removed: string[] = [];
  const failed: string[] = [];

  for (const agentName of agentNames) {
    try {
      const agentDir = path.join(workspaceInfo.agentsPath, agentName);
      
      if (fs.existsSync(agentDir)) {
        // Remove worktrees for each repository
        for (const repo of workspaceInfo.repositories) {
          const repoWorktreePath = path.join(agentDir, repo.name);
          const sourceRepoPath = workspaceInfo.type === 'hq'
            ? path.join(workspaceInfo.path, 'repos', repo.name)
            : process.cwd(); // For workspace-only, source is current directory
          
          if (fs.existsSync(repoWorktreePath)) {
            try {
              execSync(`git worktree remove ${path.relative(sourceRepoPath, repoWorktreePath)} --force`, {
                cwd: sourceRepoPath,
                stdio: 'pipe'
              });
            } catch {
              // If git worktree remove fails, remove directory manually
              fs.rmSync(repoWorktreePath, { recursive: true, force: true });
            }
          }
        }
        
        // Remove agent directory
        if (fs.existsSync(agentDir)) {
          fs.rmSync(agentDir, { recursive: true, force: true });
        }
        
        // Clean up git worktree list
        for (const repo of workspaceInfo.repositories) {
          const sourceRepoPath = workspaceInfo.type === 'hq'
            ? path.join(workspaceInfo.path, 'repos', repo.name)
            : process.cwd();
          
          try {
            execSync('git worktree prune', {
              cwd: sourceRepoPath,
              stdio: 'pipe'
            });
          } catch {
            // Ignore prune errors
          }
        }
      }
      
      removed.push(agentName);
    } catch (error) {
      failed.push(agentName);
    }
  }

  // Remove from database
  if (removed.length > 0) {
    removeAgentsFromDatabase(workspaceInfo.path, removed);

    // Clear ticket assignees for removed agents
    try {
      const { storage } = await getPMOContext(undefined, () => {}, false);
      const allTickets = await storage.listTickets();
      for (const ticket of allTickets) {
        if (ticket.assignee && removed.includes(ticket.assignee)) {
          // Pass null to clear the assignee in the database
          await storage.updateTicket(ticket.id, { assignee: null as unknown as string });
        }
      }
      await storage.close();
    } catch {
      // PMO might not exist, ignore errors
    }
  }

  return { removed, failed };
}