import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { DEFAULT_AGENTS_DIR, TEMP_AGENTS_DIR, ensureBuiltinThemes, getThemePersistentDir, getThemeEphemeralDir } from '../themes.js';
import { createAgentWorktrees } from '../agents/index.js';
import { addRepositoriesToHQ, isInGitRepo } from '../repos/index.js';
import {
  createPMO,
  PMOSetupResult,
} from '../pmo/index.js';
import {
  createWorkspaceDatabase,
  addRepositoriesToDatabase,
  addAgentsToDatabase,
  createTheme,
  addThemeNames,
  setActiveTheme
} from '../database/index.js';
import {
  ensureMachineConfigDir,
  registerHeadquarters,
  getOrganizations,
  createOrganization,
} from '../machine-config.js';

export interface HQConfig {
  type: 'hq';
  created: string;
  hqName: string;
  hasPMO: boolean;
  agents: string[];
  repos: string[];
}

export interface InitOptions {
  workspaceType: 'hq';
  hqName: string;
  hqPath: string;
  selectedAgents: string[];
  /** Suppress console output (for JSON/agent mode) */
  quiet?: boolean;
  repos?: Array<{ path: string; action: 'move' | 'clone' }>;
  // PMO options (from shared promptForPMOSetup)
  pmoSetup?: PMOSetupResult;
  // Selected theme ID (becomes HQ's active theme)
  themeId?: string;
  // Custom theme created during init
  customTheme?: {
    name: string;
    displayName: string;
    names: string[];
  };
  // Organization name for this HQ
  orgName?: string;
}

/**
 * Validate that HQ path is not inside a git repository or another HQ
 * Returns: { valid: true } or { valid: false, reason: string }
 */
export function validateHQLocation(location: string): { valid: boolean; reason?: string } {
  const resolvedPath = path.resolve(location);
  const parentDir = path.dirname(resolvedPath);

  // Check if inside a git repo
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: parentDir,
      stdio: 'pipe',
      encoding: 'utf-8'
    }).trim();

    // Use realpath to resolve symlinks and /private prefix on macOS
    const normalizedPath = fs.realpathSync(parentDir);
    const normalizedGitRoot = fs.realpathSync(gitRoot);

    if (normalizedPath.startsWith(normalizedGitRoot)) {
      return { valid: false, reason: 'inside-git' };
    }
  } catch {
    // Not in a git repo - this is fine
  }

  // Check if inside an existing HQ (look for .proletariat/config.json with type: 'hq')
  // Note: ~/.proletariat is the machine config, not an HQ, so we check the config type
  let checkDir = parentDir;
  while (checkDir !== '/' && checkDir !== path.dirname(checkDir)) {
    const configPath = path.join(checkDir, '.proletariat', 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.type === 'hq') {
          return { valid: false, reason: 'inside-hq' };
        }
      } catch {
        // Invalid JSON, skip
      }
    }
    checkDir = path.dirname(checkDir);
  }

  return { valid: true };
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
    message: 'HQ name (company, project, or team name):',
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
 * Check if current directory is inside an HQ and return the HQ root path
 */
function findContainingHQ(): string | null {
  let checkDir = process.cwd();
  while (checkDir !== '/' && checkDir !== path.dirname(checkDir)) {
    const configPath = path.join(checkDir, '.proletariat', 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.type === 'hq') {
          return checkDir;
        }
      } catch {
        // Invalid JSON, skip
      }
    }
    checkDir = path.dirname(checkDir);
  }
  return null;
}

/**
 * Prompt user for HQ location
 */
