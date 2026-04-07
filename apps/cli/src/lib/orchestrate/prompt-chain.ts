/**
 * walkPromptChain — drive prlt CLI commands non-interactively by walking JSON prompts.
 *
 * Background (PRLT-1268):
 * Action handlers used to hardcode flag combinations like
 *   `prlt work start <ticket> --yes --display background`
 * which broke as soon as a command emitted a JSON prompt that wasn't covered
 * by those flags (e.g. environment selection). `--yes` does not bypass JSON
 * prompts.
 *
 * The right approach is to walk the JSON prompt chain. Every prlt command in
 * JSON mode emits one of:
 *   - { type: 'prompt', prompt: { name, choices: [{ value, command, ... }, ...] } }
 *   - { type: 'success', ... }
 *   - { type: 'execution_result', ... }
 *   - { type: 'error', ... }
 *
 * For prompt responses, each choice already carries a fully constructed
 * follow-up `command` field. The walker:
 *   1. Runs the current command with --json
 *   2. If response is type=prompt, picks a default choice by name from the
 *      defaults map, then runs choice.command
 *   3. Repeats until success/error/iteration cap
 *
 * Per-action default choices live in the action handler and may be overridden
 * by hook config so users can customize behavior without code changes.
 */

import { spawnSync } from 'node:child_process'

/**
 * A choice from a JSON prompt response — only the fields walkPromptChain reads.
 */
interface PromptChoiceResponse {
  value: string
  command?: string
  name?: string
  disabled?: boolean
}

/**
 * The 'prompt' field of a JSON prompt response.
 */
interface PromptResponseBody {
  name?: string
  type?: string
  message?: string
  choices?: PromptChoiceResponse[]
  default?: unknown
}

/**
 * The full JSON envelope a prlt command can emit in machine mode.
 * Only the fields walkPromptChain reads are typed.
 */
interface CommandJsonOutput {
  type: 'prompt' | 'success' | 'execution_result' | 'error' | 'confirmation_needed' | 'dry-run'
  prompt?: PromptResponseBody | null
  result?: Record<string, unknown>
  error?: { code?: string; message?: string }
}

/**
 * Result of executing a single command in the chain.
 */
export interface ChainExecutorResult {
  /** stdout from the command (where prlt writes JSON) */
  stdout: string
  /** stderr from the command (for diagnostics on failure) */
  stderr: string
  /** Exit status — prompts emit with status=2, success with 0 */
  status: number
  /** Spawn error if the process couldn't be started */
  error?: string
}

/**
 * Function used to execute a command in the chain.
 * Default implementation shells out via spawnSync; tests can inject a mock.
 */
export type ChainExecutor = (command: string, timeoutMs: number) => ChainExecutorResult

/**
 * Default executor — runs the command via spawnSync with a shell.
 */
export const defaultChainExecutor: ChainExecutor = (command, timeoutMs) => {
  const result = spawnSync(command, {
    shell: true,
    encoding: 'utf8',
    timeout: timeoutMs,
    // Capture both pipes; prompts emit JSON to stdout even at exit code 2
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? -1,
    error: result.error ? result.error.message : undefined,
  }
}

/**
 * Options for walkPromptChain.
 */
export interface WalkPromptChainOptions {
  /** The initial prlt command (with or without --json) */
  baseCommand: string
  /**
   * Map of prompt name → choice value to pick when that prompt is encountered.
   * The prompt's `name` is the flagName the FlagResolver registered (e.g.,
   * 'environment', 'display', 'permission-mode').
   */
  defaults: Record<string, string>
  /** Per-command timeout. Defaults to 180s (matches AGENT_SPAWN_TIMEOUT_MS). */
  timeoutMs?: number
  /** Hard cap on iterations to avoid infinite loops on misconfigured chains. */
  maxIterations?: number
  /** Custom executor — primarily for tests. */
  executor?: ChainExecutor
}

/**
 * Result of walking the chain.
 */
export interface WalkPromptChainResult {
  /** Whether the chain reached a success terminal state. */
  success: boolean
  /** Number of commands executed. */
  iterations: number
  /** The final command that produced the terminal response. */
  finalCommand: string
  /** Sequence of commands run, oldest first. Useful for debugging/logging. */
  commandTrail: string[]
  /** Error message if walking failed. */
  error?: string
  /** Result body from a terminal success/execution_result envelope. */
  result?: Record<string, unknown>
}

/**
 * Ensure the command has --json appended (avoid duplicates).
 */
function ensureJsonFlag(command: string): string {
  // Match --json as a whole token (avoid matching --jsonish)
  if (/(^|\s)--json(\s|$)/.test(command)) {
    return command
  }
  return `${command} --json`
}

/**
 * Try to parse a JSON envelope out of stdout. Some commands print log lines
 * before the JSON; we look for the largest balanced JSON object.
 */
function parseJsonEnvelope(stdout: string): CommandJsonOutput | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null

  // Fast path: stdout is pure JSON
  try {
    return JSON.parse(trimmed) as CommandJsonOutput
  } catch {
    // fall through to slow path
  }

  // Slow path: find the last JSON object in stdout. JSON envelopes are
  // pretty-printed with newlines, so look for the last line starting with '}'
  // and walk backwards to a matching '{' at the start of a line.
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace <= firstBrace) return null

  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as CommandJsonOutput
  } catch {
    return null
  }
}

