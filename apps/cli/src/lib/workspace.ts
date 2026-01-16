import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import chalk from 'chalk';

/**
 * Central workspace resolution utilities.
 *
 * Search priority:
 * 1. PRLT_HQ_PATH env var (ONLY when DEVCONTAINER=true - for devcontainer mounts)
 * 2. Walk up directory tree looking for .proletariat/config.json with type='hq'
 *    - If found but not registered, emit warning to register
 * 3. ~/.proletariat/config.json activeWorkspace (fallback when NOT in any workspace)
 * 4. Global config ~/.proletariat/config.json defaultHQ (legacy fallback)
 *
 * NOTE: PRLT_HQ_PATH is ignored on host machines to support multiple agents
 * working in different workspaces simultaneously. Each agent uses the workspace
 * they're physically in, not a global env var that could cause conflicts.
 *
 * For testing workspace isolation, see TKT-400.
 * For CI/CD workspace isolation, see TKT-401.
 */

export interface WorkspaceLocation {
  path: string;
  source: 'env' | 'registry' | 'cwd' | 'global';
}

/**
 * Find HQ workspace root directory.
 *
 * @param startDir Starting directory for search (default: process.cwd())
 * @returns HQ path or null if not found
 *
 * Priority:
 * 1. PRLT_HQ_PATH environment variable
 * 2. Walk up directory tree from startDir
 * 3. Global config default
 */
export function findHQRoot(startDir: string = process.cwd()): string | null {
  const result = findHQRootWithSource(startDir);
  return result?.path ?? null;
}

/**
 * Find HQ workspace root with source information.
 * Useful for debugging and logging where the workspace was resolved from.
 */
export function findHQRootWithSource(startDir: string = process.cwd()): WorkspaceLocation | null {
  // 1. Check PRLT_HQ_PATH environment variable (only in devcontainers)
  // On host machines, we use directory walk to support multiple workspaces/agents
  const envHqPath = process.env.PRLT_HQ_PATH;
  const isDevcontainer = process.env.DEVCONTAINER === 'true';

  if (envHqPath && isDevcontainer) {
    const resolvedPath = path.resolve(envHqPath);
    // Validate it's actually an HQ
    if (isValidHQ(resolvedPath)) {
      return { path: resolvedPath, source: 'env' };
    }
    // If PRLT_HQ_PATH is set but invalid, warn and continue search
    console.warn(chalk.yellow(`Warning: PRLT_HQ_PATH (${envHqPath}) is not a valid HQ workspace. Searching...`));
  }

  // 2. Walk up directory tree looking for HQ
  // This takes precedence over activeWorkspace to support multiple agents
  // working in different workspaces simultaneously
  let currentDir = startDir;
  while (currentDir !== '/' && currentDir !== path.dirname(currentDir)) {
    if (isValidHQ(currentDir)) {
      // Emit warning if workspace is not registered (helps users discover the registry)
      emitUnregisteredWarning(currentDir);
      return { path: currentDir, source: 'cwd' };
    }
    currentDir = path.dirname(currentDir);
  }

  // 3. Check machine config for activeWorkspace (fallback when NOT in any workspace)
  // This is useful when running prlt from a directory outside any workspace
  const machineConfigPath = path.join(os.homedir(), '.proletariat', 'config.json');
  if (fs.existsSync(machineConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(machineConfigPath, 'utf-8'));
      if (config.activeWorkspace && fs.existsSync(config.activeWorkspace) && isValidHQ(config.activeWorkspace)) {
        return { path: config.activeWorkspace, source: 'registry' };
      }
    } catch {
      // Ignore parse errors
    }
  }

  // 4. Check global config for default workspace (legacy fallback)
  if (fs.existsSync(machineConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(machineConfigPath, 'utf-8'));
      if (config.defaultHQ && isValidHQ(config.defaultHQ)) {
        return { path: config.defaultHQ, source: 'global' };
      }
    } catch {
      // Ignore parse errors
    }
  }

  return null;
}

// Track whether we've already emitted the unregistered warning in this process
let hasEmittedUnregisteredWarning = false;

/**
 * Emit a warning when a workspace is found via directory walk but not registered.
 * Only emits once per process to avoid spam.
 */
