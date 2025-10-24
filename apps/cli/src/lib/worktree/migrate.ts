import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { getProjectRoot, getProjectName, loadConfig, saveConfig, isInitialized } from '../config/index.js';
import { log } from '../utils/logger.js';
import { repairWorktrees } from './repair.js';

export async function migrateToWorkspace(): Promise<void> {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `prlt init` first.');
    return;
  }

  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  
  // Check if already in workspace
  if (config.layout?.mode === 'workspace') {
    const expectedPath = path.join(config.layout.baseDir, projectName);
    if (path.resolve(projectRoot) === path.resolve(expectedPath)) {
      log.success('Repository is already in the workspace directory!');
      return;
    }
  }
  
  log.info('This will move your repository into the workspace directory alongside your worktrees.');
  
  // Determine target path
  let targetPath: string;
  if (config.layout?.mode === 'workspace' && config.layout.baseDir) {
    targetPath = path.join(config.layout.baseDir, projectName);
  } else {
    // If not workspace mode, create a workspace structure
    const parentDir = path.dirname(projectRoot);
    const workspaceName = `${projectName}-workspace`;
    const workspaceDir = path.join(parentDir, workspaceName);
    targetPath = path.join(workspaceDir, projectName);
    
    log.info(`Will create workspace: ${workspaceDir}`);
  }
  
  // Check if target exists
  if (fs.existsSync(targetPath)) {
    log.error(`Target path already exists: ${targetPath}`);
    log.info('Please remove or rename the existing directory first.');
    return;
  }
  
  // Check for uncommitted changes
  try {
    const status = execSync('git status --porcelain', { cwd: projectRoot, encoding: 'utf8' }).trim();
    if (status.length > 0) {
      log.error('Cannot migrate: working tree has uncommitted changes.');
      log.info('Please commit or stash your changes first.');
      return;
    }
  } catch (error) {
    log.error('Failed to check git status');
    return;
  }
  
  // Get list of current worktrees
  let worktreeInfo: Array<{name: string, path: string, branch: string}> = [];
  try {
    const worktreeList = execSync('git worktree list --porcelain', { encoding: 'utf8' });
    const worktrees = worktreeList.split('\n\n').filter(Boolean);
    
    for (const wtInfo of worktrees) {
      const lines = wtInfo.split('\n');
      const wtPath = lines[0].replace('worktree ', '');
      
      // Skip the main worktree
      if (wtPath === projectRoot) continue;
      
      const branch = lines.find(l => l.startsWith('branch '))?.replace('branch ', '') || '';
      worktreeInfo.push({
        name: path.basename(wtPath),
        path: wtPath,
        branch: branch.replace('refs/heads/', '')
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
  
  // Step 1: Remove all worktrees
  log.info('Step 1/4: Removing worktrees temporarily...');
  for (const wt of worktreeInfo) {
    try {
      execSync(`git worktree remove "${wt.path}"`, { cwd: projectRoot });
      log.success(`Removed worktree: ${wt.name}`);
    } catch (error) {
      log.warning(`Could not remove ${wt.name}, will try to continue...`);
    }
  }
  
  // Step 2: Create target directory if needed
  log.info('Step 2/4: Preparing target directory...');
  const targetParent = path.dirname(targetPath);
  if (!fs.existsSync(targetParent)) {
    fs.mkdirSync(targetParent, { recursive: true });
    log.success(`Created directory: ${targetParent}`);
  }
  
  // Step 3: Move the repository
  log.info('Step 3/4: Moving repository...');
  try {
    fs.renameSync(projectRoot, targetPath);
    log.success(`Moved repository to: ${targetPath}`);
  } catch (error) {
    log.error(`Failed to move repository: ${error}`);
    
    // Try to restore worktrees
    log.info('Attempting to restore worktrees...');
    for (const wt of worktreeInfo) {
      try {
        execSync(`git worktree add -b "${wt.branch}" "${wt.path}" "${wt.branch}"`, { cwd: projectRoot });
      } catch {}
    }
    return;
  }
  
  // Step 4: Recreate worktrees from new location
  log.info('Step 4/4: Recreating worktrees...');
  for (const wt of worktreeInfo) {
    try {
      // Check if branch exists
      const branches = execSync('git branch -a', { cwd: targetPath, encoding: 'utf8' });
      
      if (branches.includes(wt.branch)) {
        // Branch exists, just add worktree
        execSync(`git worktree add "${wt.path}" "${wt.branch}"`, { cwd: targetPath });
      } else {
        // Create new branch
        execSync(`git worktree add -b "${wt.branch}" "${wt.path}" main`, { cwd: targetPath });
      }
      log.success(`Recreated worktree: ${wt.name}`);
    } catch (error) {
      log.warning(`Could not recreate ${wt.name}: ${error}`);
    }
  }
  
  // Update config if needed
  if (config.layout?.mode !== 'workspace') {
    const workspaceName = path.basename(targetParent);
    config.layout = {
      mode: 'workspace',
      baseDir: targetParent,
      workspaceName: workspaceName
    };
    saveConfig(config);
    log.success('Updated configuration for workspace layout');
  }
  
  log.success('✨ Migration complete!');
  console.log('\n' + chalk.yellow('⚠️  Important: You need to change to the new directory:'));
  console.log(chalk.cyan(`  cd ${targetPath}`));
  console.log('\nThen you can continue using prlt commands from there.');
}