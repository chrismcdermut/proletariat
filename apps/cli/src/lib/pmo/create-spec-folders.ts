import * as fs from 'fs';
import * as path from 'path';

/**
 * Create PMO folder structure
 *
 * Two distinct areas:
 * 1. product/ - Living product definitions (specs, requirements, architecture)
 *    These don't move - they get updated in place as the product evolves.
 *
 * 2. projects/{id}/ - Implementation work that flows through lifecycle
 *    - epics/ with draft/active/complete stages
 *    - board.md for tracking tickets
 *
 * @param pmoPath - Path to PMO directory
 * @param projectId - Project ID
 * @returns Path to created project directory
 */
export function createSpecFolders(pmoPath: string, projectId: string): string {
  // Create product folder for specs/requirements (PMO-wide, not per-project)
  const productPath = path.join(pmoPath, 'product');
  fs.mkdirSync(productPath, { recursive: true });

  // Create project folder with epics lifecycle
  const projectPath = path.join(pmoPath, 'projects', projectId);
  const epicsPath = path.join(projectPath, 'epics');

  fs.mkdirSync(path.join(epicsPath, 'draft'), { recursive: true });
  fs.mkdirSync(path.join(epicsPath, 'active'), { recursive: true });
  fs.mkdirSync(path.join(epicsPath, 'complete'), { recursive: true });

  return projectPath;
}

/**
 * Get product folder path (for specs/requirements - PMO-wide)
 *
 * @param pmoPath - Path to PMO directory
 * @returns Path to product directory
 */
export function getProductPath(pmoPath: string): string {
  return path.join(pmoPath, 'product');
}

/**
 * Get epics folder path for a project
 *
 * @param pmoPath - Path to PMO directory
 * @param projectId - Project ID
 * @returns Path to epics directory
 */
export function getEpicsPath(pmoPath: string, projectId: string): string {
  return path.join(pmoPath, 'projects', projectId, 'epics');
}

/**
 * @deprecated Use getProductPath() for specs, getEpicsPath() for implementation work
 */
export function getSpecFolderPath(pmoPath: string, projectId: string): string {
  return path.join(pmoPath, 'projects', projectId, 'epics');
}

/**
 * Get project folder path
 *
 * @param pmoPath - Path to PMO directory
 * @param projectId - Project ID
 * @returns Path to project directory
 */
export function getProjectPath(pmoPath: string, projectId: string): string {
  return path.join(pmoPath, 'projects', projectId);
}