function emitUnregisteredWarning(workspacePath: string): void {
  // Only warn once per process
  if (hasEmittedUnregisteredWarning) {
    return;
  }

  // Check if this workspace is registered
  const machineConfigPath = path.join(os.homedir(), '.proletariat', 'config.json');
  if (fs.existsSync(machineConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(machineConfigPath, 'utf-8'));
      if (config.workspaces && Array.isArray(config.workspaces)) {
        const isRegistered = config.workspaces.some((w: { path: string }) => {
          // Normalize paths for comparison
          try {
            const normalizedWorkspace = fs.existsSync(workspacePath)
              ? fs.realpathSync(workspacePath)
              : path.resolve(workspacePath);
            const normalizedEntry = fs.existsSync(w.path)
              ? fs.realpathSync(w.path)
              : path.resolve(w.path);
            return normalizedWorkspace === normalizedEntry;
          } catch {
            return workspacePath === w.path;
          }
        });

        if (isRegistered) {
          return; // Already registered, no warning needed
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Emit warning
  hasEmittedUnregisteredWarning = true;
  console.warn(
    chalk.yellow(`Warning: Workspace not registered. Run 'prlt workspace add ${workspacePath}' to register.`)
  );
}

/**
 * Check if a directory is a valid HQ workspace.
 * Valid HQ has .proletariat/config.json with type='hq'
 */
export function isValidHQ(dir: string): boolean {
  const configPath = path.join(dir, '.proletariat', 'config.json');
  if (!fs.existsSync(configPath)) {
    return false;
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return config.type === 'hq';
  } catch {
    return false;
  }
}

/**
 * Get the .proletariat directory path for a workspace.
 * Respects PRLT_HQ_PATH for override.
 */
export function getProletariatDir(workspacePath?: string): string {
  const hqPath = workspacePath || findHQRoot();
  if (!hqPath) {
    throw new Error('Not in an HQ directory. Run "prlt init" first.');
  }
  return path.join(hqPath, '.proletariat');
}

/**
 * Get the workspace database path.
 */
export function getWorkspaceDbPath(workspacePath?: string): string {
  return path.join(getProletariatDir(workspacePath), 'workspace.db');
}

/**
 * Require HQ context - throws helpful error if not in HQ.
 */
export function requireHQ(startDir?: string): string {
  const hqPath = findHQRoot(startDir);
  if (!hqPath) {
    const hint = process.env.PRLT_HQ_PATH
      ? `PRLT_HQ_PATH is set to "${process.env.PRLT_HQ_PATH}" but it's not a valid HQ.`
      : 'Set PRLT_HQ_PATH environment variable or run from within an HQ directory.';
    throw new Error(`Not in an HQ directory. Run "prlt init" first.\n${hint}`);
  }
  return hqPath;
}

/**
 * Find all HQ workspaces in directory tree (for debugging/diagnostics).
 * Useful for detecting multiple workspaces that could cause confusion.
 */
export function findAllHQs(startDir: string = process.cwd()): string[] {
  const hqs: string[] = [];
  let currentDir = startDir;

  while (currentDir !== '/' && currentDir !== path.dirname(currentDir)) {
    if (isValidHQ(currentDir)) {
      hqs.push(currentDir);
    }
    currentDir = path.dirname(currentDir);
  }

  return hqs;
}

/**
 * Warn if multiple HQ workspaces are detected.
 * This can cause confusion as commands may target different workspaces.
 */
export function warnIfMultipleHQs(startDir: string = process.cwd()): void {
  const hqs = findAllHQs(startDir);
  if (hqs.length > 1) {
    console.warn(chalk.yellow('\n⚠️  Multiple HQ workspaces detected:'));
    hqs.forEach((hq, i) => {
      const marker = i === 0 ? '(active)' : '';
      console.warn(chalk.yellow(`   ${i + 1}. ${hq} ${marker}`));
    });
    console.warn(chalk.yellow('\nThis can cause confusion. Consider consolidating with: prlt workspace merge'));
    console.warn(chalk.yellow('Or set PRLT_HQ_PATH to explicitly specify which workspace to use.\n'));
  }
}
