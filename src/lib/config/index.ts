import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getTheme } from '../themes/index.js';
import { Theme, ProjectConfig } from '../../types/index.js';

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
  return path.join(projectRoot, '.proletariat', 'config.json');
}

export function getWorkspaceDir(theme: Theme): string {
  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  return path.join(path.dirname(projectRoot), `${projectName}-${theme.directory}`);
}

export function isInitialized(): boolean {
  return fs.existsSync(getConfigPath());
}

export function loadConfig(): ProjectConfig {
  if (!isInitialized()) {
    throw new Error('Proletariat not initialized! Run `proletariat init` first.');
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