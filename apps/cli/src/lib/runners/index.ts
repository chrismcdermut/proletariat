/**
 * Runner Registry
 *
 * Central registry for agent runners. Provides auto-detection of available
 * runtimes and a simple API for retrieving runner instances.
 *
 * Auto-detect order: claude-code → codex → pi
 */

import { execSync } from 'node:child_process'
import type { AgentRunner } from './agent-runner.js'
import { ClaudeCodeRunner } from './claude-code-runner.js'
import { EventEmittingRunner } from '../events/emitting-runner.js'

// Re-export interface and types for consumers
export type { AgentRunner, AgentSession, SpawnConfig } from './agent-runner.js'
export { ClaudeCodeRunner } from './claude-code-runner.js'
export { createClaudeCodeSession } from './claude-code-runner.js'

// =============================================================================
// Runner Registry
// =============================================================================

/**
 * Known runner definitions.
 * Maps runner name to the CLI binary that must be on PATH and a factory function.
 *
 * Detection order matters — first available runner is the default.
 */
const RUNNER_DEFINITIONS: Array<{
  name: string
  binary: string
  create: () => AgentRunner
}> = [
  {
    name: 'claude-code',
    binary: 'claude',
    create: () => new ClaudeCodeRunner(),
  },
  // Future runners — uncomment when implemented:
  // {
  //   name: 'codex',
  //   binary: 'codex',
  //   create: () => new CodexRunner(),
  // },
  // {
  //   name: 'pi',
  //   binary: 'pi',
  //   create: () => new PiRunner(),
  // },
]

/**
 * Check if a CLI binary is available on PATH.
 */
function isBinaryAvailable(binary: string): boolean {
  try {
    execSync(`command -v ${binary}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Get all runners whose CLI binary is available on PATH.
 *
 * Returns runners in detection order (claude-code, codex, pi).
 * Only runners with an installed CLI are included.
 */
export function getAvailableRunners(): AgentRunner[] {
  return RUNNER_DEFINITIONS
    .filter(def => isBinaryAvailable(def.binary))
    .map(def => def.create())
}

/**
 * Get a specific runner by name, or the default (first available) runner.
 *
 * @param name - Runner name to look up (e.g. 'claude-code', 'codex').
 *               If omitted, returns the first available runner.
 * @returns The runner instance, or null if not found / not available.
 */
export function getRunner(name?: string): AgentRunner | null {
  if (name) {
    const def = RUNNER_DEFINITIONS.find(d => d.name === name)
    if (!def) return null
    if (!isBinaryAvailable(def.binary)) return null
    return def.create()
  }

  // Auto-detect: return first available
  for (const def of RUNNER_DEFINITIONS) {
    if (isBinaryAvailable(def.binary)) {
      return def.create()
    }
  }

  return null
}

/**
 * Wrap a runner with event emission.
 *
 * Returns an EventEmittingRunner that delegates to the given runner
 * while emitting runtime events on the global EventBus.
 */
export function withEvents(runner: AgentRunner): AgentRunner {
  return new EventEmittingRunner(runner)
}
