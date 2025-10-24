import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { getProjectRoot, getProjectName, loadConfig, saveConfig, isInitialized } from '../config/index.js';
import { log } from '../utils/logger.js';

export async function migrateToHQ(hqName?: string): Promise<void> {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `prlt init` first.');
    return;
  }

  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  
  // Check if already in HQ
  if (config.layout?.mode === 'hq' || config.layout?.mode === 'workspace') {
    const expectedPath = path.join(config.layout.baseDir, projectName);
    if (path.resolve(projectRoot) === path.resolve(expectedPath)) {
      log.success('Repository is already in the HQ directory!');
      return;
    }
  }
  
  log.info('This will move your repository into an HQ directory for better organization.');
  
  // Determine target path
  let targetPath: string;
  let hqDir: string;
  
  if ((config.layout?.mode === 'hq' || config.layout?.mode === 'workspace') && config.layout.baseDir) {
    hqDir = config.layout.baseDir;
    targetPath = path.join(hqDir, projectName);
  } else {
    // If not HQ mode, create an HQ structure
    const parentDir = path.dirname(projectRoot);
    const hqNameToUse = hqName || `${projectName}-hq`;
    hqDir = path.join(parentDir, hqNameToUse);
    targetPath = path.join(hqDir, projectName);
    
    log.info(`Will create HQ directory: ${hqDir}`);
  }
  
  // Check if target exists
  if (fs.existsSync(targetPath)) {
    log.error(`Target path already exists: ${targetPath}`);
    log.info('Please remove or rename the existing directory first.');
    return;
  }
  
  // Check for uncommitted changes in main repo
  try {
    const status = execSync('git status --porcelain', { cwd: projectRoot, encoding: 'utf8' }).trim();
    if (status.length > 0) {
      log.warning('Main repository has uncommitted changes.');
      const { continueWithChanges } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueWithChanges',
          message: 'Continue with uncommitted changes?',
          default: false
        }
      ]);
      
      if (!continueWithChanges) {
        log.info('Migration cancelled. Please commit or stash your changes first.');
        return;
      }
    }
  } catch (error) {
    log.error('Failed to check git status');
    return;
  }
  
  // Get list of current worktrees
  let worktreeInfo: Array<{name: string, path: string}> = [];
  try {
    const worktreeList = execSync('git worktree list --porcelain', { encoding: 'utf8' });
    const worktrees = worktreeList.split('\n\n').filter(Boolean);
    
    for (const wtInfo of worktrees) {
      const lines = wtInfo.split('\n');
      const wtPath = lines[0].replace('worktree ', '');
      
      // Skip the main worktree
      if (wtPath === projectRoot) continue;
      
      worktreeInfo.push({
        name: path.basename(wtPath),
        path: wtPath
      });
    }
  } catch (error) {
    log.error('Failed to get worktree list');
    return;
  }
  
  console.log('\n' + chalk.yellow('📋 Migration Plan:'));
  console.log(`  • Move repository from: ${chalk.dim(projectRoot)}`);
  console.log(`  • Move repository to:   ${chalk.green(targetPath)}`);
  console.log(`  • Worktrees to update:  ${chalk.cyan(worktreeInfo.length)}`);
  console.log(chalk.dim('  Note: All worktrees and their work will be preserved'));
  
  const { confirmMigrate } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmMigrate',
      message: 'Proceed with migration?',
      default: true
    }
  ]);
  
  if (!confirmMigrate) {
    log.info('Migration cancelled.');
    return;
  }
  
  log.info('Starting migration...');
  
  // Step 1: Create target directory if needed
  log.info('Step 1/3: Preparing target directory...');
  const targetParent = path.dirname(targetPath);
  if (!fs.existsSync(targetParent)) {
    fs.mkdirSync(targetParent, { recursive: true });
    log.success(`Created directory: ${targetParent}`);
  }
  
  // Step 2: Move the repository
  log.info('Step 2/3: Moving repository...');
  try {
    fs.renameSync(projectRoot, targetPath);
    log.success(`Moved repository to: ${targetPath}`);
  } catch (error) {
    log.error(`Failed to move repository: ${error}`);
    return;
  }
  
  // Step 3: Update worktree references
  log.info('Step 3/3: Updating worktree references...');
  
  // Update the .git files in each worktree to point to the new location
  for (const wt of worktreeInfo) {
    const gitFile = path.join(wt.path, '.git');
    if (fs.existsSync(gitFile)) {
      const newGitdir = `gitdir: ${targetPath}/.git/worktrees/${wt.name}`;
      fs.writeFileSync(gitFile, newGitdir);
      log.success(`Updated reference: ${wt.name}`);
    }
  }
  
  // Update the gitdir files in .git/worktrees/* to point back to worktrees
  const worktreesDir = path.join(targetPath, '.git', 'worktrees');
  if (fs.existsSync(worktreesDir)) {
    const worktreeDirs = fs.readdirSync(worktreesDir);
    for (const wtName of worktreeDirs) {
      const gitdirFile = path.join(worktreesDir, wtName, 'gitdir');
      if (fs.existsSync(gitdirFile)) {
        // Find the corresponding worktree path
        const wt = worktreeInfo.find(w => w.name === wtName);
        if (wt) {
          fs.writeFileSync(gitdirFile, `${wt.path}/.git`);
          log.success(`Updated internal reference: ${wtName}`);
        }
      }
    }
  }
  
  // Update config if needed
  if (config.layout?.mode !== 'hq' && config.layout?.mode !== 'workspace') {
    const hqNameFromPath = path.basename(targetParent);
    config.layout = {
      mode: 'hq',
      baseDir: targetParent,
      hqName: hqNameFromPath
    };
    
    // Save config to new location
    const configPath = path.join(targetPath, '.proletariat', 'repo.json');
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    log.success('Updated configuration for HQ layout');
  }
  
  log.success('✨ Migration complete!');
  console.log('\n' + chalk.yellow('⚠️  Important: You need to change to the new directory:'));
  console.log(chalk.cyan(`  cd ${targetPath}`));
  console.log('\nThen you can continue using prlt commands from there.');
  console.log('All your worktrees and uncommitted work have been preserved.');
}