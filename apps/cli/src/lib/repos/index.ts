import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { styles } from '../styles.js';
import { colors } from '../colors.js';
import {
  openWorkspaceDatabase,
  addRepositoriesToDatabase,
  getWorkspaceRepositories,
  Repository
} from '../database/index.js';
import { createDevcontainerConfig } from '../execution/devcontainer.js';
import { findHQRoot } from '../workspace.js';

export interface RepoToAdd {
  path: string;
  action: 'move' | 'clone';
}

export interface RepoInfo {
  name: string;
  path: string;
  fullPath: string;
  sourceUrl?: string;
  branch?: string;
  status: 'clean' | 'dirty' | 'missing';
  commitsAhead: number;
  commitsBehind: number;
  addedAt?: string;
}

/**
 * Check if we're currently in a git repository
 */
export function isInGitRepo(dir: string = process.cwd()): boolean {
  try {
    execSync('git rev-parse --git-dir', { 
      cwd: dir,
      stdio: 'pipe' 
    });
    return true;
  } catch {
    // Not in a git repo - git rev-parse exits with non-zero status
    return false;
  }
}

/**
 * Get the current repository name
 */
export function getCurrentRepoName(dir: string = process.cwd()): string | null {
  if (!isInGitRepo(dir)) {
    return null;
  }
  
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf-8'
    }).trim();
    
    // Extract repo name from URL
    const match = remoteUrl.match(/\/([^\/]+?)(\.git)?$/);
    if (match) {
      return match[1];
    }
  } catch {
    // No remote origin, use directory name
  }
  
  return path.basename(dir);
}

/**
 * Prompt user to add repositories interactively
 */
export async function promptForRepositories(
  currentDir: string = process.cwd(),
  existingRepos: string[] = []
): Promise<RepoToAdd[]> {
  const repos: RepoToAdd[] = [];
  const inGitRepo = isInGitRepo(currentDir);
  
  // Start with current repo if we're in one
  if (inGitRepo) {
    const currentRepoName = getCurrentRepoName(currentDir) || path.basename(currentDir);
    
    // Check if this repo is already added
    if (!existingRepos.includes(currentRepoName)) {
      const { addCurrent } = await inquirer.prompt([{
        type: 'list',
        name: 'addCurrent',
        message: `Add current repository (${currentRepoName}) to repos/?`,
        choices: [
          { name: 'Yes', value: true },
          { name: 'No', value: false }
        ],
        default: true,
      }]);
      
      if (addCurrent) {
        // Can only clone (not move) the current repo since we're inside it
        console.log(styles.muted('Note: Current repository will be cloned (cannot move while inside it)'));
        repos.push({ path: currentDir, action: 'clone' });
      }
    }
  }

  // Loop to add more repos
  let addingRepos = true;
  while (addingRepos) {
    const { repoAction } = await inquirer.prompt([{
      type: 'list',
      name: 'repoAction',
      message: repos.length === 0 
        ? 'How would you like to add repositories to the HQ?'
        : 'Add another repository?',
      choices: [
        { name: '📁 Manually enter repository path or Git URL', value: 'manual' },
        { name: '🔍 Search for repositories on this machine', value: 'search' },
        { name: '✨ Create new repository', value: 'create' },
        { name: repos.length === 0 ? '⏭️  Skip adding repositories' : '✅ Done adding repositories', value: 'skip' }
      ],
      default: repos.length === 0 ? 'manual' : 'skip'
    }]);

    if (repoAction === 'skip') {
      addingRepos = false;
      break;
    }

    if (repoAction === 'create') {
      const newRepo = await createNewRepository();
      if (newRepo) {
        repos.push(newRepo);
      }
      continue;
    }

    if (repoAction === 'search') {
      const foundRepos = await searchForRepositories();
      repos.push(...foundRepos);
      
      // After search, ask if they want to add more (unless they selected nothing)
      if (foundRepos.length > 0) {
        const { addMoreAfterSearch } = await inquirer.prompt([{
          type: 'list',
          name: 'addMoreAfterSearch',
          message: 'Would you like to add more repositories?',
          choices: [
            { name: 'No', value: false },
            { name: 'Yes', value: true }
          ],
          default: false
        }]);
        
        if (!addMoreAfterSearch) {
          addingRepos = false;
          break;
        }
      }
      continue;
    }

    // Manual entry (existing logic)
    const { repoPath } = await inquirer.prompt([{
      type: 'input',
      name: 'repoPath',
      message: 'Enter repo path or Git URL:',
      validate: (input) => input.trim() ? true : 'Path or URL required',
    }]);
    
    const trimmedPath = repoPath.trim();
    
    if (trimmedPath.startsWith('http://') || 
        trimmedPath.startsWith('https://') || 
        trimmedPath.startsWith('git@')) {
      // Git URL - always clone
      repos.push({ path: trimmedPath, action: 'clone' });
      console.log(styles.muted(`Will clone: ${trimmedPath}`));
    } else {
      // Local path - ask move or clone
      const resolvedPath = path.resolve(trimmedPath);
      const repoName = path.basename(resolvedPath);
      
      // Check if we're currently inside this repo
      const currentlyInside = process.cwd().startsWith(resolvedPath);
      
      if (currentlyInside) {
        console.log(chalk.yellow(`Cannot move ${repoName} - you're currently inside it. Will clone instead.`));
        repos.push({ path: resolvedPath, action: 'clone' });
      } else {
        const { action } = await inquirer.prompt([{
          type: 'list',
          name: 'action',
          message: `${repoName} - Move or Clone?`,
          choices: [
            { name: 'Clone (keep original)', value: 'clone' },
            { name: 'Move (relocate to HQ)', value: 'move' },
          ],
        }]);
        repos.push({ path: resolvedPath, action: action as 'move' | 'clone' });
      }
    }
  }

  return repos;
}

