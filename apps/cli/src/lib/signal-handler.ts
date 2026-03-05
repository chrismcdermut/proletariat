/**
 * Centralized signal handler for graceful CLI shutdown
 *
 * Manages SIGINT (Ctrl+C) and SIGTERM handling across the CLI:
 * - Runs registered cleanup callbacks in LIFO order
 * - Kills tracked child processes
 * - Exits with code 130 (standard Unix SIGINT convention)
 * - Prevents ERR_USE_AFTER_CLOSE from dangling inquirer prompts
 *
 * Usage:
 * ```typescript
 * import { onShutdown, trackChildProcess } from '../lib/signal-handler.js'
 *
 * // Register cleanup (returns unregister function)
 * const unregister = onShutdown(async () => {
 *   db.close()
 * })
 *
 * // Track a child process for automatic cleanup
 * trackChildProcess(childProc)
 * ```
 */

import type { ChildProcess } from 'node:child_process'

/** Cleanup callback - should be fast and not throw */
type CleanupFn = () => void | Promise<void>

const cleanupCallbacks: CleanupFn[] = []
const trackedProcesses = new Set<ChildProcess>()
let isShuttingDown = false
let installed = false

/**
 * Run all cleanup callbacks and exit.
 * Called on SIGINT or SIGTERM.
 */
async function shutdown(): Promise<void> {
  if (isShuttingDown) return
  isShuttingDown = true

  // Kill tracked child processes first
  for (const child of trackedProcesses) {
    try {
      if (child.pid && !child.killed) {
        child.kill('SIGTERM')
      }
    } catch {
      // Process may have already exited
    }
  }
  trackedProcesses.clear()

  // Run cleanup callbacks in LIFO order (most recent first)
  const callbacks = [...cleanupCallbacks].reverse()
  for (const cb of callbacks) {
    try {
      await cb()
    } catch {
      // Swallow errors during cleanup
    }
  }
  cleanupCallbacks.length = 0

  // Exit with 130 = 128 + 2 (SIGINT)
  process.exit(130)
}

/**
 * Install global signal handlers. Called once at CLI startup.
 * Safe to call multiple times (idempotent).
 */
export function installSignalHandlers(): void {
  if (installed) return
  installed = true

  process.on('SIGINT', () => {
    // Write a newline to avoid dangling prompt characters
    if (process.stdout.isTTY) {
      process.stdout.write('\n')
    }
    void shutdown()
  })

  process.on('SIGTERM', () => {
    void shutdown()
  })
}

/**
 * Register a cleanup callback to run on shutdown.
 * Callbacks run in LIFO order (most recently registered runs first).
 *
 * @returns Unregister function to remove the callback
 */
export function onShutdown(fn: CleanupFn): () => void {
  cleanupCallbacks.push(fn)
  return () => {
    const idx = cleanupCallbacks.indexOf(fn)
    if (idx !== -1) {
      cleanupCallbacks.splice(idx, 1)
    }
  }
}

/**
 * Track a child process for automatic cleanup on shutdown.
 * The process will receive SIGTERM when the CLI exits.
 *
 * Automatically removes itself from tracking when it exits.
 */
export function trackChildProcess(child: ChildProcess): void {
  trackedProcesses.add(child)
  child.on('exit', () => {
    trackedProcesses.delete(child)
  })
  child.on('error', () => {
    trackedProcesses.delete(child)
  })
}

/**
 * Check if the process is currently shutting down.
 * Useful for avoiding work after SIGINT.
 */
export function isExiting(): boolean {
  return isShuttingDown
}

/**
 * Wrap an inquirer prompt call to handle SIGINT gracefully.
 * On SIGINT during a prompt, triggers the shutdown sequence
 * instead of letting inquirer throw ERR_USE_AFTER_CLOSE.
 *
 * @param promptFn - Function that calls inquirer.prompt()
 * @returns The prompt result
 */
export async function withSignalSafePrompt<T>(promptFn: () => Promise<T>): Promise<T> {
  if (isShuttingDown) {
    // If already shutting down, just exit
    process.exit(130)
  }

  try {
    return await promptFn()
  } catch (error: unknown) {
    // Check if this is a prompt close error from SIGINT
    if (isShuttingDown) {
      // We're already in shutdown, just wait for it
      await new Promise(() => {
        // Never resolves - shutdown() will call process.exit
      })
      // Unreachable, but satisfies TypeScript
      throw error
    }

    // Check for readline/inquirer close errors that indicate SIGINT
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('ERR_USE_AFTER_CLOSE') ||
      message.includes('readline was closed')
    ) {
      // Inquirer's readline was closed by SIGINT - trigger clean shutdown
      void shutdown()
      await new Promise(() => {})
      throw error // Unreachable
    }

    // Re-throw other errors normally
    throw error
  }
}
