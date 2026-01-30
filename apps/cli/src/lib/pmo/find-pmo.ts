import * as fs from 'node:fs';
import * as path from 'node:path';
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
 * 1. PRLT_HQ_PATH env var (ONLY when DEVCONTAINER=true - for devcontainer mounts)
 * 2. Current directory tree for HQ with PMO
 *
 * NOTE: PMO must be within an HQ workspace. Standalone PMO and global PMO
 * are no longer supported. Use `prlt init` to create an HQ with PMO.
 */
export function findPMO(): string | null {
  // Check PRLT_HQ_PATH environment variable (only in devcontainers)
  const hqPath = process.env.PRLT_HQ_PATH;
  const isDevcontainer = process.env.DEVCONTAINER === 'true';

  if (hqPath && isDevcontainer) {
    // In devcontainer, PMO is always mounted at /hq/pmo regardless of database value
    // (database stores relative path like "repos/proletariat/pmo" but mount is at /hq/pmo)
    return path.join(hqPath, 'pmo');
  }

  let currentDir = process.cwd();

  // Search up the directory tree for HQ with PMO
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

    currentDir = path.dirname(currentDir);
  }

  // PMO not found - user needs to be in an HQ directory
  return null;
}
