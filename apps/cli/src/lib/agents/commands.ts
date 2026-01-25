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
  addEphemeralAgentToDatabase,
  getEphemeralAgentNames,
  getActiveTheme,
  markAgentCleaned,
  discoverAgentsOnDisk,
  Agent,
  Repository
} from '../database/index.js';
import {
  isValidAgentName,
  getSuggestedAgentNames,
  generateEphemeralAgentName,
  GenerateEphemeralNameOptions,
  getThemePersistentDir,
  getThemeEphemeralDir,
  extractBaseName,
  getAgentBaseName,
} from '../themes.js';
import { createDevcontainerConfig } from '../execution/devcontainer.js';
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
  /** Active theme ID (if any) */
  activeThemeId: string | null;
  /** Directory name for persistent agents (e.g., 'staff', 'garage', 'portfolio') */
  persistentAgentsDir: string;
  /** Directory name for ephemeral agents (e.g., 'temp', 'pit', 'incubator') */
  ephemeralAgentsDir: string;
}

/**
 * Find workspace root and return workspace information.
 *
 * Search priority:
 * 1. PRLT_HQ_PATH environment variable (ONLY when DEVCONTAINER=true - for devcontainer mounts)
 * 2. Current directory tree for HQ with workspace.db
 *
 * NOTE: PRLT_HQ_PATH is ignored on host machines to support multiple agents
 * working in different workspaces simultaneously.
 */