/**
 * Add repositories to HQ
 */
export async function addRepositoriesToHQ(
  hqPath: string,
  repos: RepoToAdd[]
): Promise<string[]> {
  const reposDir = path.join(hqPath, 'repos');
  
  // Ensure repos directory exists
  if (!fs.existsSync(reposDir)) {
    fs.mkdirSync(reposDir, { recursive: true });
  }

  const addedRepos: string[] = [];

  for (const repo of repos) {
    const repoName = path.basename(repo.path).replace(/\.git$/, '');
    const targetPath = path.join(reposDir, repoName);
    
    // Check if repo already exists
    if (fs.existsSync(targetPath)) {
      console.log(chalk.yellow(`Repository ${repoName} already exists in repos/`));
      continue;
    }
    
    try {
      if (repo.action === 'move') {
        // Move the repository
        console.log(styles.muted(`Moving ${repo.path} to repos/${repoName}...`));
        fs.renameSync(repo.path, targetPath);
      } else {
        // Clone the repository
        console.log(styles.muted(`Cloning ${repo.path} to repos/${repoName}...`));
        execSync(`git clone ${repo.path} ${targetPath}`, {
          stdio: 'inherit'
        });
      }
      
      addedRepos.push(repoName);
      console.log(chalk.green(`✅ Repository ${repoName} added successfully`));
    } catch (error) {
      console.log(chalk.red(`Could not ${repo.action} repository: ${repo.path}`));
      console.log(chalk.red(`Error: ${error}`));
    }
  }

  return addedRepos;
}

/**
 * Update HQ config with new repositories
 */
