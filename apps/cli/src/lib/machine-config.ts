import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { isValidHQ } from './workspace.js';

/**
 * Machine-level configuration for Proletariat headquarters.
 *
 * This module manages the ~/.proletariat/config.json registry that tracks
 * all known headquarters on the machine, solving the HQ discovery
 * chicken-and-egg problem.
 *
 * Registry schema:
 * {
 *   "version": "1.0.0",
 *   "headquarters": [
 *     { "name": "hq-name", "path": "/absolute/path", "registeredAt": "ISO8601" }
 *   ],
 *   "activeHeadquarters": "/absolute/path" | null
 * }
 */

export interface Organization {
  name: string;
  createdAt: string;
}

export interface RegisteredHeadquarters {
  name: string;
  path: string;
  registeredAt: string;
  orgName?: string;
}

/** @deprecated Use RegisteredHeadquarters instead */
export type RegisteredWorkspace = RegisteredHeadquarters;

export interface MachineConfig {
  type: 'machine';
  version: string;
  organizations: Organization[];
  headquarters: RegisteredHeadquarters[];
  activeHeadquarters: string | null;
  activeOrganization: string | null;
  /** @deprecated Use headquarters instead */
  workspaces?: RegisteredHeadquarters[];
  /** @deprecated Use activeHeadquarters instead */
  activeWorkspace?: string | null;
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
    type: 'machine',
    version: CONFIG_VERSION,
    organizations: [],
    headquarters: [],
    activeHeadquarters: null,
    activeOrganization: null,
  };
}

/**
 * Read the machine config file.
 * Returns a default empty config if file doesn't exist or is invalid.
 * Handles migration from old 'workspaces' format to new 'headquarters' format.
 */
