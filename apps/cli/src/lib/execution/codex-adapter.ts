/**
 * Codex Runtime Adapter
 *
 * Explicitly maps permission modes and execution contexts to Codex CLI invocations.
 * Validates that the requested combination is supported and returns a deterministic
 * command configuration.
 *
 * ## Codex Mode Mapping
 *
 * Codex has three approval/sandbox presets:
 *   - `--dangerously-bypass-approvals-and-sandbox` (danger): Skip all approvals and sandboxing
 *   - `--full-auto`  (autonomous): Auto-approve with workspace-write sandbox (-a on-request, --sandbox workspace-write)
 *   - (default)      (safe): Prompt the user for approval before running commands
 *
 * Codex execution modes:
 *   - `codex [PROMPT]`:      Interactive TUI — requires a TTY
 *   - `codex exec [PROMPT]`: Non-interactive — runs headless, suitable for background/CI
 *
 * Codex execution contexts:
 *   - Interactive terminal: User is watching in a TTY (terminal tab, foreground tmux)
 *   - Background/detached:  Running in a tmux session, no direct TTY attached at start
 *   - Non-TTY:              Piped output, CI, Docker detached — no TTY available
 *
 * ## Supported Combinations
 *
 * | Permission | Context       | Supported | Notes                                                          |
 * |------------|---------------|-----------|----------------------------------------------------------------|
 * | danger     | interactive   | Yes       | `codex --dangerously-bypass-approvals-and-sandbox "..."`       |
 * | danger     | background    | Yes       | `codex exec --dangerously-bypass-approvals-and-sandbox "..."`  |
 * | danger     | non-tty       | Yes       | `codex exec --dangerously-bypass-approvals-and-sandbox "..."`  |
 * | safe       | interactive   | Yes       | `codex --full-auto "..."` (sandboxed, auto-approve)            |
 * | safe       | background    | Yes       | `codex exec --full-auto "..."` (sandboxed, auto-approve)       |
 * | safe       | non-tty       | Yes       | `codex exec --full-auto "..."` (sandboxed, auto-approve)       |
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
  /** Whether danger mode (bypass approvals and sandbox) is active */
  dangerMode: boolean
  /** Whether using `codex exec` (non-interactive) subcommand */
  execMode: boolean
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
 *
 * All combinations are now supported:
 * - danger mode: works everywhere (--dangerously-bypass-approvals-and-sandbox)
 * - safe mode: uses --full-auto for autonomous sandboxed execution in all contexts
 * - Non-interactive contexts use `codex exec` subcommand
 */
export function validateCodexMode(
  _permissionMode: PermissionMode,
  _executionContext: CodexExecutionContext
): CodexModeError | null {
  // All combinations are supported:
  // - danger mode: --dangerously-bypass-approvals-and-sandbox works in all contexts
  // - safe mode: --full-auto works in all contexts (sandboxed auto-approve)
  // - Non-interactive contexts (background, non-tty) use `codex exec` subcommand
  return null
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
 * For interactive contexts: uses `codex [flags] [prompt]`
 * For background/non-tty: uses `codex exec [flags] [prompt]`
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

  const dangerMode = permissionMode === 'danger'
  // Use `codex exec` for non-interactive contexts (background, non-tty)
  const execMode = executionContext !== 'interactive'
  const args: string[] = []

  // Add `exec` subcommand for non-interactive contexts
  if (execMode) {
    args.push('exec')
  }

  // Add permission/sandbox flags
  if (dangerMode) {
    args.push('--dangerously-bypass-approvals-and-sandbox')
  } else {
    // Safe mode: use --full-auto for autonomous sandboxed execution
    // This sets -a on-request --sandbox workspace-write
    args.push('--full-auto')
  }

  // Codex CLI expects the initial prompt as a positional argument.
  args.push(prompt)

  return {
    cmd: 'codex',
    args,
    dangerMode,
    execMode,
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
