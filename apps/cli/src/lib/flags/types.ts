/**
 * Types for the FlagResolver abstraction
 *
 * The FlagResolver unifies human interactive mode and JSON mode by treating
 * both as "flag producers". Commands declare what flags they need, and the
 * resolver handles obtaining values through prompts or CLI args.
 */

import type { PromptChoice } from '../prompt-json.js'

/**
 * Supported flag value types
 */
export type FlagValue = string | boolean | string[] | undefined

/**
 * Prompt type for flag collection
 */
export type PromptType = 'list' | 'checkbox' | 'input' | 'confirm' | 'editor'

/**
 * Context passed to dynamic functions (when, choices, validate)
 */
export interface ResolverContext {
  /** Already resolved flag values */
  resolved: Record<string, FlagValue>
  /** Original CLI flags passed to the command */
  cliFlags: Record<string, unknown>
}

/**
 * Choice definition for list/checkbox prompts
 */
export interface FlagChoice {
  /** Display name shown to user */
  name: string
  /** Actual value returned when selected */
  value: string
  /** Optional: whether this choice is disabled */
  disabled?: boolean | string
  /**
   * Optional: command to run for this choice (for AI agents)
   * Can be a static string or function that receives the base command
   */
  command?: string
}

/**
 * Definition for a single flag to be resolved
 */
export interface FlagDefinition<T extends FlagValue = FlagValue> {
  /** The CLI flag name (e.g., 'column', 'title') */
  name: string

  /**
   * Type of value:
   * - 'string': single string value (input or list prompt)
   * - 'boolean': true/false (confirm prompt)
   * - 'array': multiple values (checkbox prompt)
   */
  type: 'string' | 'boolean' | 'array'

  /**
   * Prompt type to use when collecting this value
   * Defaults based on type: string->input, boolean->confirm, array->checkbox
   */
  promptType?: PromptType

  /** Whether this flag is required (default: false) */
  required?: boolean

  /** Default value if not provided */
  default?: T | ((ctx: ResolverContext) => T | Promise<T>)

  /** User-facing message for the prompt */
  message: string | ((ctx: ResolverContext) => string)

  /**
   * Choices for list/checkbox prompts
   * Can be static array or async function
   */
  choices?: FlagChoice[] | ((ctx: ResolverContext) => FlagChoice[] | Promise<FlagChoice[]>)

  /**
   * Condition for when this flag should be resolved
   * Return false to skip this flag entirely
   */
  when?: (ctx: ResolverContext) => boolean | Promise<boolean>

  /**
   * Validation function
   * Return true if valid, or error message string if invalid
   */
  validate?: (value: T, ctx: ResolverContext) => boolean | string | Promise<boolean | string>

  /**
   * Transform the flag name for the command string (e.g., 'skipPermissions' -> '--skip-permissions')
   * By default, converts camelCase to --kebab-case
   */
  flagArg?: string

  /**
   * Context data to include in JSON output (for AI agents)
   */
  context?: Record<string, unknown> | ((ctx: ResolverContext) => Record<string, unknown>)

  /**
   * Priority for resolution order (lower = earlier). Default: 100
   * Use this to ensure dependent flags are resolved after their dependencies
   */
  priority?: number
}

/**
 * Options for creating a FlagResolver
 */
export interface FlagResolverOptions {
  /** Command name for metadata (e.g., 'ticket create') */
  commandName: string

  /** Base command for generating follow-up commands (e.g., 'prlt ticket create') */
  baseCommand: string

  /** CLI flags passed to the command */
  flags: Record<string, unknown>

  /** Whether to use JSON output mode (auto-detected if not provided) */
  jsonMode?: boolean

  /**
   * Current resolved values (useful for resuming resolution)
   * Values here are treated as already-provided CLI flags
   */
  initialValues?: Record<string, FlagValue>
}

/**
 * Result of flag resolution
 */
export interface ResolvedFlags<T extends Record<string, FlagValue> = Record<string, FlagValue>> {
  /** All resolved flag values */
  values: T

  /** Whether resolution completed (false if JSON output was emitted) */
  complete: boolean

  /** Base command with all resolved flags (for JSON mode context) */
  commandWithFlags: string
}

/**
 * Metadata about a prompt that was output in JSON mode
 */
export interface PendingPrompt {
  /** Flag name that needs a value */
  flagName: string

  /** Prompt configuration that was output */
  prompt: {
    type: PromptType
    name: string
    message: string
    choices?: PromptChoice[]
    default?: FlagValue
    context?: Record<string, unknown>
  }
}
