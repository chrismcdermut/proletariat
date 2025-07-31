const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getTheme } = require('../themes');

function getProjectRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error('Not in a git repository! Proletariat requires version control.');
  }
}

function getProjectName() {
  const projectRoot = getProjectRoot();
  return path.basename(projectRoot);
}

function getConfigPath() {
  const projectRoot = getProjectRoot();
  return path.join(projectRoot, '.proletariat', 'config.json');
}

function getWorkspaceDir(theme) {
  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  return path.join(path.dirname(projectRoot), `${projectName}-${theme.directory}`);
}

function isInitialized() {
  return fs.existsSync(getConfigPath());
}

function loadConfig() {
  if (!isInitialized()) {
    throw new Error('Proletariat not initialized! Run `proletariat init` first.');
  }
  
  const configPath = getConfigPath();
  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return {
    ...rawConfig,
    theme: getTheme(rawConfig.themeName)
  };
}

function saveConfig(configData) {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
}

module.exports = {
  getProjectRoot,
  getProjectName,
  getConfigPath,
  getWorkspaceDir,
  isInitialized,
  loadConfig,
  saveConfig
};