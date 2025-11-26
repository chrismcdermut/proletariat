import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { THEMES } from '../themes.js';
import { addAgentsToHQ, createAgentWorktrees } from '../agents/index.js';
import { addRepositoriesToHQ, updateHQRepos, isInGitRepo } from '../repos/index.js';
import { createPMO, updateHQConfigWithPMO, PMOStorageType } from '../pmo/index.js';
import { 
  createWorkspaceDatabase, 
  addRepositoriesToDatabase, 
  addAgentsToDatabase,
  getWorkspaceConfig 
} from '../database/index.js';

export interface HQConfig {
  type: 'hq';
  created: string;
  theme: string;
  workspaceName: string;
  hasPMO: boolean;
  agents: string[];
  repos: string[];
}

export type WorkspaceType = 'hq' | 'workspace-only';

export interface InitOptions {
  workspaceType: WorkspaceType;
  hqName?: string;
  hqPath?: string;
  workspacePath?: string;
  theme: string;
  addSuffix?: boolean;
  selectedAgents: string[];
  repos?: Array<{ path: string; action: 'move' | 'clone' }>;
  includePMO?: boolean;
  boardTemplate?: string;
  pmoStorageType?: PMOStorageType;
}

/**
 * Prompt user for workspace type selection
 */
export async function promptForWorkspaceType(): Promise<WorkspaceType> {
  // Only show workspace-only option if we're in a git repo
  const inGitRepo = isInGitRepo();
  
  if (!inGitRepo) {
    // Outside git repo, only HQ makes sense
    return 'hq';
  }

  const { workspaceType } = await inquirer.prompt([{
    type: 'list',
    name: 'workspaceType',
    message: 'What type of workspace do you want to create?',
    choices: [
      {
        name: '🏢 Full HQ (headquarters) - Complete setup with repos/, agents, and PMO (recomended)',
        value: 'hq'
      },
      {
        name: '🔧 Agent workspace only - Just create agent workspace next to current repo',
        value: 'workspace-only'
      }
    ],
    default: 'hq'
  }]);

  return workspaceType;
}

/**
 * Validate that HQ path is not inside a git repository
 */
export function validateHQLocation(location: string): boolean {
  const resolvedPath = path.resolve(location);
  
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { 
      cwd: path.dirname(resolvedPath),
      stdio: 'pipe',
      encoding: 'utf-8'
    }).trim();
    
    // Use realpath to resolve symlinks and /private prefix on macOS
    const normalizedPath = fs.realpathSync(path.dirname(resolvedPath));
    const normalizedGitRoot = fs.realpathSync(gitRoot);
    
    if (normalizedPath.startsWith(normalizedGitRoot)) {
      return false; // Inside a git repo
    }
  } catch (error) {
    // Not in a git repo - this is fine
  }
  
  return true;
}

/**
 * Prompt user for HQ name
 */
export async function promptForHQName(): Promise<string> {
  const inGitRepo = isInGitRepo();
  const defaultName = inGitRepo 
    ? path.basename(process.cwd())  // Use repo name as default
    : '';                            // No default outside repo
    
  const { name } = await inquirer.prompt([{
    type: 'input',
    name: 'name',
    message: 'Workspace name (company, project, or team name recommended):',
    default: defaultName,
    validate: (input) => {
      if (!input.trim()) return 'Name is required';
      if (!/^[a-zA-Z0-9-_]+$/.test(input)) {
        return 'Name can only contain letters, numbers, hyphens, and underscores';
      }
      return true;
    },
  }]);

  return name;
}

/**
 * Prompt user for HQ suffix preference
 */
export async function promptForHQSuffix(): Promise<boolean> {
  const { addSuffix } = await inquirer.prompt([{
    type: 'list',
    name: 'addSuffix',
    message: 'Add "-hq" suffix to folder name?',
    choices: [
      { name: 'Yes', value: true },
      { name: 'No', value: false }
    ],
    default: true,
  }]);

  return addSuffix;
}

/**
 * Prompt user for HQ location
 */
