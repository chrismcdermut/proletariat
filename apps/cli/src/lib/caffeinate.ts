/**
 * Caffeinate management for macOS
 *
 * Manages a background `caffeinate` process to prevent macOS from sleeping.
 * PID state is stored in a runtime file for reliable stop/status operations.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'

const RUNTIME_DIR = path.join(os.tmpdir(), 'prlt')
const PID_FILE = path.join(RUNTIME_DIR, 'caffeinate.pid')

export interface CaffeinateState {
  pid: number
  startedAt: string
  flags: string[]
  duration?: number
}

/**
 * Ensure the platform is macOS. Throws a descriptive error on other platforms.
 */
export function assertMacOS(): void {
  if (process.platform !== 'darwin') {
    throw new Error(`caffeinate is only supported on macOS (current platform: ${process.platform})`)
  }
}

/**
 * Check whether the platform is macOS.
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin'
}

/**
 * Read the stored caffeinate state from the PID file.
 * Returns null if no state exists or the file is invalid.
 */
export function readState(): CaffeinateState | null {
  try {
    const data = fs.readFileSync(PID_FILE, 'utf-8')
    return JSON.parse(data) as CaffeinateState
  } catch {
    return null
  }
}

/**
 * Write caffeinate state to the PID file.
 */
export function writeState(state: CaffeinateState): void {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  fs.writeFileSync(PID_FILE, JSON.stringify(state, null, 2))
}

/**
 * Remove the PID file.
 */
export function clearState(): void {
  try {
    fs.unlinkSync(PID_FILE)
  } catch {
    // File may not exist - that's fine
  }
}

/**
 * Check whether a process with the given PID is still running.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Get the status of the managed caffeinate process.
 * Cleans up stale state if the process is no longer running.
 */
export function getStatus(): { running: boolean; state: CaffeinateState | null } {
  const state = readState()
  if (!state) {
    return { running: false, state: null }
  }

  if (!isProcessRunning(state.pid)) {
    // Process died externally - clean up stale PID file
    clearState()
    return { running: false, state: null }
  }

  return { running: true, state }
}

/**
 * Start a background caffeinate process.
 *
 * @param flags - Additional flags to pass to caffeinate (e.g. ['-d', '-i'])
 * @param duration - Optional duration in seconds (passed as -t flag)
 * @returns The state of the started process
 * @throws If already running (idempotent guard) or on non-macOS
 */
export function startCaffeinate(flags: string[] = [], duration?: number): CaffeinateState {
  assertMacOS()

  // Idempotent: if already running, return existing state
  const { running, state: existingState } = getStatus()
  if (running && existingState) {
    return existingState
  }

  const args = [...flags]
  if (duration !== undefined && duration > 0) {
    args.push('-t', String(duration))
  }

  const child = spawn('caffeinate', args, {
    detached: true,
    stdio: 'ignore',
  })

  child.unref()

  if (!child.pid) {
    throw new Error('Failed to start caffeinate process')
  }

  const state: CaffeinateState = {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    flags: args,
    ...(duration !== undefined && duration > 0 ? { duration } : {}),
  }

  writeState(state)
  return state
}

/**
 * Stop the managed caffeinate process.
 *
 * @returns true if a process was stopped, false if nothing was running
 */
export function stopCaffeinate(): boolean {
  const { running, state } = getStatus()
  if (!running || !state) {
    clearState() // Clean up any stale file
    return false
  }

  try {
    process.kill(state.pid, 'SIGTERM')
  } catch {
    // Process may have already exited
  }

  clearState()
  return true
}

// Exported for testing
export const _internals = {
  RUNTIME_DIR,
  PID_FILE,
}