export function updateHQRepos(hqPath: string, newRepos: string[]): void {
  const configPath = path.join(hqPath, '.proletariat', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  
  // Add new repos to the list (avoiding duplicates)
  const existingRepos = config.repos || [];
  const uniqueNewRepos = newRepos.filter(r => !existingRepos.includes(r));
  
  config.repos = [...existingRepos, ...uniqueNewRepos];
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Create a new repository in the HQ
 */
async function createNewRepository(): Promise<RepoToAdd | null> {
  const { repoName, initWithReadme } = await inquirer.prompt([
    {
      type: 'input',
      name: 'repoName',
      message: 'Repository name:',
      validate: (input) => {
        if (!input.trim()) return 'Repository name is required';
        if (!/^[a-zA-Z0-9-_]+$/.test(input)) {
          return 'Repository name can only contain letters, numbers, hyphens, and underscores';
        }
        return true;
      }
    },
    {
      type: 'list',
      name: 'initWithReadme',
      message: 'Initialize with README.md?',
      choices: [
        { name: 'Yes', value: true },
        { name: 'No', value: false }
      ],
      default: true
    }
  ]);

  const repoPath = `/tmp/new-repo-${repoName}`;
  
  try {
    // Create temporary directory for new repo
    fs.mkdirSync(repoPath, { recursive: true });
    
    // Initialize git repository
    execSync('git init', { cwd: repoPath });
    execSync('git config user.email "init@proletariat.local"', { cwd: repoPath });
    execSync('git config user.name "Proletariat Init"', { cwd: repoPath });
    
    if (initWithReadme) {
      const readmeContent = `# ${repoName}\n\nCreated by Proletariat CLI\n`;
      fs.writeFileSync(path.join(repoPath, 'README.md'), readmeContent);
      execSync('git add README.md', { cwd: repoPath });
      execSync('git commit -m "Initial commit"', { cwd: repoPath });
    }
    
    console.log(chalk.green(`✅ Created new repository: ${repoName}`));
    
    return { path: repoPath, action: 'move' };
  } catch (error) {
    console.log(chalk.red(`Failed to create repository ${repoName}: ${error}`));
    return null;
  }
}

/**
 * Search for existing git repositories on the machine
 */
async function searchForRepositories(): Promise<RepoToAdd[]> {
  console.log(chalk.blue('🔍 Searching for git repositories...'));
  
  // Common development directories to search
  const searchPaths = [
    path.join(process.env.HOME || '~', 'Projects'),
    path.join(process.env.HOME || '~', 'Developer'),
    path.join(process.env.HOME || '~', 'Code'),
    path.join(process.env.HOME || '~', 'workspace'),
    path.join(process.env.HOME || '~', 'src'),
  ].filter(p => fs.existsSync(p));

  if (searchPaths.length === 0) {
    console.log(chalk.yellow('No common development directories found.'));
    return [];
  }

  const foundRepos: string[] = [];
  
  for (const searchPath of searchPaths) {
    try {
      // Find .git directories (limiting depth for performance)
      const result = execSync(`find "${searchPath}" -name ".git" -type d -maxdepth 3`, {
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim();
      
      if (result) {
        const gitDirs = result.split('\n');
        const repoPaths = gitDirs.map(gitDir => path.dirname(gitDir));
        foundRepos.push(...repoPaths);
      }
    } catch {
      // Skip directories we can't access
      console.log(styles.muted(`Skipped ${searchPath} (no access)`));
    }
  }

  if (foundRepos.length === 0) {
    console.log(chalk.yellow('No git repositories found in common directories.'));
    return [];
  }

  // Remove duplicates and get repo names
  const uniqueRepos = [...new Set(foundRepos)];
  const repoChoices = uniqueRepos.map(repoPath => ({
    name: `${path.basename(repoPath)} (${repoPath})`,
    value: repoPath
  }));

  const { selectedRepos } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selectedRepos',
    message: `Found ${uniqueRepos.length} repositories. Select which ones to add (SPACE to select, ENTER when done):`,
    choices: repoChoices,
    pageSize: 10,
    validate: (choices) => {
      if (choices.length === 0) {
        return 'No repositories selected. Press SPACE to select repositories, or ENTER to continue with none.';
      }
      return true;
    },
  }]);

  console.log(chalk.green(`✅ Selected ${selectedRepos.length} repositories`));

  return selectedRepos.map((repoPath: string) => ({ path: repoPath, action: 'clone' as const }));
}

// =============================================================================
// Workspace Info & Repository Status
// =============================================================================

export interface WorkspaceRepoInfo {
  hqPath: string;
  reposPath: string;
  repositories: RepoInfo[];
}

/**
 * Find HQ root by traversing upward
 * @deprecated Use findHQRoot from '../workspace.js' instead for PRLT_HQ_PATH support
 */
export { findHQRoot } from '../workspace.js';

/**
 * Get workspace repository information
 */
export function getWorkspaceRepoInfo(): WorkspaceRepoInfo {
  const hqPath = findHQRoot();
  if (!hqPath) {
    throw new Error('Not in an HQ directory. Run "prlt init" first.');
  }

  const reposPath = path.join(hqPath, 'repos');
  const dbRepos = getWorkspaceRepositories(hqPath);

  const repositories: RepoInfo[] = dbRepos.map(repo => {
    const fullPath = path.join(hqPath, repo.path);
    return getRepoStatus(repo.name, fullPath, repo);
  });

  return { hqPath, reposPath, repositories };
}

/**
 * Get detailed status for a repository
 */
export function getRepoStatus(name: string, fullPath: string, dbRepo?: Repository): RepoInfo {
  const info: RepoInfo = {
    name,
    path: dbRepo?.path || `repos/${name}`,
    fullPath,
    sourceUrl: dbRepo?.source_url,
    status: 'missing',
    commitsAhead: 0,
    commitsBehind: 0,
    addedAt: dbRepo?.added_at
  };

  if (!fs.existsSync(fullPath)) {
    return info;
  }

  try {
    // Get current branch
    info.branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: fullPath,
      stdio: 'pipe',
      encoding: 'utf-8'
    }).trim();

    // Check for uncommitted changes
    const status = execSync('git status --porcelain', {
      cwd: fullPath,
      stdio: 'pipe',
      encoding: 'utf-8'
    }).trim();
    info.status = status.length > 0 ? 'dirty' : 'clean';

    // Get commits ahead/behind
    try {
      const aheadBehind = execSync('git rev-list --left-right --count @{upstream}...HEAD', {
        cwd: fullPath,
        stdio: 'pipe',
        encoding: 'utf-8'
      }).trim();
      const [behind, ahead] = aheadBehind.split('\t').map(Number);
      info.commitsAhead = ahead || 0;
      info.commitsBehind = behind || 0;
    } catch {
      // No upstream configured
    }
  } catch {
    // Git command failed
    info.status = 'missing';
  }

  return info;
}

