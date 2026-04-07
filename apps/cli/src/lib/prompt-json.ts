/**
 * Machine-readable output helper for interactive prompts
 *
 * Provides utilities for outputting prompt configurations as JSON
 * instead of rendering interactive UI, enabling AI agents and scripts
 * to interact with the CLI programmatically.
 *
 * Design notes:
 * - Stateless functions for easy unit testing
 * - Designed for future extraction as standalone npm package
 * - Supports both explicit --json flag and automatic non-TTY detection
 *
 * Exit code conventions:
 * - EXIT_SUCCESS (0): Command completed successfully
 * - EXIT_ERROR (1): Command failed with an error
 * - EXIT_NEEDS_INPUT (2): Command needs additional input (prompt required)
 */

import { Errors } from '@oclif/core'

/**
 * Exit code for successful command completion
 */
export const EXIT_SUCCESS = 0

/**
 * Exit code for command failure/error
 */
export const EXIT_ERROR = 1

/**
 * Exit code when command needs additional input (prompt required)
 * Use this exit code when outputting a prompt in JSON mode to signal
 * to scripts/agents that the command didn't fail, but needs more input.
 */
export const EXIT_NEEDS_INPUT = 2

/**
 * Choice item for list/checkbox prompts
 */
export interface PromptChoice {
  /** Display text shown to user */
  name: string
  /** Actual value returned when selected */
  value: string
  /** Optional: indicates if choice is disabled */
  disabled?: boolean
  /** Optional: full CLI command to run for this choice (for AI agents) */
  command?: string
}

/**
 * Form field configuration for multi-field prompts
 */
export interface FormField {
  /** Type of field: input, list, checkbox, confirm, editor, multiline */
  type: 'input' | 'list' | 'checkbox' | 'confirm' | 'editor' | 'multiline'
  /** Field name */
  name: string
  /** User-facing message */
  message: string
  /** Available choices (for list/checkbox types) */
  choices?: PromptChoice[]
  /** Default value if applicable */
  default?: string | boolean | string[]
}

/**
 * Prompt configuration for JSON output
 */
export interface PromptConfig {
  /** Type of prompt: list (single select), checkbox (multi select), confirm, input, editor, multiline (inline multi-line), or form (multi-field) */
  type: 'list' | 'checkbox' | 'confirm' | 'input' | 'editor' | 'multiline' | 'form'
  /** Field name for the prompt answer (not used for form type) */
  name?: string
  /** User-facing prompt message (not used for form type) */
  message?: string
  /** Available choices (for list/checkbox types) */
  choices?: PromptChoice[]
  /** Default value if applicable */
  default?: string | boolean | string[]
  /** Fields for form type prompts */
  fields?: FormField[]
  /** Optional context data for complex prompts */
  context?: Record<string, unknown>
}

/**
 * Metadata included with all JSON outputs
 */
export interface OutputMetadata {
  /** Command that was invoked (e.g., "work spawn") */
  command: string
  /** Flags that were passed to the command */
  flags: Record<string, unknown>
  /** Timestamp of the output */
  timestamp?: string
  /** Resolved PR mode after flag precedence ('create-pr' | 'no-pr') */
  resolvedPRMode?: string
  /** Source of the resolved PR mode (e.g., 'flag --create-pr', 'workspace config', 'interactive prompt') */
  prModeSource?: string
  /** Warning message when PR creation is disabled for code-modifying actions */
  prWarning?: string
  /** External issue context propagated by work start confirmation flow */
  externalIssue?: {
    source: string | null
    key: string | null
    id: string | null
    url: string | null
  }
  /** Resolved mirror-to-PMO behavior for --from-issue flow */
  mirrorToPmo?: boolean | null
  /** Source used to resolve mirror-to-PMO behavior */
  mirrorToPmoSource?: string | null
  /** How the external issue source was resolved (flag, active-source, interactive) */
  sourceResolution?: {
    method: string
    provider: string
  }
  /** Dry-run mode indicator (PRLT-1132) */
  dryRun?: boolean
  /** Resolved execution environment */
  environment?: string
  /** Resolved executor type */
  executor?: string
  /** Preflight check results (PRLT-1132) */
  preflight?: {
    passed: boolean
    checks: Array<{
      name: string
      label: string
      passed: boolean
      severity: string
      message: string
      fix: string | null
    }>
    errors: number
    warnings: number
  }
  /** Error message from spawn failure */
  spawnError?: string
  /** Diagnostic check results after spawn failure */
  diagnostics?: Array<{
    check: string
    message: string
    fix: string | null
  }>
}

