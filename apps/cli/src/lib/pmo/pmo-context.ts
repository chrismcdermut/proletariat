import * as path from 'node:path';
import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import { SQLiteStorage, getStorageWithAutoSync, getWorkspaceDbPath } from './index.js';
import { findPMO } from './find-pmo.js';
import { warnIfMultipleHQs } from '../workspace.js';

// Track if we've already warned about multiple HQs this session
let hasWarnedAboutMultipleHQs = false;

/**
 * PMO context for commands
 */
export interface PMOContext {
  pmoPath: string;
  storage: SQLiteStorage;
  storageType: 'sqlite' | 'git';
  /** Current project ID - undefined if no project selected yet */
  projectId?: string;
  /** Current project name - undefined if no project selected yet */
  projectName?: string;
}

export interface GetPMOContextOptions {
  projectId?: string;
  logger?: (msg: string) => void;
}

/**
 * Get PMO context (path, storage) without requiring config.json
 * Reads everything from workspace.db instead
 *
 * Note: This function does NOT prompt for project selection. Storage is initialized
 * without a project context. Commands that need project-scoped operations should
 * either:
 * - Derive project from an entity (e.g., ticket.projectId)
 * - Call requireProject() to prompt user for selection
 *
 * @param options - Configuration options
 * @param options.projectId - Optional project ID to pre-select
 * @param options.logger - Optional logging function
 * @returns PMO context with storage and metadata
 */
export async function getPMOContext(
  projectId?: string | GetPMOContextOptions,
  logger?: (msg: string) => void
): Promise<PMOContext> {
  // Support both old signature and new options object
  let options: GetPMOContextOptions;
  if (typeof projectId === 'object' && projectId !== null) {
    options = projectId;
  } else {
    options = { projectId, logger };
  }

  const {
    projectId: projectIdOpt,
    logger: loggerOpt,
  } = options;

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

  // Get workspace.db path (searches upward from PMO)
  const dbPath = getWorkspaceDbPath(pmoPath);

  // Detect sync mode: 'git' enables multi-machine sync via git push/pull of board.md
  // Note: Storage is always SQLite (workspace.db). This flag controls sync strategy.
  // TODO: Read from pmo_settings table when implemented
  const gitPath = path.join(pmoPath, '.git');
  const storageType: 'sqlite' | 'git' = fs.existsSync(gitPath) ? 'git' : 'sqlite';

  // Get storage - projectId is optional, commands derive it from entities or prompt
  const storage = getStorageWithAutoSync(
    pmoPath,
    storageType,
    loggerOpt,
    projectIdOpt  // Pass through - may be undefined
  );

  // Get project name if projectId was provided
  let projectName: string | undefined;
  if (projectIdOpt) {
    const db = new Database(dbPath);
    const project = db.prepare('SELECT name FROM pmo_projects WHERE id = ?').get(projectIdOpt) as { name: string } | undefined;
    db.close();
    projectName = project?.name;
  }

  return {
    pmoPath,
    storage,
    storageType,
    projectId: projectIdOpt,
    projectName,
  };
}
