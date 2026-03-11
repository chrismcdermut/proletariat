/**
 * Codex Runtime Adapter
 *
 * Explicitly maps permission modes and execution contexts to Codex CLI invocations.
 * Validates that the requested combination is supported and returns a deterministic
 * command configuration.
 *
 * ## Codex Mode Mapping (codex v0.104.0+)
 *
 * Codex has two permission modes:
 *   - `--dangerously-bypass-approvals-and-sandbox` (danger): No approval prompts, no sandbox
 *   - `--full-auto`                                (safe):   Sandboxed auto execution (-a on-request, --sandbox workspace-write)
 *
 * Codex execution contexts:
 *   - Interactive terminal: User is watching in a TTY — uses `codex` (interactive TUI)
 *   - Background/detached:  Running in a tmux session — uses `codex` (TUI works in tmux pseudo-TTY)
 *   - Non-TTY:              Piped output, CI, Docker detached — uses `codex exec` (non-interactive)
 *
 * ## Supported Combinations
 *
 * | Permission | Context       | Supported | Notes                                                              |
 * |------------|---------------|-----------|--------------------------------------------------------------------|
 * | danger     | interactive   | Yes       | `codex --dangerously-bypass-approvals-and-sandbox "..."`           |
 * | danger     | background    | Yes       | `codex --dangerously-bypass-approvals-and-sandbox "..."`           |
 * | danger     | non-tty       | Yes       | `codex exec --dangerously-bypass-approvals-and-sandbox "..."`      |
 * | safe       | interactive   | Yes       | `codex --full-auto "..."` (sandboxed, user can watch)              |
 * | safe       | background    | No        | Cannot prompt for approval in background                           |
 * | safe       | non-tty       | No        | Cannot prompt for approval without TTY                             |
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
      `Either use danger mode (--dangerously-bypass-approvals-and-sandbox) for background execution, or run in a terminal where you can interact with Codex.`
    )
  }
  if (permissionMode === 'safe' && executionContext === 'non-tty') {
    return (
      `Codex safe mode requires an interactive terminal: Codex needs a TTY to prompt for approval. ` +
      `Either use danger mode (--dangerously-bypass-approvals-and-sandbox) for non-interactive execution, or run in a terminal where you can interact with Codex.`
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
  /** Whether autonomous mode (no approvals, no sandbox) is active */
  autonomous: boolean
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
 * Uses codex v0.104.0+ flags:
 * - danger mode: --dangerously-bypass-approvals-and-sandbox
 * - safe mode:   --full-auto (sandboxed, -a on-request --sandbox workspace-write)
 * - non-tty:     `codex exec` subcommand (non-interactive mode)
 * - interactive/background: `codex` (interactive TUI, works in tmux pseudo-TTY)
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

  const autonomous = permissionMode === 'danger'
  const args: string[] = []

  // Non-TTY contexts use `codex exec` (non-interactive subcommand)
  if (executionContext === 'non-tty') {
    args.push('exec')
  }

  // Permission mode flags
  if (autonomous) {
    args.push('--dangerously-bypass-approvals-and-sandbox')
  } else {
    // Safe mode: sandboxed auto execution (workspace-write + model decides when to ask)
    args.push('--full-auto')
  }

  // Codex CLI expects the initial prompt as a positional argument.
  args.push(prompt)

  return {
    cmd: 'codex',
    args,
    autonomous,
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
