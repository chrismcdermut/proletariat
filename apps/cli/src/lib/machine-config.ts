import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { isValidHQ } from './workspace.js';

/**
 * Machine-level configuration for Proletariat workspaces.
 *
 * This module manages the ~/.proletariat/config.json registry that tracks
 * all known workspaces on the machine, solving the workspace discovery
 * chicken-and-egg problem.
 *
 * Registry schema:
 * {
 *   "version": "1.0.0",
 *   "workspaces": [
 *     { "name": "workspace-name", "path": "/absolute/path", "registeredAt": "ISO8601" }
 *   ],
 *   "activeWorkspace": "/absolute/path" | null
 * }
 */

export interface RegisteredWorkspace {
  name: string;
  path: string;
  registeredAt: string;
}

export interface MachineConfig {
  version: string;
  workspaces: RegisteredWorkspace[];
  activeWorkspace: string | null;
}

const CONFIG_VERSION = '1.0.0';

/**
 * Get the path to the machine-level config directory (~/.proletariat/).
 */
export function getMachineConfigDir(): string {
  return path.join(os.homedir(), '.proletariat');
}

/**
 * Get the path to the machine-level config file (~/.proletariat/config.json).
 */
export function getMachineConfigPath(): string {
  return path.join(getMachineConfigDir(), 'config.json');
}

/**
 * Ensure the machine config directory exists.
 * Creates ~/.proletariat/ if it doesn't exist.
 */
