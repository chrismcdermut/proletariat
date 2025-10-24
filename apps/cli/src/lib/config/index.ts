import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getTheme } from '../themes/index.js';
import { Theme, ProjectConfig, InitOptions, WorkspaceLayout } from '../../types/index.js';

export function getProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error('Not in a git repository! Proletariat requires version control.');
  }
}

export function getProjectName(): string {
  const projectRoot = getProjectRoot();
  return path.basename(projectRoot);
}

export function getConfigPath(): string {
  const projectRoot = getProjectRoot();
  const newPath = path.join(projectRoot, '.proletariat', 'repo.json');
  const oldPath = path.join(projectRoot, '.proletariat', 'config.json');
  
  // Check for new repo.json first, then fall back to config.json
  if (fs.existsSync(newPath)) {
    return newPath;
  } else if (fs.existsSync(oldPath)) {
    return oldPath;
  }
  
  // For new installations, use repo.json
  return newPath;
}

export interface WorkspaceResolution {
  workspaceDir: string;
  layout: WorkspaceLayout;
}

export function resolveWorkspace(theme: Theme, options: InitOptions = {}): WorkspaceResolution {
  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  const parentDir = path.dirname(projectRoot);

  let mode: WorkspaceLayout['mode'] = 'sibling';
  let baseDir = parentDir;
  let workspaceName: string | undefined;
  let workspaceDir: string;

  if (options.workspaceRoot) {
    workspaceDir = path.resolve(projectRoot, options.workspaceRoot);
    baseDir = path.dirname(workspaceDir);
    mode = 'custom';
  } else if (options.workspace) {
    workspaceName = options.workspace;
    baseDir = path.join(parentDir, workspaceName);
    workspaceDir = path.join(baseDir, `${projectName}-${theme.directory}`);
    mode = 'workspace';
  } else {
    workspaceDir = path.join(parentDir, `${projectName}-${theme.directory}`);
  }

  return {
    workspaceDir,
    layout: { mode, baseDir, workspaceName }
  };
}

export function isInitialized(): boolean {
  const projectRoot = getProjectRoot();
  const newPath = path.join(projectRoot, '.proletariat', 'repo.json');
  const oldPath = path.join(projectRoot, '.proletariat', 'config.json');
  
  return fs.existsSync(newPath) || fs.existsSync(oldPath);
}

export function migrateConfigIfNeeded(): boolean {
  const projectRoot = getProjectRoot();
  const newPath = path.join(projectRoot, '.proletariat', 'repo.json');
  const oldPath = path.join(projectRoot, '.proletariat', 'config.json');
  
  // If old config exists but new doesn't, copy to new location
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    const config = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
    fs.writeFileSync(newPath, JSON.stringify(config, null, 2));
    // Keep old file for now to ensure compatibility
    return true;
  }
  return false;
}

export function loadConfig(): ProjectConfig {
  if (!isInitialized()) {
    throw new Error('Proletariat not initialized! Run `prlt init` first.');
  }
  
  const configPath = getConfigPath();
  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ProjectConfig;
  return {
    ...rawConfig,
    theme: getTheme(rawConfig.themeName)
  };
}

export function saveConfig(configData: ProjectConfig): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
}