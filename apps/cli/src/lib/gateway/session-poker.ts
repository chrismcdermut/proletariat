/**
 * Default SessionPoker implementation (PRLT-1255)
 *
 * Shells out to `prlt session poke <agent> <message> --wait --timeout N --json`
 * and extracts the captured response from the JSON output.
 *
 * The router code itself is agnostic to this — tests inject a fake
 * SessionPoker. This file exists so production code can pick up the real
 * poker with zero wiring.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SessionPoker } from './router.js'

const execFileAsync = promisify(execFile)

export interface ShellSessionPokerOptions {
  /**
   * Name of the binary to exec. Defaults to `prlt` on PATH. Tests can
   * point this at a shim script.
   */
  binary?: string
  /**
   * Working directory for the exec call. Defaults to the current process
   * cwd — `prlt session poke` resolves workspace context from there.
   */
  cwd?: string
}

/**
 * Shell-based SessionPoker. Uses `execFile` (no shell) so nothing in the
 * message body can trigger shell expansion or injection.
 */
export class ShellSessionPoker implements SessionPoker {
  private readonly binary: string
  private readonly cwd: string | undefined

  constructor(options: ShellSessionPokerOptions = {}) {
    this.binary = options.binary ?? 'prlt'
    this.cwd = options.cwd
  }

  async poke(agent: string, message: string, options?: { waitTimeoutSec?: number }): Promise<string | null> {
    const timeoutSec = options?.waitTimeoutSec ?? 90
    const args = [
      'session',
      'poke',
      agent,
      message,
      '--wait',
      '--timeout',
      String(timeoutSec),
      '--json',
    ]

    const { stdout } = await execFileAsync(this.binary, args, {
      cwd: this.cwd,
      // Give the child a little longer than the internal wait so we
      // don't race the --timeout.
      timeout: (timeoutSec + 15) * 1000,
      maxBuffer: 8 * 1024 * 1024,
    })

    // `prlt session poke --json` emits a single JSON object on success.
    const parsed = parseFirstJsonObject(stdout)
    if (!parsed) return null
    if (typeof parsed.response === 'string') return parsed.response
    return null
  }
}

/**
 * Pull the first JSON object out of a mixed stdout stream. Needed because
 * some oclif commands still emit human banners alongside `--json` output
 * depending on terminal state.
 */
function parseFirstJsonObject(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null

  // Fast path: whole payload is JSON.
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    // Fall through to scan.
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1))
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    return null
  }
  return null
}
