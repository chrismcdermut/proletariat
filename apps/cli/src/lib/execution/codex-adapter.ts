/**
 * Codex Runtime Adapter
 *
 * Explicitly maps permission modes and execution contexts to Codex CLI invocations.
 * Validates that the requested combination is supported and returns a deterministic
 * command configuration.
 *
 * ## Codex Mode Mapping
 *
 * Codex has two permission modes:
 *   - `--yolo`    (danger): Execute commands autonomously without approval prompts
 *   - (default)   (safe):   Prompt the user for approval before running commands
 *
 * Codex execution contexts:
 *   - Interactive terminal: User is watching in a TTY (terminal tab, foreground tmux)
 *   - Background/detached:  Running in a tmux session, no direct TTY attached at start
 *   - Non-TTY:              Piped output, CI, Docker detached — no TTY available
 *
 * ## Supported Combinations
 *
 * | Permission | Context       | Supported | Notes                                    |
 * |------------|---------------|-----------|------------------------------------------|
 * | danger     | interactive   | Yes       | `codex --yolo "..."`                     |
 * | danger     | background    | Yes       | `codex --yolo "..."`                     |
 * | danger     | non-tty       | Yes       | `codex --yolo "..."`                     |
 * | safe       | interactive   | Yes       | `codex "..."` (user can approve)         |
 * | safe       | background    | No        | Cannot prompt for approval in background |
 * | safe       | non-tty       | No        | Cannot prompt for approval without TTY   |
 */

import type { DisplayMode, OutputMode, PermissionMode } from './types.js'

// =============================================================================
// Codex Execution Context
// =============================================================================

/**
 * The execution context determines whether Codex can interact with a user.
 *
 * - interactive: Running in a TTY where the user can see prompts and respond
 * - background:  Running detached (tmux background, no terminal tab open)
 * - non-tty:     No TTY at all (piped, Docker -d, CI runner)
 */
export type CodexExecutionContext = 'interactive' | 'background' | 'non-tty'

// =============================================================================
// Codex Adapter Errors
// =============================================================================

/**
 * Error thrown when an unsupported Codex mode combination is requested.
 */
export class CodexModeError extends Error {
  public readonly permissionMode: PermissionMode
  public readonly executionContext: CodexExecutionContext

  constructor(permissionMode: PermissionMode, executionContext: CodexExecutionContext) {
    const message = buildModeErrorMessage(permissionMode, executionContext)
    super(message)
    this.name = 'CodexModeError'
    this.permissionMode = permissionMode
    this.executionContext = executionContext
  }
}

function buildModeErrorMessage(permissionMode: PermissionMode, executionContext: CodexExecutionContext): string {
  if (permissionMode === 'safe' && executionContext === 'background') {
    return (
      `Codex safe mode cannot run in background: Codex needs a TTY to prompt for approval. ` +
      `Either use danger mode (--yolo) for background execution, or run in a terminal where you can interact with Codex.`
    )
  }
  if (permissionMode === 'safe' && executionContext === 'non-tty') {
    return (
      `Codex safe mode requires an interactive terminal: Codex needs a TTY to prompt for approval. ` +
      `Either use danger mode (--yolo) for non-interactive execution, or run in a terminal where you can interact with Codex.`
    )
  }
  return `Unsupported Codex mode combination: permission=${permissionMode}, context=${executionContext}`
}

// =============================================================================
// Codex Command Result
// =============================================================================

/**
 * The resolved command and arguments for invoking Codex.
 */
export interface CodexCommandResult {
  cmd: 'codex'
  args: string[]
  /** Whether --yolo (autonomous mode) is active */
  yolo: boolean
  /** The resolved execution context */
  executionContext: CodexExecutionContext
}

// =============================================================================
// Context Resolution
// =============================================================================

/**
 * Derive the Codex execution context from proletariat display mode and output mode.
 *
 * Maps proletariat's display/output dimensions to Codex's execution context:
 * - terminal + interactive → interactive (user is watching, TTY available)
 * - foreground + interactive → interactive
 * - terminal + print → non-tty (output is piped, no interaction)
 * - background + any → background (detached tmux, no direct TTY)
 * - foreground + print → non-tty
 */
export function resolveCodexExecutionContext(
  displayMode: DisplayMode,
  outputMode: OutputMode
): CodexExecutionContext {
  // Background display is always background context regardless of output mode
  if (displayMode === 'background') {
    return 'background'
  }

  // Print mode means output is captured/piped, no interactive TTY
  if (outputMode === 'print') {
    return 'non-tty'
  }

  // Terminal or foreground with interactive output = interactive
  return 'interactive'
}

// =============================================================================
// Mode Validation
// =============================================================================

/**
 * Check whether a Codex mode combination is supported.
 * Returns null if valid, or a CodexModeError if the combination is unsupported.
 */
export function validateCodexMode(
  permissionMode: PermissionMode,
  executionContext: CodexExecutionContext
): CodexModeError | null {
  // Danger mode works in all contexts — no user interaction needed
  if (permissionMode === 'danger') {
    return null
  }

  // Safe mode requires an interactive terminal for approval prompts
  if (executionContext === 'interactive') {
    return null
  }

  return new CodexModeError(permissionMode, executionContext)
}

// =============================================================================
// Command Builder
// =============================================================================

/**
 * Build the Codex CLI command for a given permission mode and execution context.
 *
 * This is the single source of truth for Codex invocation. All runners should
 * use this function (via getCodexCommand or getCodexCommandFromConfig) rather
 * than building Codex CLI args inline.
 *
 * @throws CodexModeError if the combination is unsupported
 */
export function getCodexCommand(
  prompt: string,
  permissionMode: PermissionMode,
  executionContext: CodexExecutionContext
): CodexCommandResult {
  // Validate the combination
  const error = validateCodexMode(permissionMode, executionContext)
  if (error) {
    throw error
  }

  const yolo = permissionMode === 'danger'
  const args: string[] = []

  if (yolo) {
    args.push('--yolo')
  }

  // Codex expects the launch prompt as a positional argument, not --prompt.
  args.push(prompt)

  return {
    cmd: 'codex',
    args,
    yolo,
    executionContext,
  }
}

/**
 * Build the Codex CLI command from proletariat config values.
 *
 * Convenience wrapper that resolves execution context from display/output mode
 * before delegating to getCodexCommand().
 *
 * @param prompt - The prompt text for Codex
 * @param sandboxed - If true, use safe mode; if false, use danger mode
 * @param displayMode - How the agent output is displayed
 * @param outputMode - Whether output is interactive or print
 * @throws CodexModeError if the resolved combination is unsupported
 */
export function getCodexCommandFromConfig(
  prompt: string,
  sandboxed: boolean,
  displayMode: DisplayMode = 'terminal',
  outputMode: OutputMode = 'interactive'
): CodexCommandResult {
  const permissionMode: PermissionMode = sandboxed ? 'safe' : 'danger'
  const executionContext = resolveCodexExecutionContext(displayMode, outputMode)
  return getCodexCommand(prompt, permissionMode, executionContext)
}
