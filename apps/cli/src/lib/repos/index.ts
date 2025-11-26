import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { styles } from '../styles.js';

export interface RepoToAdd {
  path: string;
  action: 'move' | 'clone';
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
  } catch (error) {
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
    } catch (error) {
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