export function getWorkspaceInfo(): WorkspaceInfo {
  // Check PRLT_HQ_PATH environment variable (only in devcontainers)
  const hqPath = process.env.PRLT_HQ_PATH;
  const isDevcontainer = process.env.DEVCONTAINER === 'true';

  if (hqPath && isDevcontainer) {
    const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
    if (fs.existsSync(dbPath)) {
      try {
        const config = getWorkspaceConfig(hqPath);
        if (config) {
          // Discover agents on disk and sync with database
          discoverAgentsOnDisk(hqPath);
          const agents = getWorkspaceAgents(hqPath);
          const repositories = getWorkspaceRepositories(hqPath);
          const activeTheme = getActiveTheme(hqPath);
          const persistentAgentsDir = getThemePersistentDir(activeTheme?.id);
          const ephemeralAgentsDir = getThemeEphemeralDir(activeTheme?.id);

          const agentsPath = config.type === 'hq'
            ? path.join(hqPath, 'agents', persistentAgentsDir)
            : hqPath;

          return {
            path: hqPath,
            type: config.type,
            workspaceName: config.workspace_name,
            hasPMO: config.has_pmo,
            agents,
            repositories,
            agentsPath,
            activeThemeId: activeTheme?.id ?? null,
            persistentAgentsDir,
            ephemeralAgentsDir,
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
          // Discover agents on disk and sync with database
          discoverAgentsOnDisk(currentDir);
          const agents = getWorkspaceAgents(currentDir);
          const repositories = getWorkspaceRepositories(currentDir);
          const activeTheme = getActiveTheme(currentDir);
          const persistentAgentsDir = getThemePersistentDir(activeTheme?.id);
          const ephemeralAgentsDir = getThemeEphemeralDir(activeTheme?.id);

          const agentsPath = config.type === 'hq'
            ? path.join(currentDir, 'agents', persistentAgentsDir)
            : currentDir;

          return {
            path: currentDir,
            type: config.type,
            workspaceName: config.workspace_name,
            hasPMO: config.has_pmo,
            agents,
            repositories,
            agentsPath,
            activeThemeId: activeTheme?.id ?? null,
            persistentAgentsDir,
            ephemeralAgentsDir,
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
        const tickets = JSON.parse(fs.readFileSync(ticketsFile, 'utf-8')) as Array<{ id: string; assignee?: string; status?: string }>;
        status.assignedTickets = tickets
          .filter((t) => t.assignee === agentName && t.status !== 'done')
          .map((t) => t.id);
        status.completedTickets = tickets
          .filter((t) => t.assignee === agentName && t.status === 'done')
          .map((t) => t.id);
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
      // eslint-disable-next-line unicorn/no-useless-undefined
      const allTickets = await storage.listTickets(undefined);
      for (const ticket of allTickets) {
        if (ticket.assignee && removed.includes(ticket.assignee)) {
          // Pass null to clear the assignee in the database
          // eslint-disable-next-line no-await-in-loop -- Sequential updates for cleanup
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

export interface EphemeralAgentOptions {
  themeId?: string;        // Theme to pick base name from
  skipDevcontainer?: boolean;  // Skip devcontainer creation
  /**
   * Optional logger for conflict messages (e.g., when a tmux session or directory already exists)
   */
  log?: (message: string) => void;
}

export interface EphemeralAgentResult {
  name: string;           // Generated name like "bold-bezos-1"
  baseName: string;       // Theme name like "bezos"
  worktreePath: string;   // Full path to agent worktree
  agent: Agent;           // Database record
}

/**
 * Create an ephemeral agent on-demand for a spawn operation.
 * Creates worktree in agents/temp/{name}/
 */
export async function createEphemeralAgent(
  workspaceInfo: WorkspaceInfo,
  options?: EphemeralAgentOptions
): Promise<EphemeralAgentResult> {
  // Get existing agent names for uniqueness check
  const existingNames = new Set([
    ...Array.from(getEphemeralAgentNames(workspaceInfo.path)),
    ...workspaceInfo.agents.map(a => a.name.toLowerCase())
  ]);

  const log = options?.log;

  // Get theme: use provided themeId, or fall back to workspace's active theme
  let themeId = options?.themeId;
  if (!themeId) {
    themeId = workspaceInfo.activeThemeId ?? undefined;
  }

  // Use theme-specific ephemeral directory
  const ephemeralDir = themeId ? getThemeEphemeralDir(themeId) : workspaceInfo.ephemeralAgentsDir;
  const tempAgentsBasePath = path.join(workspaceInfo.path, 'agents', ephemeralDir);

  // Extract base names currently in use by active agents
  // This helps the generator prefer fresh base names
  const inUseBaseNames = new Set(
    workspaceInfo.agents.map(agent => getAgentBaseName(agent).toLowerCase())
  );

  // Create a conflict checker for external resources (tmux sessions, directories)
  const checkExternalConflict = (candidateName: string): { conflict: boolean; reason?: string } => {
    // Check if a tmux session with this name already exists (could be from manual creation)
    if (tmuxSessionExists(candidateName)) {
      return { conflict: true, reason: `tmux session "${candidateName}" already exists` };
    }

    // Check if the directory already exists in agents/temp/
    const candidateDir = path.join(tempAgentsBasePath, candidateName);
    if (fs.existsSync(candidateDir)) {
      return { conflict: true, reason: `directory "${candidateDir}" already exists` };
    }

    return { conflict: false };
  };

  // Log when conflicts are skipped during name generation
  const onConflictSkipped = (name: string, reason: string) => {
    log?.(`⚠️  Skipping name "${name}": ${reason}`);
  };

  // Generate unique ephemeral name using workspace theme
  const nameOptions: GenerateEphemeralNameOptions = {
    themeId,
    checkExternalConflict,
    onConflictSkipped,
    inUseBaseNames
  };
  const agentName = generateEphemeralAgentName(existingNames, nameOptions);

  // Extract base name from the generated name (e.g., "bezos" from "bold-bezos" or "bold-bezos-2")
  const baseName = extractBaseName(agentName);

  // Create temp agents directory if it doesn't exist
  if (!fs.existsSync(tempAgentsBasePath)) {
    fs.mkdirSync(tempAgentsBasePath, { recursive: true });
  }

  const agentDir = path.join(tempAgentsBasePath, agentName);

  // Create agent directory
  if (!fs.existsSync(agentDir)) {
    fs.mkdirSync(agentDir, { recursive: true });
  }

  // Create worktrees for each repository
  const reposPath = path.join(workspaceInfo.path, 'repos');

  if (fs.existsSync(reposPath) && workspaceInfo.repositories.length > 0) {
    for (const repo of workspaceInfo.repositories) {
      const sourceRepoPath = path.join(reposPath, repo.name);
      const worktreePath = path.join(agentDir, repo.name);

      if (fs.existsSync(sourceRepoPath) && !fs.existsSync(worktreePath)) {
        try {
          // Create git worktree for the repository
          // Don't create a branch yet - that happens in work:start
          // Use --detach to create without a branch reference
          execSync(`git worktree add --detach "${worktreePath}"`, {
            cwd: sourceRepoPath,
            stdio: 'pipe'
          });
        } catch {
          // If worktree creation fails, try to just create the directory
          // The agent can still work without a worktree (e.g., for non-git projects)
          if (!fs.existsSync(worktreePath)) {
            fs.mkdirSync(worktreePath, { recursive: true });
          }
        }
      }
    }
  }

  // Create devcontainer config if not skipped (uses shared devcontainer generator)
  if (!options?.skipDevcontainer) {
    const devcontainerDir = path.join(agentDir, '.devcontainer');
    if (!fs.existsSync(devcontainerDir)) {
      createDevcontainerConfig({
        agentName,
        agentDir,
        repoWorktrees: workspaceInfo.repositories.map(r => r.name)
      });
    }
  }

  // Add to database
  const agent = addEphemeralAgentToDatabase(
    workspaceInfo.path,
    agentName,
    baseName,
    options?.themeId
  );

  return {
    name: agentName,
    baseName,
    worktreePath: agentDir,
    agent
  };
}

/**
 * Check if a tmux session exists for a given name
 */
export function tmuxSessionExists(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of active tmux sessions that match our pattern
 * Pattern: {ticketId}-{action}-{agent}
 */
export function getActiveTmuxSessions(): Array<{ name: string; ticketId: string; agent: string }> {
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(name => {
        // Parse session name: {ticketId}-{action}-{agent}
        const parts = name.split('-');
        if (parts.length >= 3) {
          // TKT-123-implement-bold-bezos-1 -> ticketId: TKT-123, agent: bold-bezos-1
          const ticketId = parts.slice(0, 2).join('-');
          const agent = parts.slice(3).join('-');
          return { name, ticketId, agent };
        }
        return { name, ticketId: '', agent: '' };
      })
      .filter(s => s.ticketId.startsWith('TKT-'));
  } catch {
    return [];
  }
}

/**
 * Check if there's an active tmux session for a specific ticket
 */
export function getTicketTmuxSession(ticketId: string): { sessionName: string; agent: string } | null {
  const sessions = getActiveTmuxSessions();
  const session = sessions.find(s => s.ticketId === ticketId);
  if (session) {
    return { sessionName: session.name, agent: session.agent };
  }
  return null;
}

/**
 * Kill a tmux session by name
 */
export function killTmuxSession(sessionName: string): boolean {
  try {
    execSync(`tmux kill-session -t "${sessionName}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Agent Cleanup Functions
// =============================================================================

export interface CleanupOptions {
  /** Logger for status messages */
  log?: (message: string) => void;
  /** If true, only show what would be cleaned without doing it */
  dryRun?: boolean;
  /** If true, skip git safety checks and force cleanup */
  force?: boolean;
  /** If true, push unpushed commits before cleanup */
  pushFirst?: boolean;
}

export interface WorktreeGitStatus {
  worktreePath: string;
  repoName: string;
  branch: string;
  hasUncommittedChanges: boolean;
  uncommittedFiles: string[];
  hasUnpushedCommits: boolean;
  unpushedCount: number;
}

export interface AgentGitStatus {
  agentName: string;
  worktrees: WorktreeGitStatus[];
  hasUnsavedWork: boolean;
}

export interface CleanupResult {
  agent: string;
  success: boolean;
  tmuxSessionsKilled: string[];
  containersRemoved: string[];
  directoriesRemoved: string[];
  errors: string[];
  /** Git status if cleanup was blocked due to unsaved work */
  gitStatus?: AgentGitStatus;
  /** Whether cleanup was blocked due to unsaved work */
  blockedByGit?: boolean;
}

/**
 * Get tmux sessions associated with an agent
 */
export function getAgentTmuxSessions(agentName: string): string[] {
  const sessions = getActiveTmuxSessions();
  return sessions
    .filter(s => s.agent === agentName)
    .map(s => s.name);
}

/**
 * Get docker containers associated with an agent directory
 */
function getAgentContainers(agentDir: string): string[] {
  try {
    const output = execSync(
      `docker ps -aq --filter "label=devcontainer.local_folder=${agentDir}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Check git status for all worktrees in an agent directory.
 * Returns info about uncommitted changes and unpushed commits.
 */
export function getAgentGitStatus(
  workspaceInfo: WorkspaceInfo,
  agentName: string
): AgentGitStatus {
  const agent = workspaceInfo.agents.find(a => a.name === agentName);
  const agentDir = agent?.type === 'ephemeral'
    ? path.join(workspaceInfo.path, 'agents', workspaceInfo.ephemeralAgentsDir, agentName)
    : path.join(workspaceInfo.path, 'agents', workspaceInfo.persistentAgentsDir, agentName);

  const result: AgentGitStatus = {
    agentName,
    worktrees: [],
    hasUnsavedWork: false
  };

  // Check each repository worktree
  for (const repo of workspaceInfo.repositories) {
    const worktreePath = path.join(agentDir, repo.name);

    if (!fs.existsSync(worktreePath)) {
      continue;
    }

    const status: WorktreeGitStatus = {
      worktreePath,
      repoName: repo.name,
      branch: '',
      hasUncommittedChanges: false,
      uncommittedFiles: [],
      hasUnpushedCommits: false,
      unpushedCount: 0
    };

    try {
      // Get current branch
      status.branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: worktreePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();

      // Check for uncommitted changes (staged + unstaged + untracked)
      const gitStatus = execSync('git status --porcelain', {
        cwd: worktreePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();

      if (gitStatus) {
        status.hasUncommittedChanges = true;
        status.uncommittedFiles = gitStatus.split('\n').filter(line => line.trim());
        result.hasUnsavedWork = true;
      }

      // Check for unpushed commits
      try {
        const unpushed = execSync(`git log @{u}..HEAD --oneline 2>/dev/null || echo ""`, {
          cwd: worktreePath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        if (unpushed) {
          status.hasUnpushedCommits = true;
          status.unpushedCount = unpushed.split('\n').filter(line => line.trim()).length;
          result.hasUnsavedWork = true;
        }
      } catch {
        // No upstream tracking branch - check if there are any commits at all
        try {
          const hasCommits = execSync('git log --oneline -1', {
            cwd: worktreePath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
          }).trim();
          if (hasCommits) {
            // Has commits but no upstream - consider as unpushed
            status.hasUnpushedCommits = true;
            status.unpushedCount = 1; // At least one
            result.hasUnsavedWork = true;
          }
        } catch {
          // No commits at all
        }
      }
    } catch {
      // Git commands failed - worktree might be corrupted
    }

    result.worktrees.push(status);
  }

  return result;
}

/**
 * Commit and push all work in an agent's worktrees.
 * - Stages all uncommitted changes (git add -A)
 * - Commits with a WIP message if there are staged changes
 * - Pushes all commits to remote
 * Returns true if all operations succeeded.
 */
export function pushAgentWork(
  workspaceInfo: WorkspaceInfo,
  agentName: string,
  log?: (message: string) => void
): boolean {
  const gitStatus = getAgentGitStatus(workspaceInfo, agentName);
  let allSuccess = true;

  for (const worktree of gitStatus.worktrees) {
    const { worktreePath, repoName, hasUncommittedChanges, uncommittedFiles, hasUnpushedCommits, unpushedCount, branch } = worktree;

    // First, commit any uncommitted changes
    if (hasUncommittedChanges) {
      try {
        log?.(`Committing ${uncommittedFiles.length} file(s) in ${repoName}...`);

        // Stage all changes
        execSync('git add -A', {
          cwd: worktreePath,
          stdio: 'pipe'
        });

        // Commit with WIP message
        const commitMessage = `WIP: Auto-commit before cleanup\n\nAgent: ${agentName}\nFiles: ${uncommittedFiles.length}`;
        execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
          cwd: worktreePath,
          stdio: 'pipe'
        });

        log?.(`✓ Committed changes in ${repoName}`);
      } catch (error) {
        log?.(`✗ Failed to commit ${repoName}: ${error}`);
        allSuccess = false;
        continue; // Skip push if commit failed
      }
    }

    // Then push (either existing unpushed commits or the one we just made)
    if (hasUnpushedCommits || hasUncommittedChanges) {
      try {
        const commitCount = hasUncommittedChanges ? (unpushedCount + 1) : unpushedCount;
        log?.(`Pushing ${commitCount} commit(s) from ${repoName} on ${branch}...`);

        // Set upstream if needed and push
        execSync(`git push -u origin ${branch}`, {
          cwd: worktreePath,
          stdio: 'pipe'
        });

        log?.(`✓ Pushed ${repoName}`);
      } catch (error) {
        log?.(`✗ Failed to push ${repoName}: ${error}`);
        allSuccess = false;
      }
    }
  }

  return allSuccess;
}

/**
 * Clean up a single agent - removes resources but keeps DB record (marked as cleaned)
 */
export async function cleanupAgent(
  workspaceInfo: WorkspaceInfo,
  agentName: string,
  options?: CleanupOptions
): Promise<CleanupResult> {
  const log = options?.log ?? (() => {});
  const dryRun = options?.dryRun ?? false;
  const force = options?.force ?? false;
  const pushFirst = options?.pushFirst ?? false;

  const result: CleanupResult = {
    agent: agentName,
    success: true,
    tmuxSessionsKilled: [],
    containersRemoved: [],
    directoriesRemoved: [],
    errors: []
  };

  // Find the agent
  const agent = workspaceInfo.agents.find(a => a.name === agentName);
  if (!agent) {
    result.success = false;
    result.errors.push(`Agent "${agentName}" not found`);
    return result;
  }

  // Check for unsaved work (uncommitted changes or unpushed commits)
  if (!force) {
    const gitStatus = getAgentGitStatus(workspaceInfo, agentName);

    if (gitStatus.hasUnsavedWork) {
      // If pushFirst is set, try to push before cleanup
      if (pushFirst) {
        log('Pushing unpushed work before cleanup...');
        const pushed = pushAgentWork(workspaceInfo, agentName, log);
        if (!pushed) {
          result.success = false;
          result.blockedByGit = true;
          result.gitStatus = gitStatus;
          result.errors.push('Failed to push some work. Use --force to cleanup anyway.');
          return result;
        }
        // Re-check git status after push
        const newStatus = getAgentGitStatus(workspaceInfo, agentName);
        if (newStatus.hasUnsavedWork) {
          result.success = false;
          result.blockedByGit = true;
          result.gitStatus = newStatus;
          result.errors.push('Agent still has uncommitted changes after push. Commit changes or use --force.');
          return result;
        }
      } else {
        // Block cleanup - has unsaved work
        result.success = false;
        result.blockedByGit = true;
        result.gitStatus = gitStatus;

        const issues: string[] = [];
        for (const wt of gitStatus.worktrees) {
          if (wt.hasUncommittedChanges) {
            issues.push(`${wt.repoName}: ${wt.uncommittedFiles.length} uncommitted files`);
          }
          if (wt.hasUnpushedCommits) {
            issues.push(`${wt.repoName}: ${wt.unpushedCount} unpushed commits on ${wt.branch}`);
          }
        }
        result.errors.push(`Agent has unsaved work: ${issues.join(', ')}. Use --push to push first or --force to cleanup anyway.`);
        return result;
      }
    }
  }

  // Determine agent directory
  const agentDir = agent.type === 'ephemeral'
    ? path.join(workspaceInfo.path, 'agents', workspaceInfo.ephemeralAgentsDir, agentName)
    : path.join(workspaceInfo.path, 'agents', workspaceInfo.persistentAgentsDir, agentName);

  // 1. Kill tmux sessions for this agent
  const tmuxSessions = getAgentTmuxSessions(agentName);
  for (const session of tmuxSessions) {
    if (dryRun) {
      log(`[dry-run] Would kill tmux session: ${session}`);
    } else {
      log(`Killing tmux session: ${session}`);
      if (killTmuxSession(session)) {
        result.tmuxSessionsKilled.push(session);
      } else {
        result.errors.push(`Failed to kill tmux session: ${session}`);
      }
    }
  }

  // 2. Stop and remove docker containers
  const containers = getAgentContainers(agentDir);
  for (const containerId of containers) {
    if (dryRun) {
      log(`[dry-run] Would remove container: ${containerId}`);
    } else {
      log(`Removing container: ${containerId}`);
      try {
        execSync(`docker rm -f ${containerId}`, { stdio: 'pipe' });
        result.containersRemoved.push(containerId);
      } catch (error) {
        result.errors.push(`Failed to remove container ${containerId}: ${error}`);
      }
    }
  }

  // 3. Remove git worktrees for each repository
  for (const repo of workspaceInfo.repositories) {
    const worktreePath = path.join(agentDir, repo.name);
    const sourceRepoPath = path.join(workspaceInfo.path, 'repos', repo.name);

    if (fs.existsSync(worktreePath) && fs.existsSync(sourceRepoPath)) {
      if (dryRun) {
        log(`[dry-run] Would remove worktree: ${worktreePath}`);
      } else {
        log(`Removing worktree: ${worktreePath}`);
        try {
          execSync(`git worktree remove "${worktreePath}" --force`, {
            cwd: sourceRepoPath,
            stdio: 'pipe'
          });
        } catch {
          // If git worktree remove fails, we'll still try to remove the directory
        }
      }
    }
  }

  // 4. Remove agent directory
  if (fs.existsSync(agentDir)) {
    if (dryRun) {
      log(`[dry-run] Would remove directory: ${agentDir}`);
      result.directoriesRemoved.push(agentDir);
    } else {
      log(`Removing directory: ${agentDir}`);
      try {
        fs.rmSync(agentDir, { recursive: true, force: true });
        result.directoriesRemoved.push(agentDir);
      } catch (error) {
        result.errors.push(`Failed to remove directory ${agentDir}: ${error}`);
        result.success = false;
      }
    }
  }

  // 5. Prune worktrees
  if (!dryRun) {
    for (const repo of workspaceInfo.repositories) {
      const sourceRepoPath = path.join(workspaceInfo.path, 'repos', repo.name);
      if (fs.existsSync(sourceRepoPath)) {
        try {
          execSync('git worktree prune', { cwd: sourceRepoPath, stdio: 'pipe' });
        } catch {
          // Ignore prune errors
        }
      }
    }
  }

  // 6. Mark agent as cleaned in database (not delete)
  if (!dryRun && result.success) {
    log(`Marking agent "${agentName}" as cleaned`);
    markAgentCleaned(workspaceInfo.path, agentName);
  }

  return result;
}

/**
 * Get agents that can be cleaned up (active ephemeral agents with no running work)
 */
export function getCleanableAgents(
  workspaceInfo: WorkspaceInfo,
  checkRunning: boolean = true
): Agent[] {
  // Get active ephemeral agents
  const ephemeralAgents = workspaceInfo.agents.filter(
    a => a.type === 'ephemeral' && a.status === 'active'
  );

  if (!checkRunning) {
    return ephemeralAgents;
  }

  // Filter out agents with active tmux sessions
  return ephemeralAgents.filter(agent => {
    const sessions = getAgentTmuxSessions(agent.name);
    return sessions.length === 0;
  });
}