/**
 * Walk a JSON prompt chain to completion.
 *
 * Each iteration runs the current command, parses its JSON envelope, and:
 *   - On terminal success/execution_result, returns success.
 *   - On error, returns failure with the error code/message.
 *   - On prompt, picks the default for that prompt's name and runs the
 *     corresponding choice's `command`.
 *
 * If a prompt's name has no entry in `defaults`, the walk fails — this is a
 * configuration bug, not something to silently swallow.
 */
export function walkPromptChain(opts: WalkPromptChainOptions): WalkPromptChainResult {
  const {
    baseCommand,
    defaults,
    timeoutMs = 180_000,
    maxIterations = 12,
    executor = defaultChainExecutor,
  } = opts

  let currentCommand = ensureJsonFlag(baseCommand)
  const commandTrail: string[] = []

  for (let i = 1; i <= maxIterations; i++) {
    commandTrail.push(currentCommand)

    const exec = executor(currentCommand, timeoutMs)

    // Spawn-level failure (timeout, command not found, etc.)
    if (exec.error && !exec.stdout) {
      return {
        success: false,
        iterations: i,
        finalCommand: currentCommand,
        commandTrail,
        error: `Failed to run \`${currentCommand}\`: ${exec.error}`,
      }
    }

    const parsed = parseJsonEnvelope(exec.stdout)

    if (!parsed) {
      return {
        success: false,
        iterations: i,
        finalCommand: currentCommand,
        commandTrail,
        error:
          `\`${currentCommand}\` did not emit a JSON envelope ` +
          `(exit ${exec.status}).` +
          (exec.stderr ? ` stderr: ${exec.stderr.trim().slice(0, 500)}` : ''),
      }
    }

    if (parsed.type === 'success' || parsed.type === 'execution_result') {
      return {
        success: true,
        iterations: i,
        finalCommand: currentCommand,
        commandTrail,
        result: parsed.result,
      }
    }

    if (parsed.type === 'error') {
      const code = parsed.error?.code || 'ERROR'
      const message = parsed.error?.message || 'unknown error'
      return {
        success: false,
        iterations: i,
        finalCommand: currentCommand,
        commandTrail,
        error: `${code}: ${message}`,
      }
    }

    if (parsed.type === 'confirmation_needed') {
      // confirmation_needed is structurally different from a prompt — it
      // contains a single `confirm_command` to re-run. We don't try to be
      // clever; treat it as an explicit step the operator must wire up.
      return {
        success: false,
        iterations: i,
        finalCommand: currentCommand,
        commandTrail,
        error: `\`${currentCommand}\` returned confirmation_needed; action handler must opt into confirmation flow`,
      }
    }

    if (parsed.type !== 'prompt') {
      return {
        success: false,
        iterations: i,
        finalCommand: currentCommand,
        commandTrail,
        error: `Unsupported envelope type "${parsed.type}" from \`${currentCommand}\``,
      }
    }

    // type === 'prompt' — pick a default and chain
    const promptBody = parsed.prompt
    if (!promptBody) {
      return {
        success: false,
        iterations: i,
        finalCommand: currentCommand,
        commandTrail,
        error: `\`${currentCommand}\` returned prompt envelope with empty body`,
      }
    }

    const promptName = promptBody.name
    if (!promptName) {
      return {
        success: false,
        iterations: i,
        finalCommand: currentCommand,
        commandTrail,
        error: `\`${currentCommand}\` returned prompt with no name; cannot map to defaults`,
      }
    }

    const defaultValue = defaults[promptName]
    if (defaultValue === undefined) {
      const available = Object.keys(defaults).join(', ') || '(none)'
      return {
        success: false,
        iterations: i,
        finalCommand: currentCommand,
        commandTrail,
        error:
          `No default configured for prompt "${promptName}" ` +
          `(have defaults for: ${available}). ` +
          `Add it via the hook's args.defaults config.`,
      }
    }

    const choices = promptBody.choices || []
    const chosen = choices.find((c) => c.value === defaultValue)
    if (!chosen) {
      const offered = choices.map((c) => c.value).join(', ') || '(none)'
      return {
        success: false,
        iterations: i,
        finalCommand: currentCommand,
        commandTrail,
        error:
          `Prompt "${promptName}" has no choice with value "${defaultValue}". ` +
          `Available: ${offered}`,
      }
    }

    if (!chosen.command) {
      return {
        success: false,
        iterations: i,
        finalCommand: currentCommand,
        commandTrail,
        error:
          `Choice "${defaultValue}" for prompt "${promptName}" has no \`command\` field; ` +
          `cannot continue chain. The command emitting this prompt must populate choice.command.`,
      }
    }

    currentCommand = ensureJsonFlag(chosen.command)
  }

  return {
    success: false,
    iterations: maxIterations,
    finalCommand: currentCommand,
    commandTrail,
    error: `Exceeded max iterations (${maxIterations}) walking prompt chain`,
  }
}