/**
 * JSON output when a prompt would be shown
 */
export interface PromptJsonOutput {
  /** Output type discriminator */
  type: 'prompt'
  /** Prompt configuration, or null if no prompt needed */
  prompt: PromptConfig | null
  /** Command metadata */
  metadata: OutputMetadata
}

/**
 * JSON output for successful command execution (no prompt needed)
 */
export interface SuccessJsonOutput {
  /** Output type discriminator */
  type: 'success'
  /** Always null when success output */
  prompt: null
  /** Indicates successful execution */
  success: true
  /** Command-specific result data */
  result: Record<string, unknown>
  /** Command metadata */
  metadata: OutputMetadata
}

/**
 * JSON output for error conditions
 */
export interface ErrorJsonOutput {
  /** Output type discriminator */
  type: 'error'
  /** Error details */
  error: {
    /** Machine-readable error code (e.g., "NO_TICKETS_AVAILABLE") */
    code: string
    /** Human-readable error message */
    message: string
  }
  /** Command metadata */
  metadata: OutputMetadata
}

/**
 * JSON output for dry-run validation (what would happen)
 */
export interface DryRunJsonOutput {
  /** Indicates this is a dry-run result */
  type: 'dry-run'
  /** Whether the inputs are valid */
  valid: boolean
  /** What would be created if valid */
  wouldCreate?: {
    type: string
    [key: string]: unknown
  }
  /** Validation errors if invalid */
  errors?: Array<{
    field: string
    error: string
  }>
  /** Command metadata */
  metadata: OutputMetadata
}

/**
 * JSON output for confirmation needed (two-step execute protocol)
 * Used when all required flags are provided but --yes is not set.
 * Agent should review the plan and re-run with --yes to execute.
 */
export interface ConfirmationNeededJsonOutput {
  /** Output type discriminator */
  type: 'confirmation_needed'
  /** Plan of what will happen if confirmed */
  plan: Record<string, unknown>
  /** The full command to run to confirm and execute */
  confirm_command: string
  /** Human-readable message */
  message: string
  /** Command metadata */
  metadata: OutputMetadata
}

/**
 * JSON output for execution result (after successful spawn/start)
 */
export interface ExecutionResultJsonOutput {
  /** Output type discriminator */
  type: 'execution_result'
  /** Execution results */
  result: {
    executions: Array<{
      workId: string
      ticketId: string
      agent: string
      sessionId?: string
      containerId?: string
      status: string
      /** Error message when status is 'failed' (PRLT-1132) */
      error?: string
    }>
    successCount: number
    failCount: number
  }
  /** Command metadata */
  metadata: OutputMetadata
}

/**
 * Schema entry for a single flag/arg in a validation_error envelope.
 *
 * Generated by introspecting an oclif command's flag definitions.
 * Provides agents with everything they need to understand what value
 * a flag accepts: type, allowed choices, default, requirement status,
 * and a human-readable description.
 */
export interface FlagSchemaEntry {
  /** Inquirer-style prompt type (matches PromptConfig.type) */
  type: 'list' | 'input' | 'confirm' | 'checkbox'
  /** Allowed values for `list` type flags (from oclif `options`) */
  choices?: string[]
  /** Default value if the user doesn't supply one */
  default?: string | boolean | number | null
  /** Whether the flag is required */
  required?: boolean
  /** Human-readable description from the oclif flag definition */
  description?: string
  /** Optional short character flag (e.g. "p" for -p) */
  char?: string
}

