import * as path from 'node:path';
import * as fs from 'node:fs';
import { SQLiteStorage, getStorageWithAutoSync } from './index.js';
import { findPMO } from './find-pmo.js';
import { warnIfMultipleHQs } from '../workspace.js';

// Track if we've already warned about multiple HQs this session
let hasWarnedAboutMultipleHQs = false;

/**
 * PMO context for commands.
 * Note: Storage is project-agnostic. projectId is passed explicitly to operations.
 */
export interface PMOContext {
  pmoPath: string;
  storage: SQLiteStorage;
  storageType: 'sqlite' | 'git';
}

export interface GetPMOContextOptions {
  logger?: (msg: string) => void;
}

/**
 * Get PMO context (path, storage) without requiring config.json
 * Reads everything from workspace.db instead
 *
 * Note: Storage is project-agnostic. Commands pass projectId explicitly to operations.
 * For project-scoped operations, commands should either:
 * - Derive project from an entity (e.g., ticket.projectId)
 * - Call requireProject() to prompt user for selection
 *
 * @param options - Configuration options
 * @param options.logger - Optional logging function
 * @returns PMO context with storage and metadata
 */
export async function getPMOContext(
  options?: GetPMOContextOptions
): Promise<PMOContext> {
  const logger = options?.logger;

  // Find PMO
  const pmoPath = findPMO();
  if (!pmoPath) {
    throw new Error('PMO not found. Run "prlt pmo init" first.');
  }

  // Warn once per session if multiple HQ workspaces detected
  if (!hasWarnedAboutMultipleHQs) {
    warnIfMultipleHQs();
    hasWarnedAboutMultipleHQs = true;
  }

  // Detect sync mode: 'git' enables multi-machine sync via git push/pull of board.md
  // Note: Storage is always SQLite (workspace.db). This flag controls sync strategy.
  const gitPath = path.join(pmoPath, '.git');
  const storageType: 'sqlite' | 'git' = fs.existsSync(gitPath) ? 'git' : 'sqlite';

  // Get storage - project-agnostic, projectId passed to operations explicitly
  const storage = getStorageWithAutoSync(pmoPath, storageType, logger);

  return {
    pmoPath,
    storage,
    storageType,
  };
}
