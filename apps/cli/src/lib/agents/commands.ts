/**
 * Shared utilities for agent commands - implementing DRY principles
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import inquirer from 'inquirer';
import {
  getWorkspaceConfig,
  getWorkspaceAgents,
  getWorkspaceRepositories,
  getAgentWorktrees,
  addAgentsToDatabase,
  removeAgentsFromDatabase,
  Agent,
  Repository
} from '../database/index.js';
import { DEFAULT_AGENTS_DIR, isValidAgentName, getSuggestedAgentNames } from '../themes.js';
import { getPMOContext } from '../pmo/index.js';

export interface AgentStatus {
  name: string;
  exists: boolean;
  branch?: string;
  assignedTickets: string[];
  completedTickets: string[];
  repositories: { name: string; status: string; commitsAhead: number }[];
}

export interface WorkspaceInfo {
  path: string;
  type: 'hq' | 'workspace';
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

          const agentsPath = config.type === 'hq'
            ? path.join(hqPath, 'agents', DEFAULT_AGENTS_DIR)
            : hqPath;

          return {
            path: hqPath,
            type: config.type,
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

          const agentsPath = config.type === 'hq'
            ? path.join(currentDir, 'agents', DEFAULT_AGENTS_DIR)
            : currentDir;

          return {
            path: currentDir,
            type: config.type,
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
 * Validate agent name
 */
export { isValidAgentName } from '../themes.js';

/**
 * Get suggested agent names (not yet added to workspace)
 */
export function getAvailableAgentSuggestions(workspaceInfo: WorkspaceInfo): string[] {
  const existingAgentNames = new Set(workspaceInfo.agents.map(a => a.name));
  return getSuggestedAgentNames().filter(name => !existingAgentNames.has(name));
}

/**
 * Interactive agent selection - prompts user for agent names
 */
export async function selectAgentsInteractively(workspaceInfo: WorkspaceInfo, message: string = 'Enter agent names:'): Promise<string[]> {
  const suggestions = getAvailableAgentSuggestions(workspaceInfo);

  const { agentNames } = await inquirer.prompt([{
    type: 'input',
    name: 'agentNames',
    message: `${message} (space-separated, e.g., "${suggestions.slice(0, 2).join(' ')}"):`,
    validate: (input: string) => {
      if (!input.trim()) {
        return 'Please enter at least one agent name';
      }
      const names = input.trim().split(/\s+/);
      const invalid = names.filter(n => !isValidAgentName(n));
      if (invalid.length > 0) {
        return `Invalid agent names: ${invalid.join(', ')}. Names must be lowercase alphanumeric with optional hyphens/underscores.`;
      }
      return true;
    },
  }]);

  return agentNames.trim().split(/\s+/).filter(Boolean);
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
  // Agent exists if it's in the database - the source of truth
  const agentRecord = workspaceInfo.agents.find(a => a.name === agentName);
  const exists = !!agentRecord;

  // Get worktrees from database to find actual agent location
  const worktrees = getAgentWorktrees(workspaceInfo.path, agentName);

  // Derive agent directory from worktree path, or fall back to default
  let agentDir = path.join(workspaceInfo.agentsPath, agentName);
  if (worktrees.length > 0) {
    // worktree_path is like "agents/staff/altman/proletariat-altman"
    // Agent dir is the parent: "agents/staff/altman"
    const worktreePath = worktrees[0].worktree_path;
    const agentDirRelative = path.dirname(worktreePath);
    agentDir = path.join(workspaceInfo.path, agentDirRelative);
  }

  const dirExists = fs.existsSync(agentDir);

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

  // Get repository status from database worktrees
  status.repositories = worktrees.map(worktree => {
    const repoPath = path.join(workspaceInfo.path, worktree.worktree_path);
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
      name: worktree.repo_name,
      status: repoStatus,
      commitsAhead
    };
  });

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
 * Validate agent names (must be valid format)
 */
export function validateAgentNames(agentNames: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const name of agentNames) {
    if (isValidAgentName(name)) {
      valid.push(name);
    } else {
      invalid.push(name);
    }
  }

  return { valid, invalid };
}

export interface AddAgentOptions {
  skipDevcontainer?: boolean;  // Skip devcontainer creation (default: false)
  themeId?: string;            // Theme ID if agent came from a theme
}

/**
 * Create agent worktrees and update database
 */
export async function addAgentsToWorkspace(workspaceInfo: WorkspaceInfo, agentNames: string[], options?: AddAgentOptions): Promise<string[]> {
  // Import dynamically to avoid circular dependency
  const { createAgentWorktrees } = await import('./index.js');

  // Filter out existing agents
  const existingNames = new Set(workspaceInfo.agents.map(a => a.name));
  const newAgents = agentNames.filter(name => !existingNames.has(name));

  if (newAgents.length === 0) {
    return [];
  }

  // Create worktrees
  if (workspaceInfo.type === 'hq') {
    await createAgentWorktrees(workspaceInfo.agentsPath, newAgents, workspaceInfo.path, options);
  } else {
    await createAgentWorktrees(workspaceInfo.agentsPath, newAgents, undefined, options);
  }

  // Add to database (with optional theme ID)
  addAgentsToDatabase(workspaceInfo.path, newAgents, options?.themeId);

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

      // Stop and remove Docker container if it exists
      try {
        const containerId = execSync(
          `docker ps -aq --filter "label=devcontainer.local_folder=${agentDir}"`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();

        if (containerId) {
          execSync(`docker stop ${containerId}`, { stdio: 'pipe' });
          execSync(`docker rm ${containerId}`, { stdio: 'pipe' });
        }
      } catch {
        // Container might not exist, ignore errors
      }

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
    } catch {
      failed.push(agentName);
    }
  }

  // Remove from database
  if (removed.length > 0) {
    removeAgentsFromDatabase(workspaceInfo.path, removed);

    // Clear ticket assignees for removed agents
    try {
      const { storage } = await getPMOContext();
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