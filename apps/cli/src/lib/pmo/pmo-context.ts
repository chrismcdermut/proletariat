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
  columns: string[];
  storageType: 'sqlite' | 'git';
  projectId: string;
  projectName: string;
}

export interface GetPMOContextOptions {
  projectId?: string;
  logger?: (msg: string) => void;
}

/**
 * Get PMO context (path, storage, columns) without requiring config.json
 * Reads everything from workspace.db instead
 *
 * Note: This function does NOT prompt for project selection. It initializes storage
 * with the provided projectId, or 'default' if none specified. Commands that need
 * project context should call requireProject() after context initialization.
 *
 * @param options - Configuration options
 * @param options.projectId - Optional project ID (defaults to 'default')
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

  // Use provided projectId or 'default' as placeholder
  // Commands that need project context should call requireProject()
  const resolvedProjectId = projectIdOpt || 'default';

  // Detect sync mode: 'git' enables multi-machine sync via git push/pull of board.md
  // Note: Storage is always SQLite (workspace.db). This flag controls sync strategy.
  // TODO: Read from pmo_settings table when implemented
  const gitPath = path.join(pmoPath, '.git');
  const storageType: 'sqlite' | 'git' = fs.existsSync(gitPath) ? 'git' : 'sqlite';

  // Get storage with auto-sync
  const storage = getStorageWithAutoSync(
    pmoPath,
    storageType,
    loggerOpt,
    resolvedProjectId
  );

  // Get columns from database
  const columns = storage.getColumnNames();

  // Get project name
  const db = new Database(dbPath);
  const project = db.prepare('SELECT name FROM pmo_projects WHERE id = ?').get(resolvedProjectId) as { name: string } | undefined;
  db.close();

  const finalProjectId = resolvedProjectId || 'default';
  const finalProjectName = project?.name || finalProjectId;

  return {
    pmoPath,
    storage,
    columns,
    storageType,
    projectId: finalProjectId,
    projectName: finalProjectName,
  };
}