/**
 * JSON output for validation errors (PRLT-1269)
 *
 * Emitted automatically by the base command when oclif parsing fails
 * (missing required flag/arg, invalid choice, etc.) and the command is
 * running in machine/agent mode. Provides a structured schema so agents
 * can self-correct without parsing human-readable error text.
 */
export interface ValidationErrorJsonOutput {
  /** Output type discriminator */
  type: 'validation_error'
  /** Command that was invoked (e.g., "asana connect") */
  command: string
  /** Reason summary (e.g., "missing_required_flags", "invalid_flag_value") */
  reason: string
  /** Human-readable error message (preserves the oclif text for debugging) */
  message: string
  /** Names of flags or args that are missing or invalid */
  missing: string[]
  /** Schema for every relevant flag/arg, keyed by name */
  schema: Record<string, FlagSchemaEntry>
  /** Command metadata (filtered flags + timestamp) */
  metadata: OutputMetadata
}

/**
 * Union type for all JSON output types
 */
export type JsonOutput = PromptJsonOutput | SuccessJsonOutput | ErrorJsonOutput | DryRunJsonOutput | ConfirmationNeededJsonOutput | ExecutionResultJsonOutput | ValidationErrorJsonOutput

/**
 * All valid JSON envelope type discriminators.
 * Used for contract tests and schema validation.
 */
export const JSON_ENVELOPE_TYPES = [
  'prompt',
  'success',
  'error',
  'dry-run',
  'confirmation_needed',
  'execution_result',
  'validation_error',
] as const

export type JsonEnvelopeType = typeof JSON_ENVELOPE_TYPES[number]

/**
 * Required fields per envelope type for contract validation.
 * Tests use this to verify no fields are accidentally removed.
 */
export const JSON_ENVELOPE_REQUIRED_FIELDS: Record<JsonEnvelopeType, string[]> = {
  prompt: ['type', 'prompt', 'metadata'],
  success: ['type', 'prompt', 'success', 'result', 'metadata'],
  error: ['type', 'error', 'metadata'],
  'dry-run': ['type', 'valid', 'metadata'],
  confirmation_needed: ['type', 'plan', 'confirm_command', 'message', 'metadata'],
  execution_result: ['type', 'result', 'metadata'],
  validation_error: ['type', 'command', 'reason', 'message', 'missing', 'schema', 'metadata'],
}

/**
 * Validate that a parsed JSON object conforms to the machine-mode envelope schema.
 *
 * Returns an array of validation errors (empty = valid).
 * Useful for contract tests and runtime validation of JSON output.
 *
 * @param obj - Parsed JSON object to validate
 * @returns Array of validation error strings (empty if valid)
 */
