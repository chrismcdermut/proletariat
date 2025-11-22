/**
 * Manager factory and utilities
 * Provides centralized access to all manager instances
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentManager } from './AgentManager.js';
import { RepoManager } from './RepoManager.js';
import { TicketManager } from './TicketManager.js';
import { HQConfig } from './types.js';

export * from './types.js';
export { AgentManager } from './AgentManager.js';
export { RepoManager } from './RepoManager.js';
export { TicketManager } from './TicketManager.js';

/**
 * Find HQ root directory by searching up the tree
 */
export function findHQRoot(maxDepth: number = 10): string | null {
  let currentDir = process.cwd();
  
  for (let i = 0; i < maxDepth; i++) {
    const hqConfigPath = path.join(currentDir, '.proletariat', 'config.json');
    
    if (fs.existsSync(hqConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(hqConfigPath, 'utf-8'));
        if (config.type === 'hq') {
          return currentDir;
        }
      } catch {
        // Not an HQ config, continue searching
      }
    }
    
    const parent = path.dirname(currentDir);
    if (parent === currentDir) break; // Reached root
    currentDir = parent;
  }
  
  return null;
}

/**
 * Load HQ configuration
 */
export function loadHQConfig(hqRoot: string): HQConfig | null {
  const configPath = path.join(hqRoot, '.proletariat', 'config.json');
  
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.type === 'hq') {
      return config as HQConfig;
    }
  } catch {
    // Failed to load config
  }
  
  return null;
}

/**
 * Manager instances interface
 */
export interface Managers {
  agent: AgentManager;
  repo: RepoManager;
  ticket: TicketManager;
  config: HQConfig;
  hqRoot: string;
}

/**
 * Factory function to create manager instances
 * This is the functional composition pattern - we compose managers together
 */
export function getManagers(hqRoot?: string): Managers | null {
  // Find HQ root if not provided
  const root = hqRoot || findHQRoot();
  if (!root) {
    return null;
  }
  
  // Load config
  const config = loadHQConfig(root);
  if (!config) {
    return null;
  }
  
  // Create manager instances (factory pattern)
  // Each manager gets the same config and root, ensuring consistency
  return {
    agent: new AgentManager(root, config),
    repo: new RepoManager(root, config),
    ticket: new TicketManager(root, config),
    config,
    hqRoot: root
  };
}

/**
 * Higher-order function to wrap manager methods with error handling
 * This demonstrates functional composition - we enhance functions with additional behavior
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<void>>(
  fn: T,
  errorMessage?: string
): T {
  return (async (...args: Parameters<T>) => {
    try {
      await fn(...args);
    } catch (error) {
      console.error(errorMessage || 'An error occurred:', error);
      process.exit(1);
    }
  }) as T;
}

/**
 * Compose multiple async functions into a pipeline
 * This is pure functional composition - combining simple functions
 */
export function compose<T>(...fns: Array<(arg: T) => Promise<T>>): (arg: T) => Promise<T> {
  return async (arg: T) => {
    let result = arg;
    for (const fn of fns) {
      result = await fn(result);
    }
    return result;
  };
}