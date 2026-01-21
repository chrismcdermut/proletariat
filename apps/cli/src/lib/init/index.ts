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
import {
  suggestPrefixes,
  validatePrefix,
  isPrefixUnique,
} from './workstream-prefix.js';

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
  addSuffix?: boolean;
  selectedAgents: string[];
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
  // Workstream prefix for entity IDs (e.g., 'PLT' for PLT-TKT-001)
  workstreamPrefix?: string;
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
  } catch {
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
 * Prompt user for workstream prefix
 */
export async function promptForWorkstreamPrefix(
  workstreamName: string,
  orgName: string | null
): Promise<string> {
  const suggestions = suggestPrefixes(workstreamName);

  // Build choices from suggestions
  const choices = [
    ...suggestions.map((prefix, index) => ({
      name: index === 0 ? `${prefix} (recommended)` : prefix,
      value: prefix,
    })),
  ];

  // Show example IDs
  const examplePrefix = suggestions[0] || workstreamName.substring(0, 3).toUpperCase();
  console.log(chalk.gray(`\n  Example IDs: ${examplePrefix}-TKT-001, ${examplePrefix}-EPIC-001\n`));

  const { prefixChoice } = await inquirer.prompt([{
    type: 'list',
    name: 'prefixChoice',
    message: 'Workstream prefix for entity IDs:',
    choices: [
      ...choices,
      new inquirer.Separator(),
      { name: 'Custom (enter your own)', value: '__custom__' },
    ],
    default: suggestions[0],
  }]);

  let prefix = prefixChoice;

  if (prefixChoice === '__custom__') {
    const { customPrefix } = await inquirer.prompt([{
      type: 'input',
      name: 'customPrefix',
      message: 'Enter custom prefix (2-4 uppercase letters):',
      transformer: (input: string) => input.toUpperCase(),
      validate: (input: string) => {
        const upper = input.toUpperCase();
        const validation = validatePrefix(upper);
        if (!validation.valid) return validation.error!;
        if (!isPrefixUnique(upper, orgName)) {
          return `Prefix "${upper}" is already used in this organization`;
        }
        return true;
      },
    }]);
    prefix = customPrefix.toUpperCase();
  }

  // Validate uniqueness for suggested prefixes too
  if (prefixChoice !== '__custom__' && !isPrefixUnique(prefix, orgName)) {
    console.log(chalk.yellow(`Prefix "${prefix}" is already in use. Please choose a different one.`));
    return promptForWorkstreamPrefix(workstreamName, orgName);
  }

  return prefix;
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
export function createHQStructure(hqPath: string, hqName: string, themeId?: string): void {
  console.log(chalk.blue(`\n🏗️  Creating HQ at ${hqPath}...`));

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
    hasPMO,
    options.workstreamPrefix
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
  } = options;

  // All these fields are required for HQ type
  if (!hqPath || !hqName || repos === undefined || !pmoSetup) {
    throw new Error('Missing required fields for HQ initialization');
  }

  // Create basic structure (pass hqName and themeId for correct directory names)
  createHQStructure(hqPath, hqName, themeId);

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
    console.log(chalk.blue(`Created custom theme: ${customTheme.displayName}`));
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
  console.log(chalk.gray(`Registered headquarters in ~/.proletariat/config.json`));

  console.log(chalk.green(`\n✅ Headquarters created successfully at ${hqPath}`));
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
    default: false,
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