export function ensureMachineConfigDir(): void {
  const configDir = getMachineConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Normalize a workspace path for consistent storage.
 * - Resolves symlinks
 * - Makes path absolute
 * - Removes trailing slashes
 */
export function normalizePath(inputPath: string): string {
  // Expand ~ to home directory
  let resolved = inputPath.startsWith('~')
    ? path.join(os.homedir(), inputPath.slice(1))
    : inputPath;

  // Make absolute
  resolved = path.resolve(resolved);

  // Resolve symlinks if the path exists
  if (fs.existsSync(resolved)) {
    try {
      resolved = fs.realpathSync(resolved);
    } catch {
      // If realpath fails, use the resolved path
    }
  }

  // Remove trailing slash (unless it's the root)
  if (resolved.length > 1 && resolved.endsWith(path.sep)) {
    resolved = resolved.slice(0, -1);
  }

  return resolved;
}

/**
 * Get the default (empty) machine config structure.
 */
function getDefaultConfig(): MachineConfig {
  return {
    version: CONFIG_VERSION,
    workspaces: [],
    activeWorkspace: null,
  };
}

/**
 * Read the machine config file.
 * Returns a default empty config if file doesn't exist or is invalid.
 */
export function readMachineConfig(): MachineConfig {
  const configPath = getMachineConfigPath();

  if (!fs.existsSync(configPath)) {
    return getDefaultConfig();
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as MachineConfig;

    // Validate basic structure
    if (!config.version || !Array.isArray(config.workspaces)) {
      return getDefaultConfig();
    }

    return config;
  } catch {
    return getDefaultConfig();
  }
}

/**
 * Write the machine config file atomically.
 * Uses write-to-temp-then-rename pattern for safety.
 */
export function writeMachineConfig(config: MachineConfig): void {
  ensureMachineConfigDir();

  const configPath = getMachineConfigPath();
  const tempPath = `${configPath}.tmp.${process.pid}`;

  try {
    // Write to temp file
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf-8');

    // Atomic rename
    fs.renameSync(tempPath, configPath);
  } catch (error) {
    // Clean up temp file if rename failed
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Register a workspace in the machine config.
 *
 * @param workspacePath Absolute path to the workspace (will be normalized)
 * @param name Optional workspace name (defaults to directory basename)
 * @param setActive If true, set as active workspace when no active workspace exists
 * @returns The registered workspace entry
 */
export function registerWorkspace(
  workspacePath: string,
  name?: string,
  setActive: boolean = true
): RegisteredWorkspace {
  const normalizedPath = normalizePath(workspacePath);
  const workspaceName = name || path.basename(normalizedPath);

  const config = readMachineConfig();

  // Check if already registered
  const existingIndex = config.workspaces.findIndex(
    (w) => normalizePath(w.path) === normalizedPath
  );

  const entry: RegisteredWorkspace = {
    name: workspaceName,
    path: normalizedPath,
    registeredAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    // Update existing entry
    config.workspaces[existingIndex] = entry;
  } else {
    // Add new entry
    config.workspaces.push(entry);
  }

  // Set as active if requested and no active workspace exists
  if (setActive && !config.activeWorkspace) {
    config.activeWorkspace = normalizedPath;
  }

  writeMachineConfig(config);

  return entry;
}

/**
 * Unregister a workspace from the machine config.
 *
 * @param pathOrName Workspace path or name to unregister
 * @returns true if workspace was found and removed, false otherwise
 */
export function unregisterWorkspace(pathOrName: string): boolean {
  const config = readMachineConfig();
  const normalizedInput = normalizePath(pathOrName);

  const initialLength = config.workspaces.length;

  // Try to match by path first, then by name
  config.workspaces = config.workspaces.filter((w) => {
    const normalizedWorkspacePath = normalizePath(w.path);
    return normalizedWorkspacePath !== normalizedInput && w.name !== pathOrName;
  });

  const removed = config.workspaces.length < initialLength;

  if (removed) {
    // Clear active workspace if it was the removed one
    if (config.activeWorkspace) {
      const normalizedActive = normalizePath(config.activeWorkspace);
      const stillExists = config.workspaces.some(
        (w) => normalizePath(w.path) === normalizedActive
      );
      if (!stillExists) {
        config.activeWorkspace = null;
      }
    }

    writeMachineConfig(config);
  }

  return removed;
}

/**
 * Get all registered workspaces.
 */
export function getRegisteredWorkspaces(): RegisteredWorkspace[] {
  const config = readMachineConfig();
  return config.workspaces;
}

/**
 * Get the active workspace path.
 * Returns null if no active workspace is set.
 */
export function getActiveWorkspace(): string | null {
  const config = readMachineConfig();
  return config.activeWorkspace;
}

/**
 * Set the active workspace.
 *
 * @param pathOrName Workspace path or name
 * @returns The path of the workspace that was set as active
 * @throws Error if workspace not found or not valid
 */
export function setActiveWorkspace(pathOrName: string): string {
  const config = readMachineConfig();
  const normalizedInput = normalizePath(pathOrName);

  // Find workspace by path or name
  let workspace = config.workspaces.find(
    (w) => normalizePath(w.path) === normalizedInput
  );

  if (!workspace) {
    // Try matching by name
    const matches = config.workspaces.filter((w) => w.name === pathOrName);
    if (matches.length === 0) {
      throw new Error(`Workspace not found: ${pathOrName}`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple workspaces found with name "${pathOrName}". Please use the full path instead.`
      );
    }
    workspace = matches[0];
  }

  // Validate workspace still exists on filesystem
  if (!fs.existsSync(workspace.path)) {
    throw new Error(`Workspace path no longer exists: ${workspace.path}`);
  }

  // Validate it's still a valid HQ
  if (!isValidHQ(workspace.path)) {
    throw new Error(`Path is no longer a valid workspace: ${workspace.path}`);
  }

  config.activeWorkspace = workspace.path;
  writeMachineConfig(config);

  return workspace.path;
}

/**
 * Find a workspace by name.
 * Returns array of matches (may be multiple if names are not unique).
 */
export function findWorkspacesByName(name: string): RegisteredWorkspace[] {
  const config = readMachineConfig();
  return config.workspaces.filter(
    (w) => w.name.toLowerCase() === name.toLowerCase()
  );
}

/**
 * Find a workspace by path.
 */
export function findWorkspaceByPath(
  workspacePath: string
): RegisteredWorkspace | null {
  const config = readMachineConfig();
  const normalized = normalizePath(workspacePath);
  return (
    config.workspaces.find((w) => normalizePath(w.path) === normalized) || null
  );
}

/**
 * Check if a workspace path is registered.
 */
export function isWorkspaceRegistered(workspacePath: string): boolean {
  return findWorkspaceByPath(workspacePath) !== null;
}

/**
 * Get workspace name from path (for existing HQ).
 * Reads the workspace config to get the name, or falls back to directory basename.
 */
export function getWorkspaceNameFromPath(workspacePath: string): string {
  const configPath = path.join(workspacePath, '.proletariat', 'config.json');

  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.name) {
        return config.name;
      }
    } catch {
      // Fall through to basename
    }
  }

  return path.basename(workspacePath);
}

/**
 * Check if a path has duplicate workspace names in the registry.
 */
export function hasDuplicateNames(): { name: string; paths: string[] }[] {
  const config = readMachineConfig();
  const nameMap = new Map<string, string[]>();

  for (const workspace of config.workspaces) {
    const existing = nameMap.get(workspace.name) || [];
    existing.push(workspace.path);
    nameMap.set(workspace.name, existing);
  }

  const duplicates: { name: string; paths: string[] }[] = [];
  for (const [name, paths] of nameMap) {
    if (paths.length > 1) {
      duplicates.push({ name, paths });
    }
  }

  return duplicates;
}