export function validateJsonEnvelope(obj: unknown): string[] {
  const errors: string[] = []

  if (typeof obj !== 'object' || obj === null) {
    errors.push('Output must be a non-null object')
    return errors
  }

  const record = obj as Record<string, unknown>

  // Check type discriminator
  if (!('type' in record)) {
    errors.push('Missing required field: type')
    return errors
  }

  const type = record.type as string
  if (!JSON_ENVELOPE_TYPES.includes(type as JsonEnvelopeType)) {
    errors.push(`Invalid envelope type: "${type}". Must be one of: ${JSON_ENVELOPE_TYPES.join(', ')}`)
    return errors
  }

  // Check required fields for this type
  const requiredFields = JSON_ENVELOPE_REQUIRED_FIELDS[type as JsonEnvelopeType]
  for (const field of requiredFields) {
    if (!(field in record)) {
      errors.push(`Missing required field for type "${type}": ${field}`)
    }
  }

  // Validate metadata structure
  if ('metadata' in record && record.metadata !== undefined) {
    const metadata = record.metadata as Record<string, unknown>
    if (typeof metadata !== 'object' || metadata === null) {
      errors.push('metadata must be a non-null object')
    } else {
      if (!('command' in metadata) || typeof metadata.command !== 'string') {
        errors.push('metadata.command must be a string')
      }
      if (!('flags' in metadata) || typeof metadata.flags !== 'object') {
        errors.push('metadata.flags must be an object')
      }
    }
  }

  // Type-specific validation
  if (type === 'prompt' && 'prompt' in record && record.prompt !== null) {
    const prompt = record.prompt as Record<string, unknown>
    if (!('type' in prompt)) {
      errors.push('prompt.type is required when prompt is non-null')
    }
  }

  if (type === 'error' && 'error' in record) {
    const error = record.error as Record<string, unknown>
    if (typeof error !== 'object' || error === null) {
      errors.push('error must be a non-null object')
    } else {
      if (!('code' in error) || typeof error.code !== 'string') {
        errors.push('error.code must be a string')
      }
      if (!('message' in error) || typeof error.message !== 'string') {
        errors.push('error.message must be a string')
      }
    }
  }

  if (type === 'success') {
    if (record.success !== true) {
      errors.push('success field must be true for success type')
    }
    if (record.prompt !== null) {
      errors.push('prompt field must be null for success type')
    }
  }

  if (type === 'confirmation_needed') {
    if (typeof record.confirm_command !== 'string' || !record.confirm_command) {
      errors.push('confirm_command must be a non-empty string')
    }
  }

  if (type === 'validation_error') {
    if (typeof record.command !== 'string' || !record.command) {
      errors.push('command must be a non-empty string')
    }
    if (typeof record.reason !== 'string' || !record.reason) {
      errors.push('reason must be a non-empty string')
    }
    if (typeof record.message !== 'string') {
      errors.push('message must be a string')
    }
    if (!Array.isArray(record.missing)) {
      errors.push('missing must be an array')
    }
    if (typeof record.schema !== 'object' || record.schema === null) {
      errors.push('schema must be a non-null object')
    }
  }

  return errors
}

/**
 * Flags interface for JSON mode detection
 */
export interface JsonFlags {
  json?: boolean
  machine?: boolean
}

/**
 * Flags interface for machine-readable output mode detection
 * --json and --machine/-m both trigger JSON output mode
 */
export interface MachineOutputFlags {
  /** JSON output flag */
  json?: boolean
  /** Machine output flag (-m shorthand) */
  machine?: boolean
}

/**
 * Check if the current environment is non-TTY (piped input or output)
 *
 * Uses the "either" strategy: returns true if EITHER stdin OR stdout is non-TTY.
 * This covers the primary use case of scripts/agents calling prlt as a subprocess,
 * where both stdin and stdout are typically non-TTY.
 *
 * Returns true if:
 * - stdin is not a TTY (e.g., piped input)
 * - stdout is not a TTY (e.g., piped output)
 * - PRLT_JSON=1 environment variable is set (overrides TTY detection)
 *
 * Returns false if:
 * - PRLT_FORCE_TEXT=1 is set (forces text output in non-TTY environments, useful for testing)
 *
 * @returns true if either stdin or stdout is not a TTY, or PRLT_JSON=1 is set
 */
export function isNonTTY(): boolean {
  // PRLT_FORCE_TEXT overrides non-TTY detection, forcing human-readable text output.
  // Used in E2E tests where execSync creates a non-TTY child process but tests
  // assert on styled text output.
  if (process.env.PRLT_FORCE_TEXT === '1' || process.env.PRLT_FORCE_TEXT === 'true') {
    return false
  }
  if (process.env.PRLT_JSON === '1' || process.env.PRLT_JSON === 'true') {
    return true
  }
  return !process.stdout.isTTY || !process.stdin.isTTY
}

/**
 * Determine if JSON output mode is active (for AI agents)
 *
 * Returns true if:
 * - The --json flag is set (or -m/--machine aliases)
 * - The PRLT_JSON=1 environment variable is set
 * - Either stdin or stdout is non-TTY (piped input/output)
 *
 * @param flags - Command flags object
 * @returns true if JSON mode should be used
 */
