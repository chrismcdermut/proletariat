import * as fs from 'fs';
import * as path from 'path';

/**
 * Create spec folder structure for a project
 *
 * New structure: pmo/projects/{id}/specs/{active,complete,future,dropped}
 *
 * @param pmoPath - Path to PMO directory
 * @param projectId - Project ID
 * @returns Path to created specs directory
 */
export function createSpecFolders(pmoPath: string, projectId: string): string {
  const projectPath = path.join(pmoPath, 'projects', projectId);
  const specsPath = path.join(projectPath, 'specs');

  // Create all subdirectories
  fs.mkdirSync(path.join(specsPath, 'active'), { recursive: true });
  fs.mkdirSync(path.join(specsPath, 'complete'), { recursive: true });
  fs.mkdirSync(path.join(specsPath, 'future'), { recursive: true });
  fs.mkdirSync(path.join(specsPath, 'dropped'), { recursive: true });

  return specsPath;
}

/**
 * Get spec folder path for a project (without creating it)
 *
 * @param pmoPath - Path to PMO directory
 * @param projectId - Project ID
 * @returns Path to specs directory
 */
export function getSpecFolderPath(pmoPath: string, projectId: string): string {
  return path.join(pmoPath, 'projects', projectId, 'specs');
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
