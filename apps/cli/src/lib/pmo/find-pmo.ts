import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { openDriver } from '../database/driver.js';
import { isValidHQ } from '../workspace.js';
import { isReadOnlyHQMount } from '../container.js';
import { throwIfNativeBindingError } from '../database/native-validation.js';
import { initializePMOTables } from './storage/base.js';

/**
 * Resolve PMO path from stored value.
 *
 * PMO paths are now stored as relative paths (e.g., "pmo" or "repos/myrepo/pmo").
 * For backward compatibility, we also handle legacy absolute paths by extracting
 * the relative portion.
 */
function resolvePmoPath(storedPath: string, hqPath: string): string {
  // If already relative, just join with HQ path
  if (!path.isAbsolute(storedPath)) {
    return path.join(hqPath, storedPath);
  }

  // Legacy: absolute path stored (e.g., "/Users/.../inflow-test-hq/pmo")
  // Try to extract relative portion by finding common HQ patterns
  // This handles both host (/Users/.../my-hq/pmo) and container (/hq/pmo) paths

  // If it already starts with our hqPath, it's correct
  if (storedPath.startsWith(hqPath)) {
    return storedPath;
  }

  // Extract relative path from absolute (best effort for legacy data)
  // Look for common patterns like /pmo, /repos/*/pmo
  const pmoMatch = storedPath.match(/\/(pmo|repos\/[^/]+\/pmo)$/);
  if (pmoMatch) {
    return path.join(hqPath, pmoMatch[1]);
  }

  // Last resort: use basename
  return path.join(hqPath, path.basename(storedPath));
}

/**
 * Check if a database has PMO tables
 */
function hasPMOTables(dbPath: string): boolean {
  if (!fs.existsSync(dbPath)) {
    return false;
  }

  try {
    const driver = openDriver(dbPath, { foreignKeys: false, readonly: isReadOnlyHQMount(path.dirname(path.dirname(dbPath))) });
    const result = driver.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
    ).get();
    driver.close();

    return result !== undefined;
  } catch (error) {
    // If the native binding is broken, surface it immediately instead of
    // silently returning false (which makes the CLI say "PMO not found").
    throwIfNativeBindingError(error, 'hasPMOTables');
    return false;
  }
}

/**
 * Auto-bootstrap PMO tables in an existing workspace.db that lacks them.
 * This enables any HQ workspace to be used for PMO operations without
 * requiring an explicit `prlt pmo init`.
 *
 * Idempotent: safe to call even if tables already exist.
 */
export function bootstrapPMOSchema(dbPath: string, hqPath: string): boolean {
  if (!fs.existsSync(dbPath)) {
    return false;
  }

  // Don't bootstrap on read-only mounts (containers)
  const workspaceRoot = path.dirname(path.dirname(dbPath));
  if (isReadOnlyHQMount(workspaceRoot)) {
    return false;
  }

  try {
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');

    try {
      // Create PMO tables, seed built-in data, validate schema
      initializePMOTables(db);

      // Set default pmo_path if not already set
      const existing = db.prepare(
        "SELECT value FROM pmo_settings WHERE key = 'pmo_path'"
      ).get();
      if (!existing) {
        db.prepare(
          "INSERT INTO pmo_settings (key, value) VALUES (?, ?)"
        ).run('pmo_path', 'pmo');
      }
    } finally {
      db.close();
    }

    // Create the default PMO directory
    const pmoDir = path.join(hqPath, 'pmo');
    if (!fs.existsSync(pmoDir)) {
      fs.mkdirSync(pmoDir, { recursive: true });
    }

    return true;
  } catch (error) {
    // Surface native binding errors immediately
    throwIfNativeBindingError(error, 'bootstrapPMOSchema');
    // Silently fail for other errors — caller will fall through
    return false;
  }
}

/**
 * Find PMO directory by checking workspace.db for pmo_projects table
 *
 * Search priority:
 * 1. PRLT_HQ_PATH env var (ONLY when DEVCONTAINER=true or PRLT_TEST_ENV=true)
 * 2. Current directory tree for HQ with PMO
 * 3. Current directory tree for standalone PMO (.pmo/)
 * 4. ~/.proletariat/config.json activeWorkspace (fallback when NOT in any workspace)
 * 5. Global config for default PMO
 *
 * NOTE: PRLT_HQ_PATH is ignored on host machines to support multiple agents
 * working in different workspaces simultaneously.
 */
export function findPMO(): string | null {
  // Check PRLT_HQ_PATH environment variable (only in devcontainers or test environments)
  const hqPath = process.env.PRLT_HQ_PATH;
  const allowEnvHqPath = process.env.DEVCONTAINER === 'true' || process.env.PRLT_TEST_ENV === 'true';

  if (hqPath && allowEnvHqPath) {
    // In devcontainer, PMO is always mounted at /hq/pmo regardless of database value
    // (database stores relative path like "repos/proletariat/pmo" but mount is at /hq/pmo)
    return path.join(hqPath, 'pmo');
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
          let hasTables = hasPMOTables(dbPath);

          // Auto-bootstrap: if workspace.db exists but lacks PMO tables, create them
          if (!hasTables && fs.existsSync(dbPath)) {
            if (bootstrapPMOSchema(dbPath, currentDir)) {
              hasTables = true;
            }
          }

          if (hasTables) {
            // Read PMO path from database (new behavior)
            try {
              const driver = openDriver(dbPath, { foreignKeys: false, readonly: isReadOnlyHQMount(path.dirname(path.dirname(dbPath))) });
              const result = driver.prepare('SELECT value FROM pmo_settings WHERE key = ?').get('pmo_path') as { value: string } | undefined;
              driver.close();

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

  // Check machine config for activeWorkspace (fallback when NOT in any workspace)
  const machineConfigPath = path.join(os.homedir(), '.proletariat', 'config.json');
  if (fs.existsSync(machineConfigPath)) {
    try {
      const machineConfig = JSON.parse(fs.readFileSync(machineConfigPath, 'utf-8'));
      if (machineConfig.activeWorkspace && fs.existsSync(machineConfig.activeWorkspace) && isValidHQ(machineConfig.activeWorkspace)) {
        const activeHqPath = machineConfig.activeWorkspace;
        const dbPath = path.join(activeHqPath, '.proletariat', 'workspace.db');
        let activeHasTables = hasPMOTables(dbPath);

        // Auto-bootstrap: if workspace.db exists but lacks PMO tables, create them
        if (!activeHasTables && fs.existsSync(dbPath)) {
          if (bootstrapPMOSchema(dbPath, activeHqPath)) {
            activeHasTables = true;
          }
        }

        if (activeHasTables) {
          try {
            const driver = openDriver(dbPath, { foreignKeys: false, readonly: isReadOnlyHQMount(path.dirname(path.dirname(dbPath))) });
            const result = driver.prepare('SELECT value FROM pmo_settings WHERE key = ?').get('pmo_path') as { value: string } | undefined;
            driver.close();

            if (result) {
              return resolvePmoPath(result.value, activeHqPath);
            }
          } catch {
            // Table might not exist yet
          }

          // Fallback: default location at HQ root
          return path.join(activeHqPath, 'pmo');
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check global config for default PMO (legacy fallback)
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
