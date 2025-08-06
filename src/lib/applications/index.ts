import * as fs from 'fs';
import * as path from 'path';
import { isInitialized, loadConfig, saveConfig } from '../config/index.js';
import { log } from '../utils/logger.js';

export interface Application {
  name: string;
  basePort: number;
  type: 'frontend' | 'backend' | 'dev-server';
}

export async function addApplication(name: string, basePort: number, type: string): Promise<void> {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `prlt init` first.');
    return;
  }

  const validTypes = ['frontend', 'backend', 'dev-server'];
  if (!validTypes.includes(type)) {
    log.error(`Invalid type '${type}'. Must be one of: ${validTypes.join(', ')}`);
    return;
  }

  const config = loadConfig();
  
  // Initialize applications array if it doesn't exist
  if (!config.applications) {
    config.applications = [];
  }

  // Check if application already exists
  const existingApp = config.applications.find((app: Application) => app.name === name);
  if (existingApp) {
    log.warning(`Application '${name}' already exists. Updating...`);
    existingApp.basePort = basePort;
    existingApp.type = type as any;
  } else {
    config.applications.push({
      name,
      basePort,
      type: type as any
    });
  }

  saveConfig(config);
  log.success(`Added application '${name}' (${type}) on base port ${basePort}`);

  // Update existing agents with new application ports
  await updateAgentPorts(config);
}

export async function updateAgentPorts(config: any): Promise<void> {
  if (!config.applications || !config.activeAgents) {
    return;
  }

  for (let agentIndex = 0; agentIndex < config.activeAgents.length; agentIndex++) {
    const agent = config.activeAgents[agentIndex];
    
    for (const app of config.applications) {
      const agentPort = app.basePort + (agentIndex + 1);
      const agentPath = path.join(config.workspaceDir, agent);
      
      // Find the application directory in the agent worktree
      const appPath = findAppPath(agentPath, app.name);
      if (appPath) {
        await createEnvFile(appPath, agentPort);
      }
    }
  }

  log.success('Updated port configurations for all agents');
}

function findAppPath(agentPath: string, appName: string): string | null {
  // Try common patterns
  const patterns = [
    path.join(agentPath, 'apps', appName),
    path.join(agentPath, appName),
    path.join(agentPath, 'packages', appName)
  ];

  for (const pattern of patterns) {
    if (fs.existsSync(pattern)) {
      return pattern;
    }
  }

  return null;
}

async function createEnvFile(appPath: string, port: number): Promise<void> {
  const envPath = path.join(appPath, '.env.local');
  
  // Try to find the original app's .env.dev file to copy from
  const originalAppPath = findOriginalAppPath(path.basename(appPath));
  const originalEnvPath = originalAppPath ? path.join(originalAppPath, '.env.dev') : null;
  
  let envContent = `PORT=${port}\n`;
  
  // If we found an original .env.dev file, copy its contents and update the PORT
  if (originalEnvPath && fs.existsSync(originalEnvPath)) {
    try {
      const originalContent = fs.readFileSync(originalEnvPath, 'utf8');
      // Replace PORT if it exists, otherwise add it
      if (originalContent.includes('PORT=')) {
        envContent = originalContent.replace(/PORT=\d+/g, `PORT=${port}`);
      } else {
        envContent = originalContent + `\nPORT=${port}\n`;
      }
      // Update NODE_ENV to 'local' for .env.local files
      if (envContent.includes('NODE_ENV=')) {
        envContent = envContent.replace(/NODE_ENV=\w+/g, 'NODE_ENV=local');
      } else {
        envContent = envContent + `\nNODE_ENV=local\n`;
      }
      log.info(`Copied environment from ${originalEnvPath} and set PORT=${port}`);
    } catch (error) {
      log.warning(`Failed to read ${originalEnvPath}, using basic PORT config`);
    }
  }
  
  try {
    fs.writeFileSync(envPath, envContent);
    log.info(`Created ${envPath}`);
  } catch (error) {
    log.warning(`Failed to create ${envPath}: ${error}`);
  }
}

function findOriginalAppPath(appName: string): string | null {
  // Get the main repo path (go up from worktree to find main repo)
  const config = require('../config/index.js').loadConfig();
  const mainRepoPath = path.dirname(config.workspaceDir);
  
  // Try common patterns for the original app
  const patterns = [
    path.join(mainRepoPath, 'apps', appName),
    path.join(mainRepoPath, appName),
    path.join(mainRepoPath, 'packages', appName)
  ];

  for (const pattern of patterns) {
    if (fs.existsSync(pattern)) {
      return pattern;
    }
  }

  return null;
}

