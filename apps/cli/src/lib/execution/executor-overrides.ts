/**
 * Executor Overrides (PRLT-1369)
 *
 * Helpers for parsing --executor-env KEY=VALUE pairs and producing
 * the shell/docker fragments that inject those env vars + bin overrides
 * into spawned executor processes.
 *
 * Use case: switching Claude accounts (CLAUDE_CONFIG_DIR), pointing at a
 * wrapper binary, or any other env-driven executor configuration.
 */

import { Flags } from '@oclif/core'

/**
 * Parsed executor overrides applied to a spawned executor process.
 */
export interface ExecutorOverrides {
  /** Environment variables to set on the executor (e.g. CLAUDE_CONFIG_DIR=...) */
  env?: Record<string, string>
  /** Override the executor binary (absolute path or wrapper script name) */
  bin?: string
}

/**
 * Parse one or more KEY=VALUE strings into a record.
 * Accepts strings like:
 *   - "CLAUDE_CONFIG_DIR=/Users/me/.claude-work"
 *   - "FOO=bar=baz"  (only the first '=' splits the pair)
 *
 * Throws on:
 *   - missing '=' separator
 *   - empty / non-identifier KEY (must match /^[A-Za-z_][A-Za-z0-9_]*$/)
 */
export function parseExecutorEnv(pairs: string[] | undefined): Record<string, string> | undefined {
  if (!pairs || pairs.length === 0) return undefined

  const env: Record<string, string> = {}
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq < 0) {
      throw new Error(`Invalid --executor-env value "${pair}". Expected KEY=VALUE.`)
    }
    const key = pair.slice(0, eq)
    const value = pair.slice(eq + 1)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid --executor-env key "${key}". Must match [A-Za-z_][A-Za-z0-9_]*.`)
    }
    env[key] = value
  }
  return env
}

/**
 * Quote a value for safe inclusion inside a single-quoted shell fragment.
 * Replaces `'` with `'\''` so the result can be embedded in `'...'`.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Build shell `export KEY='VALUE'` lines for a bash script.
 * Returns a string of newline-separated `export` statements (or empty string).
 */
export function buildShellExports(env: Record<string, string> | undefined): string {
  if (!env) return ''
  const lines: string[] = []
  for (const [key, value] of Object.entries(env)) {
    lines.push(`export ${key}=${shellQuote(value)}`)
  }
  return lines.join('\n')
}

/**
 * Build `docker exec -e KEY=VALUE` flag fragments for injecting env vars
 * into a docker exec invocation. Returns a string with a leading space
 * when non-empty.
 *
 * Each value is single-quoted and escaped to be safe inside a containing
 * single-quoted shell command.
 */
export function buildDockerEnvFlags(env: Record<string, string> | undefined): string {
  if (!env) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(env)) {
    parts.push(`-e ${key}=${shellQuote(value)}`)
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

/**
 * Reusable oclif Flag definitions so every command exposes the same
 * `--executor-env` / `--executor-bin` surface.
 */
export const executorOverrideFlags = {
  'executor-env': Flags.string({
    description:
      'Set env var on spawned executor (KEY=VALUE). Repeatable. ' +
      'Useful for switching Claude accounts: --executor-env CLAUDE_CONFIG_DIR=$HOME/.claude-work',
    multiple: true,
  }),
  'executor-bin': Flags.string({
    description:
      'Override executor binary path (e.g. an absolute path or wrapper script). ' +
      'Defaults to the executor\'s native command (claude, codex).',
  }),
}

/**
 * Read the executor-override flags off a parsed flag bag and return a
 * normalized {env, bin} object (or undefined if no overrides were set).
 */
export function readExecutorOverridesFromFlags(
  flags: { 'executor-env'?: string[]; 'executor-bin'?: string },
): ExecutorOverrides | undefined {
  const env = parseExecutorEnv(flags['executor-env'])
  const bin = flags['executor-bin']
  if (!env && !bin) return undefined
  return { env, bin }
}
