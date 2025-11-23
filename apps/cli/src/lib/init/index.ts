import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { THEMES } from '../themes.js';
import { addAgentsToHQ, createAgentWorktrees } from '../agents/index.js';
import { addRepositoriesToHQ, updateHQRepos, isInGitRepo } from '../repos/index.js';
import { createPMO, updateHQConfigWithPMO } from '../pmo/index.js';

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
 * Create HQ configuration file
 */
export function createHQConfig(hqPath: string, options: InitOptions): void {
  if (options.workspaceType !== 'hq' || options.includePMO === undefined) {
    throw new Error('createHQConfig should only be called for HQ workspace type with defined PMO setting');
  }

  const themeConfig = THEMES[options.theme];
  
  const hqConfig: HQConfig = {
    type: 'hq',
    created: new Date().toISOString(),
    theme: options.theme,
    workspaceName: themeConfig.workspaceDir,
    hasPMO: options.includePMO,
    agents: [], // Will be populated when agents are added
    repos: [], // Will be populated when repos are added
  };

  fs.writeFileSync(
    path.join(hqPath, '.proletariat', 'config.json'),
    JSON.stringify(hqConfig, null, 2)
  );
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
    boardTemplate 
  } = options;

  // All these fields are required for HQ type
  if (!hqPath || repos === undefined || includePMO === undefined || !boardTemplate) {
    throw new Error('Missing required fields for HQ initialization');
  }

  // Create basic structure
  createHQStructure(hqPath, theme);

  // Create config
  createHQConfig(hqPath, options);

  // Create PMO if requested
  if (includePMO) {
    await createPMO(hqPath, boardTemplate);
    updateHQConfigWithPMO(hqPath);
  }

  // Handle repositories
  const addedRepos = await addRepositoriesToHQ(hqPath, repos);
  updateHQRepos(hqPath, addedRepos);

  // Add agents if selected
  if (selectedAgents.length > 0) {
    const themeConfig = THEMES[theme];
    const workspacePath = path.join(hqPath, 'agents', themeConfig.workspaceDir);
    await createAgentWorktrees(workspacePath, selectedAgents, hqPath);
  }

  console.log(chalk.green(`\n✅ HQ created successfully at ${hqPath}`));
}

/**
 * Prompt for workspace location
 */
export async function promptForWorkspaceLocation(theme: string): Promise<string> {
  const themeConfig = THEMES[theme];
  const defaultPath = path.join('..', 'agents', themeConfig.workspaceDir);

  while (true) {
    const { location } = await inquirer.prompt([{
      type: 'input',
      name: 'location',
      message: `Where to create ${themeConfig.workspaceDir} workspace [press Enter for ${defaultPath}]:`,
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

  console.log(chalk.blue(`\n🔧 Creating agents/${themeConfig.workspaceDir} workspace at ${workspacePath}...`));

  // Create workspace directory
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(path.join(workspacePath, '.proletariat'), { recursive: true });

  // Create workspace config
  const config = {
    type: 'workspace',
    created: new Date().toISOString(),
    theme: theme,
    mainRepo: process.cwd(),
    agents: selectedAgents,
  };

  fs.writeFileSync(
    path.join(workspacePath, '.proletariat', 'config.json'),
    JSON.stringify(config, null, 2)
  );

  // Add agents if selected
  if (selectedAgents.length > 0) {
    await createAgentWorktrees(workspacePath, selectedAgents);
  }

  console.log(chalk.green(`\n✅ Workspace created at ${workspacePath}`));
  return path.resolve(workspacePath);
}

/**
 * Show next steps to user
 */
export function showNextSteps(options: InitOptions, workspacePath?: string): void {
  const themeConfig = THEMES[options.theme];
  
  console.log(chalk.gray(`\nNext steps:`));
  
  if (options.workspaceType === 'workspace-only') {
    console.log(chalk.gray(`  cd ${path.relative(process.cwd(), workspacePath!)}`));
    
    if (options.selectedAgents.length === 0) {
      console.log(chalk.gray(`  prlt agent ${themeConfig.commands.add} <name>`));
    }
  } else {
    console.log(chalk.gray(`  cd ${path.relative(process.cwd(), options.hqPath!)}`));
    
    if (options.selectedAgents.length === 0) {
      console.log(chalk.gray(`  prlt agent ${themeConfig.commands.add} <name>`));
    }
    
    if (options.includePMO) {
      console.log(chalk.gray(`  prlt ticket create`));
    }
  }
}