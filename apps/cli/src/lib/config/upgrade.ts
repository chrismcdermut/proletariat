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
    
    // If layout mode is workspace, check if workspace config exists
    if (repoConfig.layout?.mode === 'workspace' && repoConfig.layout?.baseDir) {
      const workspaceConfigPath = path.join(repoConfig.layout.baseDir, '.proletariat', 'workspace.json');
      
      if (!fs.existsSync(workspaceConfigPath)) {
        // Workspace layout but no workspace config - offer to create one
        log.info(`Detected workspace layout at: ${repoConfig.layout.baseDir}`);
        
        const { createWorkspaceConfig } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'createWorkspaceConfig',
            message: 'Would you like to create a workspace config to track all repositories?',
            default: true
          }
        ]);
        
        if (createWorkspaceConfig) {
          const workspaceName = repoConfig.layout.workspaceName || path.basename(repoConfig.layout.baseDir);
          const workspace = createWorkspace(repoConfig.layout.baseDir, workspaceName);
          
          // Add current repo to workspace
          const projectName = getProjectName();
          addRepoToWorkspace(repoConfig.layout.baseDir, projectName);
          
          log.success(`✅ Created workspace config for '${workspaceName}'`);
          log.info('💡 Run `prlt upgrade` in other repositories to add them to this workspace');
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
        log.info('💡 Tip: Use `prlt init --workspace` to organize multiple repositories');
      }
    }
  } catch (error) {
    // Config loading might fail during upgrade
  }
  
  if (upgraded) {
    log.success('🎉 Configuration upgrade complete!');
  }
}