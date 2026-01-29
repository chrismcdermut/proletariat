/**
 * Deprecation Warning Utilities
 *
 * Provides consistent deprecation warnings for migrating from positional arguments
 * to named flags. Per ticket TKT-679, all CLI arguments should use named flags:
 *
 * Pattern: prlt <namespace> <command> --named-args
 *
 * Example:
 *   Old: prlt ticket view TKT-123
 *   New: prlt ticket view --id TKT-123
 */

import { styles } from './styles.js';

/**
 * Shows a deprecation warning when a positional argument is used instead of a named flag.
 *
 * @param log - The logging function (typically this.log from a command)
 * @param argName - The name of the positional argument being deprecated
 * @param flagName - The new flag name to use (e.g., '--id')
 * @param value - The value that was passed positionally
 * @param commandExample - Optional full command example showing the new usage
 *
 * @example
 * // In a command's execute() method:
 * if (args.ticketId) {
 *   warnDeprecatedPositionalArg(this.log.bind(this), 'ticketId', '--id', args.ticketId, 'prlt ticket view --id TKT-123');
 * }
 */
export function warnDeprecatedPositionalArg(
  log: (message: string) => void,
  argName: string,
  flagName: string,
  value: string,
  commandExample?: string
): void {
  log(styles.warning(`\nDeprecation Warning: Positional argument '${argName}' is deprecated.`));
  log(styles.warning(`  Please use '${flagName} ${value}' instead.`));
  if (commandExample) {
    log(styles.muted(`  Example: ${commandExample}`));
  }
  log(styles.muted(`  Positional arguments will be removed in a future version.\n`));
}

/**
 * Configuration for a deprecated positional argument
 */
export interface DeprecatedArg {
  /** The name of the positional argument (as defined in static args) */
  argName: string;
  /** The new flag name to use (e.g., '--id') */
  flagName: string;
  /** Function to generate the example command with the new syntax */
  getExample?: (value: string) => string;
}

/**
 * Handles a potentially deprecated positional argument.
 * Returns the resolved value (from flag if provided, otherwise from positional arg).
 * Shows deprecation warning if positional arg was used.
 *
 * @param log - The logging function (typically this.log from a command)
 * @param args - The parsed args object from oclif
 * @param flags - The parsed flags object from oclif
 * @param config - Configuration for the deprecated argument
 * @returns The resolved value (flag takes precedence over positional arg)
 *
 * @example
 * const id = resolveDeprecatedArg(
 *   this.log.bind(this),
 *   args,
 *   flags,
 *   {
 *     argName: 'ticketId',
 *     flagName: '--id',
 *     getExample: (v) => `prlt ticket view --id ${v}`
 *   }
 * );
 */
export function resolveDeprecatedArg(
  log: (message: string) => void,
  args: Record<string, string | undefined>,
  flags: Record<string, unknown>,
  config: DeprecatedArg
): string | undefined {
  // Flag name without the -- prefix for accessing the flags object
  const flagKey = config.flagName.replace(/^--/, '');
  const flagValue = flags[flagKey] as string | undefined;
  const argValue = args[config.argName];

  // Flag takes precedence
  if (flagValue !== undefined) {
    return flagValue;
  }

  // If positional arg was used, warn about deprecation
  if (argValue !== undefined) {
    const example = config.getExample ? config.getExample(argValue) : undefined;
    warnDeprecatedPositionalArg(log, config.argName, config.flagName, argValue, example);
    return argValue;
  }

  return undefined;
}

/**
 * Handles multiple deprecated positional arguments at once.
 * Returns an object with resolved values for each argument.
 *
 * @param log - The logging function
 * @param args - The parsed args object from oclif
 * @param flags - The parsed flags object from oclif
 * @param configs - Array of configurations for deprecated arguments
 * @returns Object with resolved values keyed by flag name (without --)
 */
export function resolveDeprecatedArgs(
  log: (message: string) => void,
  args: Record<string, string | undefined>,
  flags: Record<string, unknown>,
  configs: DeprecatedArg[]
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};

  for (const config of configs) {
    const flagKey = config.flagName.replace(/^--/, '');
    result[flagKey] = resolveDeprecatedArg(log, args, flags, config);
  }

  return result;
}