// =============================================================================
// Repository CRUD Operations
// =============================================================================

/**
 * Add a single repository to the HQ (file system + database + agent worktrees)
 */
export async function addRepository(
  hqPath: string,
  repoPath: string,
  action: 'clone' | 'move'
): Promise<{ success: boolean; name: string; error?: string }> {
  const repoName = path.basename(repoPath).replace(/\.git$/, '');
  const reposDir = path.join(hqPath, 'repos');
  const targetPath = path.join(reposDir, repoName);

  // Ensure repos directory exists
  if (!fs.existsSync(reposDir)) {
    fs.mkdirSync(reposDir, { recursive: true });
  }

  // Check if repo already exists
  if (fs.existsSync(targetPath)) {
    return { success: false, name: repoName, error: 'Repository already exists' };
  }

  try {
    // Add to file system
    if (action === 'move') {
      console.log(styles.muted(`Moving ${repoPath} to repos/${repoName}...`));
      fs.renameSync(repoPath, targetPath);
    } else {
      console.log(styles.muted(`Cloning ${repoPath} to repos/${repoName}...`));
      execSync(`git clone "${repoPath}" "${targetPath}"`, { stdio: 'inherit' });
    }

    // Add to database
    const dbRepoData = [{
      name: repoName,
      path: `repos/${repoName}`,
      source_url: repoPath,
      action
    }];
    addRepositoriesToDatabase(hqPath, dbRepoData);

    // Create worktrees for existing agents
    await createWorktreesForRepo(hqPath, repoName, targetPath);

    // Create devcontainer config for sandboxed execution in the central repo
    console.log(styles.muted(`Creating devcontainer config for ${repoName}...`));
    createDevcontainerConfig({
      agentName: repoName,  // Use repo name as identifier
      agentDir: targetPath,
      repoWorktrees: [],    // No nested worktrees - this is the repo itself
    });

    return { success: true, name: repoName };
  } catch (error) {
    return {
      success: false,
      name: repoName,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Remove a repository from the HQ
 */
export async function removeRepository(
  hqPath: string,
  repoName: string,
  keepFiles: boolean = false
): Promise<{ success: boolean; error?: string }> {
  const repoPath = path.join(hqPath, 'repos', repoName);

  try {
    // Remove agent worktrees first
    await removeWorktreesForRepo(hqPath, repoName);

    // Remove from file system (unless keepFiles)
    if (!keepFiles && fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }

    // Remove from database
    const db = openWorkspaceDatabase(hqPath);
    db.prepare('DELETE FROM repositories WHERE name = ?').run(repoName);
    db.close();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Create worktrees for a repository in all agent directories
 */
async function createWorktreesForRepo(hqPath: string, repoName: string, repoPath: string): Promise<void> {
  const db = openWorkspaceDatabase(hqPath);

  // Get workspace config for theme info
  const workspace = db.prepare('SELECT theme FROM workspace').get() as { theme: string };
  const theme = db.prepare('SELECT workspace_dir FROM themes WHERE name = ?').get(workspace.theme) as { workspace_dir: string };

  // Get all agents
  const agents = db.prepare('SELECT name FROM agents').all() as { name: string }[];

  if (agents.length === 0) {
    db.close();
    return;
  }

  const agentsBasePath = path.join(hqPath, 'agents', theme.workspace_dir);

  for (const agent of agents) {
    // Name worktree directory as {repoName}-{agentName} so git creates unique worktree entries
    // e.g., proletariat-branson instead of proletariat (which causes proletariat1, proletariat2, etc.)
    const worktreeDirName = `${repoName}-${agent.name}`;
    const agentRepoPath = path.join(agentsBasePath, agent.name, worktreeDirName);
    const branchName = `agent-${agent.name}`;

    try {
      // Create worktree
      execSync(`git worktree add -b "${branchName}" "${agentRepoPath}"`, {
        cwd: repoPath,
        stdio: 'pipe'
      });

      // Add to database
      db.prepare(`
        INSERT OR REPLACE INTO agent_worktrees
        (agent_name, repo_name, worktree_path, branch, created_at, commits_ahead, is_clean)
        VALUES (?, ?, ?, ?, ?, 0, 1)
      `).run(
        agent.name,
        repoName,
        `agents/${theme.workspace_dir}/${agent.name}/${worktreeDirName}`,
        branchName,
        new Date().toISOString()
      );
    } catch {
      console.log(chalk.yellow(`Warning: Could not create worktree for ${agent.name}/${repoName}`));
    }
  }

  db.close();
}

/**
 * Remove worktrees for a repository from all agent directories
 */
async function removeWorktreesForRepo(hqPath: string, repoName: string): Promise<void> {
  const db = openWorkspaceDatabase(hqPath);

  // Get workspace config for theme info
  const workspace = db.prepare('SELECT theme FROM workspace').get() as { theme: string };
  const theme = db.prepare('SELECT workspace_dir FROM themes WHERE name = ?').get(workspace.theme) as { workspace_dir: string };

  // Get all agents
  const agents = db.prepare('SELECT name FROM agents').all() as { name: string }[];

  const repoPath = path.join(hqPath, 'repos', repoName);
  const agentsBasePath = path.join(hqPath, 'agents', theme.workspace_dir);

  for (const agent of agents) {
    const agentRepoPath = path.join(agentsBasePath, agent.name, repoName);

    try {
      // Remove worktree from git
      if (fs.existsSync(repoPath)) {
        execSync(`git worktree remove "${agentRepoPath}" --force`, {
          cwd: repoPath,
          stdio: 'pipe'
        });
      } else if (fs.existsSync(agentRepoPath)) {
        // Repo doesn't exist but worktree dir does - just remove directory
        fs.rmSync(agentRepoPath, { recursive: true, force: true });
      }
    } catch {
      // Try to just remove the directory
      if (fs.existsSync(agentRepoPath)) {
        try {
          fs.rmSync(agentRepoPath, { recursive: true, force: true });
        } catch {
          console.log(chalk.yellow(`Warning: Could not remove worktree for ${agent.name}/${repoName}`));
        }
      }
    }
  }

  // Remove from database
  db.prepare('DELETE FROM agent_worktrees WHERE repo_name = ?').run(repoName);
  db.close();
}

// =============================================================================
// Interactive Prompts for Commands
// =============================================================================

/**
 * Prompt to add a single repository
 */
export async function promptAddSingleRepo(): Promise<RepoToAdd | null> {
  const { method } = await inquirer.prompt([{
    type: 'list',
    name: 'method',
    message: 'How would you like to add a repository?',
    choices: [
      { name: '📁 Enter path or Git URL', value: 'manual' },
      { name: '🔍 Search for repositories on this machine', value: 'search' },
      { name: '✨ Create new repository', value: 'create' },
      new inquirer.Separator(),
      { name: '❌ Cancel', value: 'cancel' }
    ]
  }]);

  if (method === 'cancel') {
    return null;
  }

  if (method === 'create') {
    return createNewRepository();
  }

  if (method === 'search') {
    const repos = await searchForRepositories();
    return repos.length > 0 ? repos[0] : null;
  }

  // Manual entry
  const { repoPath } = await inquirer.prompt([{
    type: 'input',
    name: 'repoPath',
    message: 'Enter repo path or Git URL:',
    validate: (input) => input.trim() ? true : 'Path or URL required'
  }]);

  const trimmedPath = repoPath.trim();
  const isUrl = trimmedPath.startsWith('http://') ||
                trimmedPath.startsWith('https://') ||
                trimmedPath.startsWith('git@');

  if (isUrl) {
    return { path: trimmedPath, action: 'clone' };
  }

  const resolvedPath = path.resolve(trimmedPath);
  const repoName = path.basename(resolvedPath);
  const currentlyInside = process.cwd().startsWith(resolvedPath);

  if (currentlyInside) {
    console.log(chalk.yellow(`Cannot move ${repoName} - you're currently inside it. Will clone instead.`));
    return { path: resolvedPath, action: 'clone' };
  }

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: `${repoName} - Move or Clone?`,
    choices: [
      { name: 'Clone (keep original)', value: 'clone' },
      { name: 'Move (relocate to HQ)', value: 'move' }
    ]
  }]);

  return { path: resolvedPath, action: action as 'move' | 'clone' };
}

/**
 * Prompt to select a repository from the workspace
 */
export async function promptSelectRepo(
  message: string = 'Select repository:',
  allowCancel: boolean = true
): Promise<string | null> {
  const { repositories } = getWorkspaceRepoInfo();

  if (repositories.length === 0) {
    console.log(colors.warning('No repositories found. Add one with "prlt repo add"'));
    return null;
  }

  const choices = [
    ...repositories.map(repo => ({
      name: `${repo.name} (${repo.status}${repo.commitsAhead > 0 ? `, ${repo.commitsAhead} ahead` : ''})`,
      value: repo.name
    }))
  ];

  if (allowCancel) {
    choices.push(
      new inquirer.Separator() as any,
      { name: '❌ Cancel', value: 'cancel' }
    );
  }

  const { selected } = await inquirer.prompt([{
    type: 'list',
    name: 'selected',
    message,
    choices
  }]);

  return selected === 'cancel' ? null : selected;
}

/**
 * Prompt to select multiple repositories
 */
export async function promptSelectMultipleRepos(
  message: string = 'Select repositories:'
): Promise<string[]> {
  const { repositories } = getWorkspaceRepoInfo();

  if (repositories.length === 0) {
    console.log(colors.warning('No repositories found.'));
    return [];
  }

  const choices = repositories.map(repo => ({
    name: `${repo.name} (${repo.status}${repo.commitsAhead > 0 ? `, ${repo.commitsAhead} ahead` : ''})`,
    value: repo.name
  }));

  const { selected } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selected',
    message,
    choices
  }]);

  return selected;
}