import * as path from 'path';
import * as fs from 'fs';
import inquirer from 'inquirer';
import Database from 'better-sqlite3';
import { SQLiteStorage, getStorageWithAutoSync, getWorkspaceDbPath } from './index.js';
import { findPMO } from './find-pmo.js';

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

/**
 * Get PMO context (path, storage, columns) without requiring config.json
 * Reads everything from workspace.db instead
 *
 * @param projectId - Optional project ID (defaults to 'default' or HQ name, or prompts if multiple projects)
 * @param logger - Optional logging function
 * @param promptIfMultiple - Whether to prompt user to select project if multiple exist (default: false)
 * @returns PMO context with storage and metadata
 */
export async function getPMOContext(
  projectId?: string,
  logger?: (msg: string) => void,
  promptIfMultiple: boolean = false
): Promise<PMOContext> {
  // Find PMO
  const pmoPath = findPMO();
  if (!pmoPath) {
    throw new Error('PMO not found. Run "prlt pmo init" first.');
  }

  // Get workspace.db path (searches upward from PMO)
  const dbPath = getWorkspaceDbPath(pmoPath);

  // If no project ID specified, try to auto-detect from config or prompt if multiple exist
  let resolvedProjectId = projectId;
  if (!resolvedProjectId) {
    // Check if there are multiple projects
    const db = new Database(dbPath);
    const projects = db.prepare('SELECT id, name FROM pmo_projects ORDER BY created_at').all() as Array<{ id: string; name: string }>;
    db.close();

    if (projects.length === 0) {
      throw new Error('No projects found. Run "prlt pmo init" first.');
    }

    if (promptIfMultiple && projects.length > 1) {
      // Prompt user to select project
      const { selectedProjectId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedProjectId',
        message: 'Select project:',
        choices: projects.map(p => ({ name: p.name, value: p.id })),
      }]);
      resolvedProjectId = selectedProjectId;
    } else if (projects.length === 1) {
      // Only one project, use it
      resolvedProjectId = projects[0].id;
    } else {
      // Multiple projects but no prompt, try to use HQ name
      const hqRoot = path.dirname(path.dirname(dbPath)); // dbPath is at {hq}/.proletariat/workspace.db
      const configPath = path.join(hqRoot, '.proletariat', 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          // For HQ workspaces, use the HQ name as project ID
          if (config.type === 'hq' && config.name) {
            resolvedProjectId = config.name;
          }
        } catch {
          // Ignore errors, fall back to first project
        }
      }
      resolvedProjectId = resolvedProjectId || projects[0].id;
    }
  }

  // Detect sync mode: 'git' enables multi-machine sync via git push/pull of board.md
  // Note: Storage is always SQLite (workspace.db). This flag controls sync strategy.
  // TODO: Read from pmo_settings table when implemented
  const gitPath = path.join(pmoPath, '.git');
  const storageType: 'sqlite' | 'git' = fs.existsSync(gitPath) ? 'git' : 'sqlite';

  // Get storage with auto-sync
  const storage = getStorageWithAutoSync(
    pmoPath,
    storageType,
    logger,
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