/**
 * Built-in default choice maps per action. Hook config can shallow-merge
 * over these to override individual prompt defaults.
 *
 * Keys are prompt names (FlagResolver flagName). Values are the choice value
 * to pick. See `apps/cli/src/commands/work/start.ts` for the prompts a
 * `prlt work start` chain may emit.
 */
export const DEFAULT_PROMPT_CHOICES = {
  'spawn-agent': {
    environment: 'devcontainer',
    display: 'background',
    selectedDisplay: 'background',
    'permission-mode': 'danger',
    tokenAction: 'continue',
    dockerAction: 'host',
    prChoice: 'create',
    saveDefault: 'true',
    authAction: 'oauth',
  },
  'spawn-review-agent': {
    // Review agents are read-only and faster on host
    environment: 'host',
    display: 'background',
    selectedDisplay: 'background',
    'permission-mode': 'safe',
    prChoice: 'no-pr',
    saveDefault: 'true',
  },
  'spawn-fix-agent': {
    environment: 'devcontainer',
    display: 'background',
    selectedDisplay: 'background',
    'permission-mode': 'danger',
    tokenAction: 'continue',
    dockerAction: 'host',
    prChoice: 'create',
    saveDefault: 'true',
    authAction: 'oauth',
  },
  'resolve-conflict': {
    environment: 'devcontainer',
    display: 'background',
    selectedDisplay: 'background',
    'permission-mode': 'danger',
    tokenAction: 'continue',
    dockerAction: 'host',
    prChoice: 'create',
    saveDefault: 'true',
    authAction: 'oauth',
  },
  'merge-pr': {
    method: 'squash',
    'delete-branch': 'true',
  },
  'move-ticket': {
    target: 'done',
  },
} as const

/**
 * Resolve effective defaults for an action by overlaying hook config on top
 * of the built-in defaults. Hook config shape:
 *
 *   { defaults: { promptName: 'value', ... } }
 *
 * Unknown keys in hook config are passed through verbatim — there is no
 * allow-list because new prlt prompts get added all the time.
 */
export function resolveActionDefaults(
  action: keyof typeof DEFAULT_PROMPT_CHOICES,
  config?: Record<string, unknown>,
): Record<string, string> {
  const builtIn = DEFAULT_PROMPT_CHOICES[action] as Record<string, string>
  const overrides = (config?.defaults as Record<string, string> | undefined) || {}
  return { ...builtIn, ...overrides }
}
