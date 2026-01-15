/**
 * Path Resolution Utilities
 *
 * Centralizes all path resolution for the .proletariat directory.
 * Supports PRLT_HOME environment variable to override the default location,
 * enabling isolated testing and multi-agent development workflows.
 *
 * Resolution order: PRLT_HOME env var > ~/.proletariat
 */

import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Get the global proletariat home directory.
 *
 * This is the root directory for:
 * - Global config (config.json)
 * - Logs directory
 * - Scripts directory
 *
 * @returns The path to the proletariat home directory
 *
 * @example
 * // Default: ~/.proletariat
 * // With PRLT_HOME=/tmp/test: /tmp/test
 */
export function getPrltHome(): string {
  return process.env.PRLT_HOME || path.join(os.homedir(), '.proletariat');
}

/**
 * Get the global config file path.
 *
 * @returns Path to the global config.json
 */
export function getGlobalConfigPath(): string {
  return path.join(getPrltHome(), 'config.json');
}

/**
 * Get the global logs directory path.
 *
 * @returns Path to the logs directory
 */
export function getLogsDir(): string {
  return path.join(getPrltHome(), 'logs');
}

/**
 * Get the global scripts directory path.
 *
 * @param hqPath Optional HQ path to use instead of global location
 * @returns Path to the scripts directory
 */
export function getScriptsDir(hqPath?: string): string {
  if (hqPath) {
    return path.join(hqPath, '.proletariat', 'scripts');
  }
  return path.join(getPrltHome(), 'scripts');
}
