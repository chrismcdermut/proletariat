import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import { getProjectRoot, getProjectName, isInitialized, loadConfig } from './index.js';
import { log } from '../utils/logger.js';
import { createWorkspace, loadWorkspaceConfig, addRepoToWorkspace } from '../workspace/index.js';

export async function upgradeConfig(): Promise<void> {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `prlt init` first.');
    return;
  }

  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  const oldConfigPath = path.join(projectRoot, '.proletariat', 'config.json');
  const newConfigPath = path.join(projectRoot, '.proletariat', 'repo.json');
  
  log.info('Checking for configuration updates...');
  
  let upgraded = false;
  
  // Migrate config.json to repo.json
  if (fs.existsSync(oldConfigPath) && !fs.existsSync(newConfigPath)) {
    log.info('Migrating config.json to repo.json...');
    
    try {
      const config = JSON.parse(fs.readFileSync(oldConfigPath, 'utf8'));
      
      // Remove the stored theme if it exists (no longer needed)
      if (config.theme) {
        delete config.theme;
        log.info('Removed cached theme data (now loaded dynamically)');
      }
      
      // Add config version
      config.configVersion = 2;  // Mark as new format
      
      // Write new config
      fs.writeFileSync(newConfigPath, JSON.stringify(config, null, 2));
      
      // Create backup of old config
      const backupPath = path.join(projectRoot, '.proletariat', 'config.json.backup');
      fs.renameSync(oldConfigPath, backupPath);
      
      log.success(`✅ Migrated to repo.json (backup saved as config.json.backup)`);
      log.info('💡 You can delete .proletariat/config.json.backup once everything is working');
      upgraded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Failed to migrate config: ${message}`);
      return;
    }
  } else if (fs.existsSync(newConfigPath)) {
    // Check if repo.json needs any updates
    try {
      const config = JSON.parse(fs.readFileSync(newConfigPath, 'utf8'));
      let needsUpdate = false;
      
      // Remove theme if it still exists
      if (config.theme) {
        delete config.theme;
        needsUpdate = true;
        log.info('Removed cached theme data from repo.json');
      }
      
      // Migrate workspace terminology to HQ (v0.2.0)
      if (config.layout) {
        if (config.layout.mode === 'workspace') {
          config.layout.mode = 'hq';
          needsUpdate = true;
          log.info('Updated layout mode from workspace to hq');
        }
        
        // Rename workspaceName to hqName
        if (config.layout.workspaceName) {
          config.layout.hqName = config.layout.workspaceName;
          delete config.layout.workspaceName;
          needsUpdate = true;
          log.info('Updated configuration field names for HQ terminology');
        }
      }
      
      // Add any future migrations here
      
      if (needsUpdate) {
        fs.writeFileSync(newConfigPath, JSON.stringify(config, null, 2));
        log.success('✅ Configuration updated');
        upgraded = true;
      } else {
        log.success('✅ Configuration is up to date');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Failed to update config: ${message}`);
    }
  }
  
  // Check for workspace configuration
  try {
    const repoConfig = loadConfig();
    
    // If layout mode is HQ (or legacy workspace), check if workspace config exists
    if ((repoConfig.layout?.mode === 'hq' || repoConfig.layout?.mode === 'workspace') && repoConfig.layout?.baseDir) {
      const workspaceConfigPath = path.join(repoConfig.layout.baseDir, '.proletariat', 'workspace.json');
      
      if (!fs.existsSync(workspaceConfigPath)) {
        // Workspace layout but no workspace config - offer to create one
        log.info(`Detected HQ layout at: ${repoConfig.layout.baseDir}`);
        
        const { createWorkspaceConfig } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'createWorkspaceConfig',
            message: 'Would you like to create an HQ config to track all repositories?',
            default: true
          }
        ]);
        
        if (createWorkspaceConfig) {
          const workspaceName = repoConfig.layout.hqName || repoConfig.layout.workspaceName || path.basename(repoConfig.layout.baseDir);
          const workspace = createWorkspace(repoConfig.layout.baseDir, workspaceName);
          
          // Add current repo to workspace
          const projectName = getProjectName();
          addRepoToWorkspace(repoConfig.layout.baseDir, projectName);
          
          log.success(`✅ Created HQ config for '${workspaceName}'`);
          log.info('💡 Run `prlt upgrade` in other repositories to add them to this HQ');
          upgraded = true;
        }
      } else {
        // Workspace config exists - make sure this repo is tracked
        const workspace = loadWorkspaceConfig(repoConfig.layout.baseDir);
        const projectName = getProjectName();
        
        if (workspace && !workspace.repositories.includes(projectName)) {
          addRepoToWorkspace(repoConfig.layout.baseDir, projectName);
          log.info(`Added '${projectName}' to workspace '${workspace.name}'`);
          upgraded = true;
        } else if (workspace) {
          log.info(`Part of workspace: ${workspace.name}`);
        }
      }
    } else {
      // Not using workspace layout
      const parentDir = path.dirname(projectRoot);
      const parentWorkspaceConfig = path.join(parentDir, '.proletariat', 'workspace.json');
      
      if (fs.existsSync(parentWorkspaceConfig)) {
        const workspace = loadWorkspaceConfig(parentDir);
        if (workspace) {
          log.info(`Part of workspace: ${workspace.name}`);
        }
      } else {
        log.info('💡 Tip: Use `prlt init --hq` to organize multiple repositories');
      }
    }
  } catch (error) {
    // Config loading might fail during upgrade
  }
  
  // Check if there's a parent directory with "-workspace" in the name that could be renamed to "-hq"
  const parentDir = path.dirname(projectRoot);
  const parentDirName = path.basename(parentDir);
  
  if (parentDirName.endsWith('-workspace')) {
    const newParentDirName = parentDirName.replace(/-workspace$/, '-hq');
    const newParentDir = path.join(path.dirname(parentDir), newParentDirName);
    
    if (!fs.existsSync(newParentDir)) {
      log.info(`Found workspace directory: ${parentDir}`);
      
      const { renameDirectory } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'renameDirectory',
          message: `Would you like to rename "${parentDirName}" to "${newParentDirName}" to match the new HQ terminology?`,
          default: false
        }
      ]);
      
      if (renameDirectory) {
        try {
          // Check for uncommitted changes
          const status = execSync('git status --porcelain', { cwd: projectRoot, encoding: 'utf8' }).trim();
          if (status.length > 0) {
            log.warning('Cannot rename directory: working tree has uncommitted changes. Commit or stash first.');
          } else {
            // Get list of all worktrees to update
            const worktreeList = execSync('git worktree list --porcelain', { encoding: 'utf8' });
            const worktrees = worktreeList.split('\n\n').filter(Boolean);
            const worktreeInfo: Array<{name: string, path: string}> = [];
            
            for (const wtInfo of worktrees) {
              const lines = wtInfo.split('\n');
              const wtPath = lines[0].replace('worktree ', '');
              if (wtPath !== projectRoot && wtPath.startsWith(parentDir)) {
                worktreeInfo.push({
                  name: path.basename(wtPath),
                  path: wtPath
                });
              }
            }
            
            // Rename the parent directory
            fs.renameSync(parentDir, newParentDir);
            log.success(`Renamed directory from ${parentDirName} to ${newParentDirName}`);
            
            // Update worktree references
            const newProjectRoot = path.join(newParentDir, path.basename(projectRoot));
            
            for (const wt of worktreeInfo) {
              const newWtPath = wt.path.replace(parentDir, newParentDir);
              const gitFile = path.join(newWtPath, '.git');
              
              if (fs.existsSync(gitFile)) {
                const newGitdir = `gitdir: ${newProjectRoot}/.git/worktrees/${wt.name}`;
                fs.writeFileSync(gitFile, newGitdir);
              }
              
              // Update gitdir file in .git/worktrees
              const gitdirFile = path.join(newProjectRoot, '.git', 'worktrees', wt.name, 'gitdir');
              if (fs.existsSync(gitdirFile)) {
                fs.writeFileSync(gitdirFile, `${newWtPath}/.git`);
              }
            }
            
            // Update config with new paths
            const configPath = path.join(newProjectRoot, '.proletariat', 'repo.json');
            if (fs.existsSync(configPath)) {
              const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              if (config.layout && config.layout.baseDir) {
                config.layout.baseDir = config.layout.baseDir.replace(parentDir, newParentDir);
              }
              if (config.workspaceDir) {
                config.workspaceDir = config.workspaceDir.replace(parentDir, newParentDir);
              }
              fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            }
            
            log.success('Updated all worktree references');
            log.warning(`⚠️  You need to change to the new directory: cd ${newProjectRoot}`);
            upgraded = true;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error(`Failed to rename directory: ${message}`);
        }
      }
    }
  }
  
  if (upgraded) {
    log.success('🎉 Configuration upgrade complete!');
  }
}