export async function promptForHQLocation(hqName: string, addSuffix: boolean): Promise<string> {
  const inGitRepo = isInGitRepo();
  const folderName = addSuffix ? `${hqName}-hq` : hqName;
  
  // Always suggest creating HQ as sibling if in repo, or subdirectory if not
  const defaultPath = inGitRepo
    ? path.join('..', folderName)  // Sibling to repo
    : `./${folderName}`;            // Subdirectory

  while (true) {
    const { location } = await inquirer.prompt([{
      type: 'input',
      name: 'location',
      message: `Where to create HQ [press Enter for ${defaultPath}]:`,
      default: defaultPath,
    }]);

    // Validate location
    if (!validateHQLocation(location)) {
      console.log(chalk.red('That\'s jail! Cannot create HQ inside a git repository.'));
      continue;
    }

    // Check if directory already exists
    const resolvedPath = path.resolve(location);
    if (fs.existsSync(resolvedPath)) {
      console.log(chalk.red(`Directory ${resolvedPath} already exists.`));
      continue;
    }

    return resolvedPath;
  }
}



/**
 * Create the basic HQ directory structure
 */
export function createHQStructure(hqPath: string, theme: string): void {
  const themeConfig = THEMES[theme];

  console.log(chalk.blue(`\n🏗️  Creating HQ at ${hqPath}...`));

  // Create directories
  fs.mkdirSync(hqPath, { recursive: true });
  fs.mkdirSync(path.join(hqPath, '.proletariat'), { recursive: true });
  fs.mkdirSync(path.join(hqPath, 'repos'), { recursive: true });
  fs.mkdirSync(path.join(hqPath, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(hqPath, 'agents', themeConfig.workspaceDir), { recursive: true });
}

/**
 * Create workspace database (replaces createHQConfig)
 */
export function initializeWorkspaceDatabase(workspacePath: string, options: InitOptions): void {
  if (options.workspaceType !== 'hq' || options.includePMO === undefined) {
    throw new Error('initializeWorkspaceDatabase should only be called for HQ workspace type with defined PMO setting');
  }

  const themeConfig = THEMES[options.theme];
  
  // Create the database with workspace configuration
  const db = createWorkspaceDatabase(
    workspacePath,
    options.workspaceType,
    options.theme,
    themeConfig.workspaceDir,
    options.includePMO
  );
  
  db.close();
}

/**
 * Complete HQ initialization workflow
 */
export async function initializeHQ(options: InitOptions): Promise<void> {
  if (options.workspaceType !== 'hq') {
    throw new Error('initializeHQ should only be called for HQ workspace type');
  }

  const {
    hqPath,
    theme,
    selectedAgents,
    repos,
    includePMO,
    boardTemplate,
    pmoStorageType
  } = options;

  // All these fields are required for HQ type
  if (!hqPath || repos === undefined || includePMO === undefined || !boardTemplate) {
    throw new Error('Missing required fields for HQ initialization');
  }

  // Create basic structure
  createHQStructure(hqPath, theme);

  // Create database and workspace configuration (replaces createHQConfig)
  initializeWorkspaceDatabase(hqPath, options);

  // Create PMO if requested
  if (includePMO) {
    await createPMO(hqPath, boardTemplate, pmoStorageType || 'sqlite');
    // Note: PMO is tracked in workspace.has_pmo, no need for updateHQConfigWithPMO
  }

  // Handle repositories - add to file system AND database
  const addedRepos = await addRepositoriesToHQ(hqPath, repos);
  
  // Convert to database format
  const dbRepos = addedRepos.map(repoName => {
    const repoData = repos.find(r => path.basename(r.path).replace(/\.git$/, '') === repoName);
    return {
      name: repoName,
      path: `repos/${repoName}`,
      source_url: repoData?.path,
      action: repoData?.action
    };
  });
  
  addRepositoriesToDatabase(hqPath, dbRepos);

  // Add agents if selected - create worktrees AND add to database
  if (selectedAgents.length > 0) {
    const themeConfig = THEMES[theme];
    const workspacePath = path.join(hqPath, 'agents', themeConfig.workspaceDir);
    
    // Create physical worktrees
    await createAgentWorktrees(workspacePath, selectedAgents, hqPath);
    
    // Add to database
    addAgentsToDatabase(hqPath, selectedAgents, theme);
  }

  console.log(chalk.green(`\n✅ HQ created successfully at ${hqPath}`));
}

/**
 * Prompt for workspace location
 */
export async function promptForWorkspaceLocation(theme: string): Promise<string> {
  const themeConfig = THEMES[theme];
  const repoName = path.basename(process.cwd());
  const defaultPath = path.join('..', `${repoName}-${themeConfig.workspaceDir}`);

  while (true) {
    const { location } = await inquirer.prompt([{
      type: 'input',
      name: 'location',
      message: `Where to create workspace [press Enter for ${defaultPath}]:`,
      default: defaultPath,
    }]);

    const resolvedPath = path.resolve(location);

    // Check if location would be inside a git repo
    if (isInGitRepo(resolvedPath)) {
      console.log(chalk.red('Cannot create workspace inside a git repository.'));
      continue;
    }

    // Check if directory already exists
    if (fs.existsSync(resolvedPath)) {
      console.log(chalk.red(`Directory ${resolvedPath} already exists.`));
      continue;
    }

    return resolvedPath;
  }
}

/**
 * Create workspace-only structure
 */
export async function createWorkspaceOnly(theme: string, selectedAgents: string[], workspacePath: string): Promise<string> {
  const themeConfig = THEMES[theme];

  console.log(chalk.blue(`\n🔧 Creating ${path.basename(workspacePath)} workspace at ${workspacePath}...`));

  // Create workspace directory
  fs.mkdirSync(workspacePath, { recursive: true });
  
  // Create database with workspace configuration
  const db = createWorkspaceDatabase(
    workspacePath,
    'workspace',
    theme,
    themeConfig.workspaceDir,
    false // workspace-only never has PMO
  );
  
  // Add main repository to database (the current repo we're in)
  const mainRepoName = path.basename(process.cwd());
  const mainRepoData = {
    name: mainRepoName,
    path: mainRepoName, // For workspace-only, this is just the repo name
    source_url: process.cwd(),
    action: 'link' as const // Special action for workspace-only
  };
  
  addRepositoriesToDatabase(workspacePath, [mainRepoData]);

  // Add agents if selected - create worktrees AND add to database
  if (selectedAgents.length > 0) {
    // Create physical worktrees
    await createAgentWorktrees(workspacePath, selectedAgents);
    
    // Add to database
    addAgentsToDatabase(workspacePath, selectedAgents, theme);
  }

  db.close();

  console.log(chalk.green(`\n✅ Workspace created at ${workspacePath}`));
  return path.resolve(workspacePath);
}

/**
 * Show next steps to user and offer to change directory
 */
export async function showNextSteps(options: InitOptions, workspacePath?: string): Promise<void> {
  const themeConfig = THEMES[options.theme];
  const targetPath = options.workspaceType === 'workspace-only' ? workspacePath! : options.hqPath!;
  const relativePath = path.relative(process.cwd(), targetPath);
  const dirName = options.workspaceType === 'workspace-only' ? 'workspace' : 'HQ';
  
  // Show navigation instructions
  console.log(chalk.blue(`\n📂 Your ${dirName} is ready! Navigate to it:`));
  console.log(chalk.yellow(`  cd ${relativePath}`));
  
  // Ask if they want to see the next steps
  const { showNextSteps } = await inquirer.prompt([{
    type: 'list',
    name: 'showNextSteps',
    message: 'Show additional next steps?',
    choices: [
      { name: 'Yes', value: true },
      { name: 'No', value: false }
    ],
    default: false,
  }]);
  
  // Show additional next steps if requested
  if (showNextSteps) {
    const hasCommands = (options.selectedAgents.length === 0) || (options.workspaceType === 'hq' && options.includePMO);
    
    if (hasCommands) {
      console.log(chalk.cyan(`\nOnce you're in the ${dirName}, you can run:`));
      if (options.selectedAgents.length === 0) {
        console.log(chalk.white(`  prlt agent ${themeConfig.commands.add} <name>`));
      }
      
      if (options.workspaceType === 'hq' && options.includePMO) {
        console.log(chalk.white(`  prlt ticket create`));
      }
    } else {
      console.log(chalk.green(`\nYour ${dirName} is fully set up and ready to use!`));
    }
  }
}