import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

/**
 * Check if a database has PMO tables
 */
function hasPMOTables(dbPath: string): boolean {
  if (!fs.existsSync(dbPath)) {
    return false;
  }

  try {
    const db = new Database(dbPath);
    const result = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
    ).get();
    db.close();

    return result !== undefined;
  } catch {
    return false;
  }
}

/**
 * Find PMO directory by checking workspace.db for pmo_projects table
 *
 * Search priority:
 * 1. Current directory tree for HQ with PMO
 * 2. Current directory tree for standalone PMO (.pmo/)
 * 3. Global config for default PMO
 */
export function findPMO(): string | null {
  let currentDir = process.cwd();

  // Search up the directory tree
  while (currentDir !== '/') {
    const configPath = path.join(currentDir, '.proletariat', 'config.json');

    // Check for HQ with PMO
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.type === 'hq') {
          const dbPath = path.join(currentDir, '.proletariat', 'workspace.db');
          const hasTables = hasPMOTables(dbPath);
          if (hasTables) {
            const pmoPath = path.join(currentDir, 'pmo');
            return pmoPath;
          }
        }

        // Check for custom pmoPath in config
        if (config.pmoPath) {
          const absolutePath = path.isAbsolute(config.pmoPath)
            ? config.pmoPath
            : path.join(currentDir, config.pmoPath);

          // For custom PMO path, check if there's a workspace.db nearby
          const customDbPath = path.join(path.dirname(absolutePath), '.proletariat', 'workspace.db');
          if (hasPMOTables(customDbPath)) {
            return absolutePath;
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check for standalone .pmo directory (mini-HQ structure)
    const dotPmoPath = path.join(currentDir, '.pmo');
    const dotPmoDbPath = path.join(dotPmoPath, '.proletariat', 'workspace.db');
    if (hasPMOTables(dotPmoDbPath)) {
      return path.join(dotPmoPath, 'pmo');
    }

    currentDir = path.dirname(currentDir);
  }

  // Check global config for default PMO
  const globalConfigPath = path.join(process.env.HOME || '', '.proletariat', 'config.json');
  if (fs.existsSync(globalConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
      if (config.defaultPMO) {
        // Check if it's an HQ or mini-HQ with workspace.db
        const hqDbPath = path.join(path.dirname(config.defaultPMO), '.proletariat', 'workspace.db');
        if (hasPMOTables(hqDbPath)) {
          return config.defaultPMO;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  return null;
}
