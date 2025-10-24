import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getProjectRoot, loadConfig, isInitialized } from '../config/index.js';
import { log } from '../utils/logger.js';

export function repairWorktrees(): void {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `prlt init` first.');
    return;
  }

  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const repoGitDir = path.join(projectRoot, '.git');
  
  log.info('Repairing worktree references...');
  
  let repairedCount = 0;
  let failedCount = 0;
  let removedCount = 0;
  
  // Get list of worktrees from git
  try {
    const worktreeList = execSync('git worktree list --porcelain', { encoding: 'utf8' });
    const worktrees = worktreeList.split('\n\n').filter(Boolean);
    
    for (const worktreeInfo of worktrees) {
      const lines = worktreeInfo.split('\n');
      const registeredPath = lines[0].replace('worktree ', '');
      
      // Skip the main worktree
      if (registeredPath === projectRoot) continue;
      
      const agentName = path.basename(registeredPath);
      
      // Check if the registered path exists
      if (!fs.existsSync(registeredPath)) {
        // Path doesn't exist - check if it moved to the new location
        const expectedPath = path.join(config.workspaceDir, agentName);
        
        if (fs.existsSync(expectedPath)) {
          log.info(`Detected moved worktree: ${agentName}`);
          
          // Remove the old registration
          try {
            execSync(`git worktree remove "${registeredPath}" --force`, { encoding: 'utf8' });
            removedCount++;
            log.info(`Removed old registration for: ${agentName}`);
          } catch (e) {
            // Try pruning if remove fails
            execSync('git worktree prune', { encoding: 'utf8' });
          }
          
          // Re-add with correct path
          const branchName = `${agentName}-workspace`;
          try {
            execSync(`git worktree add "${expectedPath}" "${branchName}"`, { encoding: 'utf8' });
            log.success(`Re-registered worktree: ${agentName} at ${expectedPath}`);
            repairedCount++;
          } catch (e) {
            log.warning(`Could not re-add ${agentName} - branch may not exist`);
            failedCount++;
          }
        } else {
          log.warning(`Worktree path missing and not found in expected location: ${agentName}`);
          // Prune the missing worktree
          execSync('git worktree prune', { encoding: 'utf8' });
          failedCount++;
        }
      } else {
        // Path exists, check if .git file is correct
        const gitFile = path.join(registeredPath, '.git');
        
        if (fs.existsSync(gitFile)) {
          const currentContent = fs.readFileSync(gitFile, 'utf8').trim();
          const expectedContent = `gitdir: ${repoGitDir}/worktrees/${agentName}`;
          
          if (currentContent !== expectedContent) {
            // Fix the reference
            fs.writeFileSync(gitFile, expectedContent);
            log.success(`Repaired: ${agentName}`);
            repairedCount++;
          } else {
            log.info(`Already correct: ${agentName}`);
          }
          
          // Also check and fix the gitdir file in .git/worktrees
          const gitdirFile = path.join(repoGitDir, 'worktrees', agentName, 'gitdir');
          if (fs.existsSync(gitdirFile)) {
            const expectedGitdir = `${registeredPath}/.git`;
            const currentGitdir = fs.readFileSync(gitdirFile, 'utf8').trim();
            
            if (currentGitdir !== expectedGitdir) {
              fs.writeFileSync(gitdirFile, expectedGitdir);
              log.info(`Fixed gitdir reference for: ${agentName}`);
            }
          }
        } else {
          log.warning(`Missing .git file: ${agentName}`);
          failedCount++;
        }
      }
    }
    
    if (removedCount > 0) {
      log.info(`Removed ${removedCount} outdated registration(s)`);
    }
    if (repairedCount > 0) {
      log.success(`✅ Repaired ${repairedCount} worktree reference(s)`);
    }
    if (failedCount > 0) {
      log.warning(`⚠️  ${failedCount} worktree(s) could not be repaired`);
    }
    if (repairedCount === 0 && failedCount === 0 && removedCount === 0) {
      log.success('All worktrees are already correctly configured!');
    }
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to repair worktrees: ${message}`);
  }
}

export function checkWorktreeHealth(): void {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `prlt init` first.');
    return;
  }

  const config = loadConfig();
  const projectRoot = getProjectRoot();
  
  log.info('Checking worktree health...');
  
  let healthyCount = 0;
  let brokenCount = 0;
  
  try {
    const worktreeList = execSync('git worktree list --porcelain', { encoding: 'utf8' });
    const worktrees = worktreeList.split('\n\n').filter(Boolean);
    
    for (const worktreeInfo of worktrees) {
      const lines = worktreeInfo.split('\n');
      const worktreePath = lines[0].replace('worktree ', '');
      
      // Skip the main worktree
      if (worktreePath === projectRoot) continue;
      
      const agentName = path.basename(worktreePath);
      
      // Test if we can run git commands in the worktree
      try {
        execSync(`git -C "${worktreePath}" status`, { encoding: 'utf8', stdio: 'ignore' });
        log.agent(agentName, '✅ Healthy', config.theme!);
        healthyCount++;
      } catch {
        log.agent(agentName, '❌ Broken - needs repair', config.theme!);
        brokenCount++;
      }
    }
    
    log.info(`Summary: ${healthyCount} healthy, ${brokenCount} broken`);
    
    if (brokenCount > 0) {
      log.warning('Run `prlt repair` to fix broken worktrees');
    }
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to check worktree health: ${message}`);
  }
}