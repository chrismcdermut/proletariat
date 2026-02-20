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
    }>
    successCount: number
    failCount: number
  }
  /** Command metadata */
  metadata: OutputMetadata
}

/**
 * Union type for all JSON output types
 */
export type JsonOutput = PromptJsonOutput | SuccessJsonOutput | ErrorJsonOutput | DryRunJsonOutput | ConfirmationNeededJsonOutput | ExecutionResultJsonOutput

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
 * @returns true if either stdin or stdout is not a TTY, or PRLT_JSON=1 is set
 */
export function isNonTTY(): boolean {
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
 * Output a prompt configuration as JSON and exit
 *
 * Use this when a command would normally show an interactive prompt.
 * Outputs the prompt config so agents can understand what input is needed,
 * then exits with EXIT_NEEDS_INPUT (2) to signal the command needs more input.
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
  process.exit(EXIT_NEEDS_INPUT)
}

/**
 * Output success result as JSON and exit
 *
 * Use this when all required data was provided via flags
 * and no prompt is needed. Exits with EXIT_SUCCESS (0) to signal
 * successful command completion.
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
  process.exit(EXIT_SUCCESS)
}

/**
 * Output error as JSON and exit
 *
 * Use this when an error occurs and --json flag is active.
 * Provides structured error output for programmatic handling,
 * then exits with EXIT_ERROR (1).
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
  process.exit(EXIT_ERROR)
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
 * Output a successful dry-run result as JSON and exit
 *
 * Use this when --dry-run is set and all validation passes.
 * Shows what would be created without actually creating it.
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
  process.exit(EXIT_SUCCESS)
}

/**
 * Output a dry-run validation failure as JSON and exit
 *
 * Use this when --dry-run is set and validation fails.
 * Shows the validation errors without attempting to create.
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
  process.exit(EXIT_ERROR)
}

/**
 * Output a confirmation needed response as JSON and exit
 *
 * Use this in non-TTY mode when all required flags are provided but --yes is not set.
 * This allows agents to preview what will happen before confirming execution.
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
  process.exit(EXIT_NEEDS_INPUT)
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