export function readMachineConfig(): MachineConfig {
  const configPath = getMachineConfigPath();

  if (!fs.existsSync(configPath)) {
    return getDefaultConfig();
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as Partial<MachineConfig>;

    // Validate basic structure - check for either old or new format
    const hasOldFormat = Array.isArray(config.workspaces);
    const hasNewFormat = Array.isArray(config.headquarters);

    if (!config.version || (!hasOldFormat && !hasNewFormat)) {
      return getDefaultConfig();
    }

    // Migrate from old format if needed
    const headquarters = hasNewFormat
      ? config.headquarters!
      : (config.workspaces || []);

    const activeHeadquarters = config.activeHeadquarters ?? config.activeWorkspace ?? null;

    return {
      type: 'machine',
      version: config.version,
      organizations: config.organizations || [],
      headquarters,
      activeHeadquarters,
      activeOrganization: config.activeOrganization ?? null,
    };
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
 * Register a headquarters in the machine config.
 *
 * @param hqPath Absolute path to the headquarters (will be normalized)
 * @param name Optional HQ name (defaults to directory basename)
 * @param setActive If true, set as active HQ when no active HQ exists
 * @param orgName Optional organization name to associate this HQ with
 * @returns The registered headquarters entry
 */
export function registerHeadquarters(
  hqPath: string,
  name?: string,
  setActive: boolean = true,
  orgName?: string
): RegisteredHeadquarters {
  const normalizedPath = normalizePath(hqPath);
  const hqName = name || path.basename(normalizedPath);

  const config = readMachineConfig();

  // Check if already registered
  const existingIndex = config.headquarters.findIndex(
    (hq) => normalizePath(hq.path) === normalizedPath
  );

  const entry: RegisteredHeadquarters = {
    name: hqName,
    path: normalizedPath,
    registeredAt: new Date().toISOString(),
    orgName,
  };

  if (existingIndex >= 0) {
    // Update existing entry
    config.headquarters[existingIndex] = entry;
  } else {
    // Add new entry
    config.headquarters.push(entry);
  }

  // Set as active if requested and no active HQ exists
  if (setActive && !config.activeHeadquarters) {
    config.activeHeadquarters = normalizedPath;
  }

  writeMachineConfig(config);

  return entry;
}

/** @deprecated Use registerHeadquarters instead */
export const registerWorkspace = registerHeadquarters;

/**
 * Unregister a headquarters from the machine config.
 *
 * @param pathOrName HQ path or name to unregister
 * @returns true if HQ was found and removed, false otherwise
 */
export function unregisterHeadquarters(pathOrName: string): boolean {
  const config = readMachineConfig();
  const normalizedInput = normalizePath(pathOrName);

  const initialLength = config.headquarters.length;

  // Try to match by path first, then by name
  config.headquarters = config.headquarters.filter((hq) => {
    const normalizedHqPath = normalizePath(hq.path);
    return normalizedHqPath !== normalizedInput && hq.name !== pathOrName;
  });

  const removed = config.headquarters.length < initialLength;

  if (removed) {
    // Clear active HQ if it was the removed one
    if (config.activeHeadquarters) {
      const normalizedActive = normalizePath(config.activeHeadquarters);
      const stillExists = config.headquarters.some(
        (hq) => normalizePath(hq.path) === normalizedActive
      );
      if (!stillExists) {
        config.activeHeadquarters = null;
      }
    }

    writeMachineConfig(config);
  }

  return removed;
}

/** @deprecated Use unregisterHeadquarters instead */
export const unregisterWorkspace = unregisterHeadquarters;

/**
 * Get all registered headquarters.
 */
export function getRegisteredHeadquarters(): RegisteredHeadquarters[] {
  const config = readMachineConfig();
  return config.headquarters;
}

/** @deprecated Use getRegisteredHeadquarters instead */
export const getRegisteredWorkspaces = getRegisteredHeadquarters;

/**
 * Get the active headquarters path.
 * Returns null if no active HQ is set.
 */
export function getActiveHeadquarters(): string | null {
  const config = readMachineConfig();
  return config.activeHeadquarters;
}

/** @deprecated Use getActiveHeadquarters instead */
export const getActiveWorkspace = getActiveHeadquarters;

/**
 * Set the active headquarters.
 *
 * @param pathOrName HQ path or name
 * @returns The path of the HQ that was set as active
 * @throws Error if HQ not found or not valid
 */
export function setActiveHeadquarters(pathOrName: string): string {
  const config = readMachineConfig();
  const normalizedInput = normalizePath(pathOrName);

  // Find HQ by path or name
  let hq = config.headquarters.find(
    (h) => normalizePath(h.path) === normalizedInput
  );

  if (!hq) {
    // Try matching by name
    const matches = config.headquarters.filter((h) => h.name === pathOrName);
    if (matches.length === 0) {
      throw new Error(`Headquarters not found: ${pathOrName}`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple headquarters found with name "${pathOrName}". Please use the full path instead.`
      );
    }
    hq = matches[0];
  }

  // Validate HQ still exists on filesystem
  if (!fs.existsSync(hq.path)) {
    throw new Error(`Headquarters path no longer exists: ${hq.path}`);
  }

  // Validate it's still a valid HQ
  if (!isValidHQ(hq.path)) {
    throw new Error(`Path is no longer a valid headquarters: ${hq.path}`);
  }

  config.activeHeadquarters = hq.path;
  writeMachineConfig(config);

  return hq.path;
}

/** @deprecated Use setActiveHeadquarters instead */
export const setActiveWorkspace = setActiveHeadquarters;

/**
 * Find headquarters by name.
 * Returns array of matches (may be multiple if names are not unique).
 */
export function findHeadquartersByName(name: string): RegisteredHeadquarters[] {
  const config = readMachineConfig();
  return config.headquarters.filter(
    (hq) => hq.name.toLowerCase() === name.toLowerCase()
  );
}

/** @deprecated Use findHeadquartersByName instead */
export const findWorkspacesByName = findHeadquartersByName;

/**
 * Find headquarters by path.
 */
export function findHeadquartersByPath(
  hqPath: string
): RegisteredHeadquarters | null {
  const config = readMachineConfig();
  const normalized = normalizePath(hqPath);
  return (
    config.headquarters.find((hq) => normalizePath(hq.path) === normalized) || null
  );
}

/** @deprecated Use findHeadquartersByPath instead */
export const findWorkspaceByPath = findHeadquartersByPath;

/**
 * Check if a headquarters path is registered.
 */
export function isHeadquartersRegistered(hqPath: string): boolean {
  return findHeadquartersByPath(hqPath) !== null;
}

/** @deprecated Use isHeadquartersRegistered instead */
export const isWorkspaceRegistered = isHeadquartersRegistered;

/**
 * Get headquarters name from path (for existing HQ).
 * Reads the HQ config to get the name, or falls back to directory basename.
 */
export function getHeadquartersNameFromPath(hqPath: string): string {
  const configPath = path.join(hqPath, '.proletariat', 'config.json');

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

  return path.basename(hqPath);
}

/** @deprecated Use getHeadquartersNameFromPath instead */
export const getWorkspaceNameFromPath = getHeadquartersNameFromPath;

/**
 * Check if there are duplicate headquarters names in the registry.
 */
export function hasDuplicateNames(): { name: string; paths: string[] }[] {
  const config = readMachineConfig();
  const nameMap = new Map<string, string[]>();

  for (const hq of config.headquarters) {
    const existing = nameMap.get(hq.name) || [];
    existing.push(hq.path);
    nameMap.set(hq.name, existing);
  }

  const duplicates: { name: string; paths: string[] }[] = [];
  for (const [name, paths] of nameMap) {
    if (paths.length > 1) {
      duplicates.push({ name, paths });
    }
  }

  return duplicates;
}

// =============================================================================
// Organization Management
// =============================================================================

/**
 * Get all organizations.
 */
export function getOrganizations(): Organization[] {
  const config = readMachineConfig();
  return config.organizations;
}

/**
 * Get the active organization name.
 */
export function getActiveOrganization(): string | null {
  const config = readMachineConfig();
  return config.activeOrganization;
}

/**
 * Create a new organization.
 */
export function createOrganization(name: string): Organization {
  const config = readMachineConfig();

  // Check if organization already exists
  const existing = config.organizations.find(
    (o) => o.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    return existing;
  }

  const org: Organization = {
    name,
    createdAt: new Date().toISOString(),
  };

  config.organizations.push(org);

  // Set as active if it's the first organization
  if (!config.activeOrganization) {
    config.activeOrganization = name;
  }

  writeMachineConfig(config);
  return org;
}

/**
 * Set the active organization.
 */
export function setActiveOrganization(name: string): void {
  const config = readMachineConfig();

  // Find organization (case-insensitive)
  const org = config.organizations.find(
    (o) => o.name.toLowerCase() === name.toLowerCase()
  );

  if (!org) {
    throw new Error(`Organization not found: ${name}`);
  }

  config.activeOrganization = org.name;
  writeMachineConfig(config);
}

/**
 * Get headquarters belonging to a specific organization.
 */
export function getOrganizationHeadquarters(orgName: string): RegisteredHeadquarters[] {
  const config = readMachineConfig();
  return config.headquarters.filter(
    (hq) => hq.orgName?.toLowerCase() === orgName.toLowerCase()
  );
}

/** @deprecated Use getOrganizationHeadquarters instead */
export const getOrganizationWorkspaces = getOrganizationHeadquarters;