export function shouldOutputJson(flags: JsonFlags): boolean {
  // --json flag or --machine/-m flag
  if (flags.json === true || flags.machine === true) {
    return true
  }

  // Automatic detection for non-TTY environments (includes PRLT_JSON env var)
  return isNonTTY()
}

/**
 * Alias for shouldOutputJson - clearer name for agent-focused code
 */
export const isAgentMode = shouldOutputJson

/**
 * Determine if machine-readable output mode is active (for AI agents/scripts)
 *
 * Returns true if:
 * - The --json flag is set (or -m/--machine aliases)
 * - The PRLT_JSON=1 environment variable is set
 * - Either stdin or stdout is non-TTY (piped input/output)
 *
 * @param flags - Command flags object
 * @returns true if machine-readable output mode should be used
 */
export function isMachineOutput(flags: MachineOutputFlags): boolean {
  // --json flag or --machine/-m flag
  if (flags.json === true || flags.machine === true) {
    return true
  }

  // Automatic detection for non-TTY environments (includes PRLT_JSON env var)
  return isNonTTY()
}

/**
 * Create metadata object for JSON output
 *
 * @param command - Command name (e.g., "work spawn")
 * @param flags - Flags passed to the command
 * @returns Metadata object
 */
export function createMetadata(
  command: string,
  flags: Record<string, unknown>
): OutputMetadata {
  // Filter out internal/sensitive flags
  const filteredFlags: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(flags)) {
    // Skip undefined values and internal flags
    if (value !== undefined && !key.startsWith('_')) {
      filteredFlags[key] = value
    }
  }

  return {
    command,
    flags: filteredFlags,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Output a prompt configuration as JSON and halt command execution
 *
 * Use this when a command would normally show an interactive prompt.
 * Outputs the prompt config so agents can understand what input is needed,
 * then throws oclif ExitError to stop execution while still allowing
 * postrun hooks to fire (unlike process.exit which bypasses them).
 *
 * @param config - Prompt configuration
 * @param metadata - Command metadata
 */
export function outputPromptAsJson(
  config: PromptConfig,
  metadata: OutputMetadata
): never {
  const output: PromptJsonOutput = {
    type: 'prompt',
    prompt: config,
    metadata,
  }
  console.log(JSON.stringify(output, null, 2))
  process.exitCode = EXIT_NEEDS_INPUT
  throw new Errors.ExitError(EXIT_NEEDS_INPUT)
}

/**
 * Output success result as JSON and halt command execution
 *
 * Use this when all required data was provided via flags
 * and no prompt is needed. Throws oclif ExitError to stop execution
 * while still allowing postrun hooks to fire.
 *
 * @param result - Command-specific result data
 * @param metadata - Command metadata
 */
export function outputSuccessAsJson(
  result: Record<string, unknown>,
  metadata: OutputMetadata
): never {
  const output: SuccessJsonOutput = {
    type: 'success',
    prompt: null,
    success: true,
    result,
    metadata,
  }
  console.log(JSON.stringify(output, null, 2))
  process.exitCode = EXIT_SUCCESS
  throw new Errors.ExitError(EXIT_SUCCESS)
}

/**
 * Output error as JSON and halt command execution
 *
 * Use this when an error occurs and --json flag is active.
 * Provides structured error output for programmatic handling.
 * Throws oclif ExitError to stop execution while still allowing
 * postrun hooks to fire.
 *
 * @param code - Machine-readable error code (e.g., "NO_TICKETS_AVAILABLE")
 * @param message - Human-readable error message
 * @param metadata - Command metadata
 */
export function outputErrorAsJson(
  code: string,
  message: string,
  metadata: OutputMetadata
): never {
  const output: ErrorJsonOutput = {
    type: 'error',
    error: {
      code,
      message,
    },
    metadata,
  }
  console.log(JSON.stringify(output, null, 2))
  process.exitCode = EXIT_ERROR
  throw new Errors.ExitError(EXIT_ERROR)
}

/**
 * Convert inquirer choices to PromptChoice format
 *
 * Handles both simple string choices and object choices,
 * filtering out Separator instances.
 *
 * @param choices - Inquirer choices array
 * @returns Array of PromptChoice objects
 */
export function normalizeChoices(
  choices: Array<string | { name: string; value: string; disabled?: boolean | string; command?: string } | unknown>
): PromptChoice[] {
  const normalized: PromptChoice[] = []

  for (const choice of choices) {
    // Skip Separator instances (they have a 'type' property set to 'separator')
    if (
      typeof choice === 'object' &&
      choice !== null &&
      'type' in choice &&
      (choice as { type: string }).type === 'separator'
    ) {
      continue
    }

    // Handle string choices
    if (typeof choice === 'string') {
      normalized.push({ name: choice, value: choice })
      continue
    }

    // Handle object choices
    if (
      typeof choice === 'object' &&
      choice !== null &&
      'name' in choice &&
      'value' in choice
    ) {
      const obj = choice as { name: string; value: string; disabled?: boolean | string; command?: string }
      normalized.push({
        name: obj.name,
        value: String(obj.value),
        ...(obj.disabled !== undefined && { disabled: Boolean(obj.disabled) }),
        ...(obj.command !== undefined && { command: obj.command }),
      })
    }
  }

  return normalized
}

/**
 * Build a prompt config object from inquirer prompt options
 *
 * @param type - Prompt type
 * @param name - Field name
 * @param message - User-facing message
 * @param choices - Optional choices array
 * @param defaultValue - Optional default value
 * @returns PromptConfig object
 */
export function buildPromptConfig(
  type: 'list' | 'checkbox' | 'confirm' | 'input' | 'editor' | 'multiline',
  name: string,
  message: string,
  choices?: Array<string | { name: string; value: string; disabled?: boolean | string; command?: string } | unknown>,
  defaultValue?: string | boolean | string[]
): PromptConfig {
  const config: PromptConfig = {
    type,
    name,
    message,
  }

  if (choices) {
    config.choices = normalizeChoices(choices)
  }

  if (defaultValue !== undefined) {
    config.default = defaultValue
  }

  return config
}

/**
 * Build a form prompt config with multiple fields
 *
 * @param fields - Array of form field configurations
 * @returns PromptConfig object with type 'form'
 */
export function buildFormPromptConfig(
  fields: FormField[]
): PromptConfig {
  return {
    type: 'form',
    fields,
  }
}

/**
 * Output a successful dry-run result as JSON and halt command execution
 *
 * Use this when --dry-run is set and all validation passes.
 * Shows what would be created without actually creating it.
 * Throws oclif ExitError to stop execution while still allowing
 * postrun hooks to fire.
 *
 * @param entityType - Type of entity that would be created (e.g., "ticket", "project")
 * @param wouldCreate - Data about what would be created
 * @param metadata - Command metadata
 */
export function outputDryRunSuccessAsJson(
  entityType: string,
  wouldCreate: Record<string, unknown>,
  metadata: OutputMetadata
): never {
  const output: DryRunJsonOutput = {
    type: 'dry-run',
    valid: true,
    wouldCreate: {
      type: entityType,
      ...wouldCreate,
    },
    metadata,
  }
  console.log(JSON.stringify(output, null, 2))
  process.exitCode = EXIT_SUCCESS
  throw new Errors.ExitError(EXIT_SUCCESS)
}

/**
 * Output a dry-run validation failure as JSON and halt command execution
 *
 * Use this when --dry-run is set and validation fails.
 * Shows the validation errors without attempting to create.
 * Throws oclif ExitError to stop execution while still allowing
 * postrun hooks to fire.
 *
 * @param errors - Array of validation errors
 * @param metadata - Command metadata
 */
export function outputDryRunErrorsAsJson(
  errors: Array<{ field: string; error: string }>,
  metadata: OutputMetadata
): never {
  const output: DryRunJsonOutput = {
    type: 'dry-run',
    valid: false,
    errors,
    metadata,
  }
  console.log(JSON.stringify(output, null, 2))
  process.exitCode = EXIT_ERROR
  throw new Errors.ExitError(EXIT_ERROR)
}

/**
 * Output a confirmation needed response as JSON and halt command execution
 *
 * Use this in non-TTY mode when all required flags are provided but --yes is not set.
 * This allows agents to preview what will happen before confirming execution.
 * Throws oclif ExitError to stop execution while still allowing
 * postrun hooks to fire.
 *
 * @param plan - Details of what will happen if confirmed
 * @param confirmCommand - The full command to run with --yes to execute
 * @param message - Human-readable message explaining the confirmation
 * @param metadata - Command metadata
 */
export function outputConfirmationNeededAsJson(
  plan: Record<string, unknown>,
  confirmCommand: string,
  message: string,
  metadata: OutputMetadata
): never {
  const output: ConfirmationNeededJsonOutput = {
    type: 'confirmation_needed',
    plan,
    confirm_command: confirmCommand,
    message,
    metadata,
  }
  console.log(JSON.stringify(output, null, 2))
  process.exitCode = EXIT_NEEDS_INPUT
  throw new Errors.ExitError(EXIT_NEEDS_INPUT)
}

/**
 * Output execution result as JSON (non-exiting version)
 *
 * Use this after execution completes in non-TTY mode to provide structured
 * results. Unlike other output functions, this does NOT exit - caller should
 * handle cleanup and exit.
 *
 * @param executions - Array of execution results
 * @param successCount - Number of successful executions
 * @param failCount - Number of failed executions
 * @param metadata - Command metadata
 */
export function outputExecutionResultAsJson(
  executions: Array<{
    workId: string
    ticketId: string
    agent: string
    sessionId?: string
    containerId?: string
    status: string
    error?: string
  }>,
  successCount: number,
  failCount: number,
  metadata: OutputMetadata
): void {
  const output: ExecutionResultJsonOutput = {
    type: 'execution_result',
    result: {
      executions,
      successCount,
      failCount,
    },
    metadata,
  }
  console.log(JSON.stringify(output, null, 2))
}

// ────────────────────────────────────────────────────────────────────────────
// Validation-first JSON error layer (PRLT-1269)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Minimal shape of an oclif flag definition for schema introspection.
 *
 * We avoid importing oclif types directly so this helper can be unit-tested
 * without pulling in the full oclif runtime.
 */
export interface OclifFlagLike {
  type?: 'option' | 'boolean'
  name?: string
  char?: string
  description?: string
  summary?: string
  required?: boolean
  options?: readonly string[]
  default?: unknown
  multiple?: boolean
}

/**
 * Minimal shape of an oclif arg definition for schema introspection.
 */
export interface OclifArgLike {
  name?: string
  description?: string
  required?: boolean
  options?: readonly string[]
  default?: unknown
}

/**
 * Convert an oclif flag definition into a structured FlagSchemaEntry.
 *
 * Resolves the oclif `type` (option/boolean) into the inquirer-style prompt
 * type expected by agents (list/input/confirm/checkbox), preserves the
 * `options` array as `choices`, and serializes a static default value when
 * present (function defaults are dropped — agents can call `--help` for those).
 */
export function buildFlagSchemaEntry(flag: OclifFlagLike): FlagSchemaEntry {
  const entry: FlagSchemaEntry = {
    type: 'input',
  }

  if (flag.type === 'boolean') {
    entry.type = 'confirm'
  } else if (flag.options && flag.options.length > 0) {
    entry.type = flag.multiple ? 'checkbox' : 'list'
    entry.choices = [...flag.options]
  } else if (flag.multiple) {
    entry.type = 'checkbox'
  }

  if (flag.required) {
    entry.required = true
  }

  const description = flag.description ?? flag.summary
  if (description) {
    entry.description = description
  }

  if (flag.char) {
    entry.char = flag.char
  }

  // Only serialize primitive defaults — function defaults are evaluated at parse
  // time and would be misleading to expose statically.
  if (
    flag.default !== undefined &&
    (typeof flag.default === 'string' ||
      typeof flag.default === 'number' ||
      typeof flag.default === 'boolean' ||
      flag.default === null)
  ) {
    entry.default = flag.default
  }

  return entry
}

/**
 * Convert an oclif arg definition into a structured FlagSchemaEntry.
 *
 * Args are always treated as `list` (when they have options) or `input`,
 * and never have `boolean` semantics.
 */
export function buildArgSchemaEntry(arg: OclifArgLike): FlagSchemaEntry {
  const entry: FlagSchemaEntry = {
    type: arg.options && arg.options.length > 0 ? 'list' : 'input',
  }

  if (arg.options && arg.options.length > 0) {
    entry.choices = [...arg.options]
  }

  if (arg.required) {
    entry.required = true
  }

  if (arg.description) {
    entry.description = arg.description
  }

  if (
    arg.default !== undefined &&
    (typeof arg.default === 'string' ||
      typeof arg.default === 'number' ||
      typeof arg.default === 'boolean' ||
      arg.default === null)
  ) {
    entry.default = arg.default
  }

  return entry
}

/**
 * Build a complete schema map from a record of oclif flag definitions.
 *
 * This is the single source of truth that PRLT-1269 relies on: the oclif flag
 * spec is the schema. No duplication, no hand-maintained dictionaries.
 *
 * @param flags - Record of flag name → oclif flag definition
 * @param onlyNames - Optional whitelist; if provided, only these flags are included
 */
export function buildFlagSchemaFromOclif(
  flags: Record<string, OclifFlagLike> | undefined,
  onlyNames?: string[],
): Record<string, FlagSchemaEntry> {
  const schema: Record<string, FlagSchemaEntry> = {}
  if (!flags) return schema

  const include = onlyNames ? new Set(onlyNames) : null
  for (const [name, flag] of Object.entries(flags)) {
    if (include && !include.has(name)) continue
    if (!flag || typeof flag !== 'object') continue
    schema[name] = buildFlagSchemaEntry({ ...flag, name: flag.name ?? name })
  }
  return schema
}

/**
 * Detect whether the current invocation should emit machine-readable output
 * based purely on the raw argv (used by the validation-first error layer
 * because oclif parsing has already failed at this point and `flags` is
 * not available).
 *
 * Returns true if:
 * - argv contains `--json`, `--machine`, or `-m`
 * - PRLT_JSON env var is set
 * - stdin or stdout is non-TTY (PRLT_FORCE_TEXT can override)
 */
export function isMachineModeFromArgv(argv: string[] | undefined): boolean {
  if (Array.isArray(argv)) {
    for (const token of argv) {
      if (token === '--json' || token === '--machine' || token === '-m') {
        return true
      }
    }
  }
  return isNonTTY()
}

/**
 * Output a validation_error envelope as JSON and halt command execution.
 *
 * Used by the base-command catch handler when oclif parsing fails (missing
 * required flag/arg, invalid choice, nonexistent flag, etc.) and we want
 * agents to receive a structured response instead of human-readable text.
 *
 * Throws oclif ExitError so postrun hooks still fire.
 */
export function outputValidationErrorAsJson(
  payload: {
    command: string
    reason: string
    message: string
    missing: string[]
    schema: Record<string, FlagSchemaEntry>
  },
  metadata: OutputMetadata,
): never {
  const output: ValidationErrorJsonOutput = {
    type: 'validation_error',
    command: payload.command,
    reason: payload.reason,
    message: payload.message,
    missing: payload.missing,
    schema: payload.schema,
    metadata,
  }
  console.log(JSON.stringify(output, null, 2))
  process.exitCode = EXIT_ERROR
  throw new Errors.ExitError(EXIT_ERROR)
}
