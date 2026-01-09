import * as path from 'node:path';
import * as fs from 'node:fs';
import inquirer from 'inquirer';
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
  promptIfMultiple?: boolean;
  filterEmptyProjects?: boolean;  // Hide projects with no tickets (for work commands)
}

/**
 * Get PMO context (path, storage, columns) without requiring config.json
 * Reads everything from workspace.db instead
 *
 * @param options - Configuration options
 * @param options.projectId - Optional project ID (defaults to 'default' or HQ name, or prompts if multiple projects)
 * @param options.logger - Optional logging function
 * @param options.promptIfMultiple - Whether to prompt user to select project if multiple exist (default: false)
 * @param options.filterEmptyProjects - Hide projects with no tickets in picker (default: false)
 * @returns PMO context with storage and metadata
 */
export async function getPMOContext(
  projectId?: string | GetPMOContextOptions,
  logger?: (msg: string) => void,
  promptIfMultiple: boolean = false
): Promise<PMOContext> {
  // Support both old signature and new options object
  let options: GetPMOContextOptions;
  if (typeof projectId === 'object' && projectId !== null) {
    options = projectId;
  } else {
    options = { projectId, logger, promptIfMultiple };
  }

  const {
    projectId: projectIdOpt,
    logger: loggerOpt,
    promptIfMultiple: promptIfMultipleOpt = false,
    filterEmptyProjects = false,
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

  // If no project ID specified, try to auto-detect from config or prompt if multiple exist
  let resolvedProjectId = projectIdOpt;
  if (!resolvedProjectId) {
    // Check if there are multiple projects
    const db = new Database(dbPath);

    // Get projects with ticket counts
    const projects = db.prepare(`
      SELECT
        p.id,
        p.name,
        (SELECT COUNT(*) FROM pmo_tickets WHERE project_id = p.id) as ticket_count
      FROM pmo_projects p
      ORDER BY created_at
    `).all() as Array<{ id: string; name: string; ticket_count: number }>;
    db.close();

    if (projects.length === 0) {
      throw new Error('No projects found. Run "prlt pmo init" first.');
    }

    // Filter to only projects with tickets if requested
    let filteredProjects = projects;
    if (filterEmptyProjects) {
      filteredProjects = projects.filter(p => p.ticket_count > 0);
      if (filteredProjects.length === 0) {
        throw new Error('No projects with tickets found. Create a ticket first with "prlt ticket create".');
      }
    }

    if (filteredProjects.length === 1) {
      // Only one project (or one with tickets), use it - no prompt needed
      resolvedProjectId = filteredProjects[0].id;
    } else if (filteredProjects.length > 1) {
      // Multiple projects - always prompt for selection
      // (promptIfMultiple is only false when --project flag is already provided,
      // but if we're here, no project was provided so we must ask)
      const { selectedProjectId } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedProjectId',
        message: 'Select project:',
        choices: filteredProjects.map(p => ({
          name: filterEmptyProjects ? `${p.name} (${p.ticket_count} tickets)` : p.name,
          value: p.id,
        })),
      }]);
      resolvedProjectId = selectedProjectId;
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
