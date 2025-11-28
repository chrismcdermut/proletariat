import * as path from 'path';
import { SQLiteStorage, getStorageWithAutoSync } from './index.js';
import { findPMO } from './find-pmo.js';

/**
 * PMO context for commands
 */
export interface PMOContext {
  pmoPath: string;
  storage: SQLiteStorage;
  columns: string[];
  storageType: 'sqlite' | 'git';
}

/**
 * Get PMO context (path, storage, columns) without requiring config.json
 * Reads everything from workspace.db instead
 *
 * @param projectId - Optional project ID (defaults to 'default' or HQ name)
 * @param logger - Optional logging function
 * @returns PMO context with storage and metadata
 */
export function getPMOContext(
  projectId?: string,
  logger?: (msg: string) => void
): PMOContext {
  // Find PMO
  const pmoPath = findPMO();
  if (!pmoPath) {
    throw new Error('PMO not found. Run "prlt pmo init" first.');
  }

  // Get workspace.db path
  const workspacePath = path.dirname(pmoPath); // pmo is at <workspace>/pmo
  const dbPath = path.join(workspacePath, '.proletariat', 'workspace.db');

  // For now, assume 'git' if board.md exists, 'sqlite' otherwise
  // TODO: Read from pmo_settings table when implemented
  const storageType: 'sqlite' | 'git' = 'sqlite';

  // Get storage with auto-sync
  const storage = getStorageWithAutoSync(
    pmoPath,
    storageType,
    logger,
    projectId
  );

  // Get columns from database
  const columns = storage.getColumnNames();

  return {
    pmoPath,
    storage,
    columns,
    storageType,
  };
}