export async function promptForHQLocation(hqName: string): Promise<string> {
  const inGitRepo = isInGitRepo();
  const containingHQ = findContainingHQ();
  const folderName = `${hqName}-hq`;

  // Determine default path based on context
  let defaultPath: string;
  if (containingHQ) {
    // Inside an HQ - suggest sibling to the HQ
    defaultPath = path.join(path.dirname(containingHQ), folderName);
  } else if (inGitRepo) {
    // Inside a git repo - suggest sibling to repo
    defaultPath = path.join('..', folderName);
  } else {
    // Nowhere special - suggest subdirectory
    defaultPath = `./${folderName}`;
  }

  while (true) {
    const { location } = await inquirer.prompt([{
      type: 'input',
      name: 'location',
      message: `Where to create HQ [press Enter for ${defaultPath}]:`,
      default: defaultPath,
    }]);

    // Validate location
    const validation = validateHQLocation(location);
    if (!validation.valid) {
      if (validation.reason === 'inside-git') {
        console.log(chalk.red('Cannot create HQ inside a git repository.'));
      } else if (validation.reason === 'inside-hq') {
        console.log(chalk.red('Cannot create HQ inside another HQ. No HQ-ception allowed!'));
      }
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
 * Prompt user for organization selection or creation
 */
export async function promptForOrganization(): Promise<string> {
  const existingOrgs = getOrganizations();

  if (existingOrgs.length === 0) {
    // First organization - prompt for name
    const { orgName } = await inquirer.prompt([{
      type: 'input',
      name: 'orgName',
      message: 'Organization name (company or team):',
      validate: (input) => {
        if (!input.trim()) return 'Organization name is required';
        return true;
      },
    }]);

    createOrganization(orgName.trim());
    return orgName.trim();
  }

  // Show existing organizations with option to create new
  const { choice } = await inquirer.prompt([{
    type: 'list',
    name: 'choice',
    message: 'Select organization:',
    choices: [
      ...existingOrgs.map(o => ({ name: o.name, value: o.name })),
      new inquirer.Separator(),
      { name: '+ Create new organization', value: '__new__' },
    ],
  }]);

  if (choice === '__new__') {
    const { orgName } = await inquirer.prompt([{
      type: 'input',
      name: 'orgName',
      message: 'New organization name:',
      validate: (input) => {
        if (!input.trim()) return 'Organization name is required';
        return true;
      },
    }]);

    createOrganization(orgName.trim());
    return orgName.trim();
  }

  return choice;
}


/**
 * Create the basic HQ directory structure
 *
 * Structure:
 * my-hq/
 *   .proletariat/           # HQ config and database
 *   repos/                  # Repositories
 *   agents/
 *     staff/                # Persistent agents
 *     temp/                 # Ephemeral agents
 */
export function createHQStructure(hqPath: string, hqName: string, themeId?: string, quiet?: boolean): void {
  if (!quiet) console.log(chalk.blue(`\n🏗️  Creating HQ at ${hqPath}...`));

  // Get theme-specific directory names
  const persistentDir = getThemePersistentDir(themeId);
  const ephemeralDir = getThemeEphemeralDir(themeId);

  // Create directories
  fs.mkdirSync(hqPath, { recursive: true });
  fs.mkdirSync(path.join(hqPath, '.proletariat'), { recursive: true });
  fs.mkdirSync(path.join(hqPath, 'repos'), { recursive: true });
  fs.mkdirSync(path.join(hqPath, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(hqPath, 'agents', persistentDir), { recursive: true });
  fs.mkdirSync(path.join(hqPath, 'agents', ephemeralDir), { recursive: true });
}

/**
 * Create HQ database and config
 */
export function initializeHQDatabase(hqPath: string, options: InitOptions): void {
  if (!options.pmoSetup || !options.hqName) {
    throw new Error('initializeHQDatabase requires hqName and pmoSetup to be defined');
  }

  const hasPMO = options.pmoSetup.includePMO;

  // Create the database with HQ configuration
  const db = createWorkspaceDatabase(
    hqPath,
    'hq',
    options.hqName,
    hasPMO
  );

  db.close();

  // Create HQ config.json (required for HQ detection)
  const configPath = path.join(hqPath, '.proletariat', 'config.json');
  const config = {
    version: "1.0.0",
    schemaVersion: 1,
    type: 'hq',
    name: options.hqName
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/** @deprecated Use initializeHQDatabase instead */
export const initializeWorkspaceDatabase = initializeHQDatabase;

/**
 * Complete HQ initialization workflow
 */
export async function initializeHQ(options: InitOptions): Promise<void> {
  const {
    hqPath,
    hqName,
    selectedAgents,
    repos,
    pmoSetup,
    themeId,
    customTheme,
    orgName,
    quiet,
  } = options;

  // Helper to log only in non-quiet mode
  const log = (message: string) => {
    if (!quiet) console.log(message);
  };

  // All these fields are required for HQ type
  if (!hqPath || !hqName || repos === undefined || !pmoSetup) {
    throw new Error('Missing required fields for HQ initialization');
  }

  // Create basic structure (pass hqName and themeId for correct directory names)
  createHQStructure(hqPath, hqName, themeId, quiet);

  // Create database and HQ configuration
  initializeHQDatabase(hqPath, options);

  // Ensure builtin themes exist
  ensureBuiltinThemes(hqPath);

  // Save custom theme if one was created during init
  if (customTheme) {
    createTheme(hqPath, {
      id: customTheme.name,
      name: customTheme.name,
      displayName: customTheme.displayName,
      builtin: false,
    });
    addThemeNames(hqPath, customTheme.name, customTheme.names);
    log(chalk.blue(`Created custom theme: ${customTheme.displayName}`));
  }

  // Set active theme if one was selected
  if (themeId) {
    setActiveTheme(hqPath, themeId);
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

  // Create PMO if requested
  if (pmoSetup.includePMO) {
    await createPMO({
      hqPath,
      location: pmoSetup.location,
      boardTemplate: pmoSetup.boardTemplate,
      boardName: pmoSetup.boardName,
      columns: pmoSetup.columns,
      storageType: pmoSetup.storageType,
    });
  }

  // Add agents if selected - create worktrees AND add to database
  if (selectedAgents.length > 0) {
    const persistentDir = getThemePersistentDir(themeId);
    const agentsPath = path.join(hqPath, 'agents', persistentDir);

    // Create physical worktrees
    await createAgentWorktrees(agentsPath, selectedAgents, hqPath);

    // Add to database
    addAgentsToDatabase(hqPath, selectedAgents);
  }

  // Register headquarters in machine config
  ensureMachineConfigDir();
  registerHeadquarters(hqPath, hqName, true, orgName);
  log(chalk.gray(`Registered headquarters in ~/.proletariat/config.json`));

  log(chalk.green(`\n✅ Headquarters created successfully at ${hqPath}`));
}

/**
 * Show next steps to user
 */
export async function showNextSteps(options: InitOptions): Promise<void> {
  const relativePath = path.relative(process.cwd(), options.hqPath);
  const hasPMO = options.pmoSetup?.includePMO ?? false;

  // Show navigation instructions
  console.log(chalk.blue(`\n📂 Your headquarters is ready! Navigate to it:`));
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
    default: true,
  }]);

  // Show additional next steps if requested
  if (showNextSteps) {
    const hasCommands = (options.selectedAgents.length === 0) || hasPMO;

    if (hasCommands) {
      console.log(chalk.cyan(`\nOnce you're in the headquarters, you can run:`));
      if (options.selectedAgents.length === 0) {
        console.log(chalk.white(`  prlt agent add <name>`));
      }

      if (hasPMO) {
        console.log(chalk.white(`  prlt ticket create`));
      }
    } else {
      console.log(chalk.green(`\nYour headquarters is fully set up and ready to use!`));
    }
  }
}