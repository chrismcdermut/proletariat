import * as fs from 'fs';
import * as path from 'path';

export interface WorkspaceConfig {
  version: string;
  name: string;
  created: string;
  repositories: string[];
}

export function findWorkspaceRoot(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;
  
  while (currentDir !== root) {
    const workspaceConfig = path.join(currentDir, '.proletariat', 'workspace.json');
    if (fs.existsSync(workspaceConfig)) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  
  return null;
}

export function loadWorkspaceConfig(workspaceRoot: string): WorkspaceConfig | null {
  const configPath = path.join(workspaceRoot, '.proletariat', 'workspace.json');
  
  if (!fs.existsSync(configPath)) {
    return null;
  }
  
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    return null;
  }
}

export function saveWorkspaceConfig(workspaceRoot: string, config: WorkspaceConfig): void {
  const configDir = path.join(workspaceRoot, '.proletariat');
  const configPath = path.join(configDir, 'workspace.json');
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function createWorkspace(workspaceRoot: string, name: string): WorkspaceConfig {
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true });
  }
  
  const config: WorkspaceConfig = {
    version: '0.1.4',  // CLI version when workspace feature was added
    name,
    created: new Date().toISOString(),
    repositories: []
  };
  
  saveWorkspaceConfig(workspaceRoot, config);
  return config;
}

export function addRepoToWorkspace(workspaceRoot: string, repoName: string): void {
  const config = loadWorkspaceConfig(workspaceRoot);
  
  if (config && !config.repositories.includes(repoName)) {
    config.repositories.push(repoName);
    saveWorkspaceConfig(workspaceRoot, config);
  }
}

export function detectExistingWorkspaces(currentDir: string): string[] {
  const parentDir = path.dirname(currentDir);
  const workspaces: string[] = [];
  
  try {
    const entries = fs.readdirSync(parentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const possibleWorkspace = path.join(parentDir, entry.name);
        const configPath = path.join(possibleWorkspace, '.proletariat', 'workspace.json');
        
        if (fs.existsSync(configPath)) {
          workspaces.push(possibleWorkspace);
        }
      }
    }
  } catch (error) {
    // Parent directory might not be readable
  }
  
  return workspaces;
}