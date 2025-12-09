import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

/**
 * Translate a path for container environment.
 * If pmo_path is an absolute host path (e.g., /Users/.../pmo) and we're in a container
 * (PRLT_HQ_PATH=/hq), extract the relative portion and map to container path.
 */
function translatePathForContainer(pmoPath: string, hqPath: string): string {
  // If path already starts with hqPath, it's already correct
  if (pmoPath.startsWith(hqPath)) {
    return pmoPath;
  }

  // If we're in a container (hqPath is something like /hq) and pmo_path is an absolute host path
  // Extract just the last component (e.g., "pmo" from "/Users/.../inflow-test-hq/pmo")
  const pmoBasename = path.basename(pmoPath);
  const containerPath = path.join(hqPath, pmoBasename);

  // Check if this path exists in the container
  if (fs.existsSync(containerPath)) {
    return containerPath;
  }

  // Fallback: return original (will likely fail, but gives better error message)
  return pmoPath;
}

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
 * 1. PRLT_HQ_PATH environment variable (used in devcontainers)
 * 2. Current directory tree for HQ with PMO
 * 3. Current directory tree for standalone PMO (.pmo/)
 * 4. Global config for default PMO
 */
export function findPMO(): string | null {
  // Check PRLT_HQ_PATH environment variable first (used in devcontainers)
  const hqPath = process.env.PRLT_HQ_PATH;
  if (hqPath) {
    const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
    if (hasPMOTables(dbPath)) {
      try {
        const db = new Database(dbPath);
        const result = db.prepare('SELECT value FROM pmo_settings WHERE key = ?').get('pmo_path') as { value: string } | undefined;
        db.close();

        if (result) {
          // Handle absolute paths that might be from host system
          let pmoPath = path.isAbsolute(result.value)
            ? result.value
            : path.join(hqPath, result.value);

          // Translate host paths to container paths if needed
          pmoPath = translatePathForContainer(pmoPath, hqPath);
          return pmoPath;
        }
      } catch {
        // Table might not exist yet
      }

      // Fallback: default location at HQ root
      const pmoPath = path.join(hqPath, 'pmo');
      return pmoPath;
    }
  }

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
            // Read PMO path from database (new behavior)
            try {
              const db = new Database(dbPath);
              const result = db.prepare('SELECT value FROM pmo_settings WHERE key = ?').get('pmo_path') as { value: string } | undefined;
              db.close();

              if (result) {
                const absolutePath = path.isAbsolute(result.value)
                  ? result.value
                  : path.join(currentDir, result.value);
                return absolutePath;
              }
            } catch {
              // Table might not exist yet, fall through to legacy behavior
            }

            // Legacy: check if config has pmoPath (for backward compatibility)
            if (config.pmoPath) {
              const absolutePath = path.isAbsolute(config.pmoPath)
                ? config.pmoPath
                : path.join(currentDir, config.pmoPath);
              return absolutePath;
            }

            // Final fallback: default location at HQ root
            const pmoPath = path.join(currentDir, 'pmo');
            return pmoPath;
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
