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
}

/**
 * Form field configuration for multi-field prompts
 */
export interface FormField {
  /** Type of field: input, list, checkbox, confirm, editor */
  type: 'input' | 'list' | 'checkbox' | 'confirm' | 'editor'
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
  /** Type of prompt: list (single select), checkbox (multi select), confirm, input, editor, or form (multi-field) */
  type: 'list' | 'checkbox' | 'confirm' | 'input' | 'editor' | 'form'
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
}

/**
 * JSON output when a prompt would be shown
 */
export interface PromptJsonOutput {
  /** Prompt configuration, or null if no prompt needed */
  prompt: PromptConfig | null
  /** Command metadata */
  metadata: OutputMetadata
}

/**
 * JSON output for successful command execution (no prompt needed)
 */
export interface SuccessJsonOutput {
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
 * Union type for all JSON output types
 */
export type JsonOutput = PromptJsonOutput | SuccessJsonOutput | ErrorJsonOutput

/**
 * Flags interface for shouldOutputJson
 */
export interface JsonFlags {
  json?: boolean
  'no-interactive'?: boolean
  noInteractive?: boolean
}

/**
 * Check if the current environment is non-TTY (piped output)
 *
 * @returns true if stdout is not a TTY (e.g., piped to another process)
 */
export function isNonTTY(): boolean {
  return !process.stdout.isTTY
}

/**
 * Determine if JSON output should be used
 *
 * Returns true if:
 * - The --json flag is explicitly set
 * - The --no-interactive flag is explicitly set
 * - The environment is non-TTY (piped output)
 *
 * @param flags - Command flags object
 * @returns true if JSON output should be used
 */
export function shouldOutputJson(flags: JsonFlags): boolean {
  // Explicit flag takes precedence
  if (flags.json === true) {
    return true
  }

  // --no-interactive alias for --json
  if (flags['no-interactive'] === true || flags.noInteractive === true) {
    return true
  }

  // Automatic detection for non-TTY environments
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
    prompt: config,
    metadata,
  }
  console.log(JSON.stringify(output, null, 2))
  process.exit(EXIT_NEEDS_INPUT)
}

/**
 * Output success result as JSON
 *
 * Use this when all required data was provided via flags
 * and no prompt is needed.
 *
 * @param result - Command-specific result data
 * @param metadata - Command metadata
 */
export function outputSuccessAsJson(
  result: Record<string, unknown>,
  metadata: OutputMetadata
): void {
  const output: SuccessJsonOutput = {
    prompt: null,
    success: true,
    result,
    metadata,
  }
  console.log(JSON.stringify(output, null, 2))
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
  choices: Array<string | { name: string; value: string; disabled?: boolean | string } | unknown>
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
      const obj = choice as { name: string; value: string; disabled?: boolean | string }
      normalized.push({
        name: obj.name,
        value: String(obj.value),
        ...(obj.disabled !== undefined && { disabled: Boolean(obj.disabled) }),
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
  type: 'list' | 'checkbox' | 'confirm' | 'input' | 'editor',
  name: string,
  message: string,
  choices?: Array<string | { name: string; value: string; disabled?: boolean | string } | unknown>,
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
