/**
 * Shell Action
 *
 * Executes shell commands when hooks fire.
 */

import { spawn, SpawnOptions } from 'child_process'
import * as path from 'path'
import { ShellAction, HookExecutionContext } from '../types.js'
import { interpolateTemplate } from './utils.js'

export interface ShellResult {
  success: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  error?: string
}

/**
 * Execute a shell action
 */
export async function executeShellAction(
  action: ShellAction,
  context: HookExecutionContext
): Promise<ShellResult> {
  const { payload, workspacePath, log } = context

  // Interpolate command with payload values
  const command = interpolateTemplate(action.command, payload)

  // Determine working directory
  const cwd = action.cwd
    ? path.resolve(workspacePath, action.cwd)
    : workspacePath

  // Build environment
  const env = {
    ...process.env,
    ...action.env,
    // Add useful context variables
    PRLT_WORKSPACE: workspacePath,
    PRLT_EVENT: context.event,
    PRLT_HOOK_ID: context.hook.id,
    PRLT_HOOK_NAME: context.hook.name,
  }

  // If running in background, don't wait for completion
  if (action.background) {
    return executeBackgroundShell(command, cwd, env, log)
  }

  // Execute command and wait for completion
  return executeBlockingShell(command, cwd, env, action.timeout, log)
}

/**
 * Execute shell command in background (fire-and-forget)
 */
function executeBackgroundShell(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  log: (msg: string) => void
): ShellResult {
  const options: SpawnOptions = {
    cwd,
    env,
    shell: true,
    detached: true,
    stdio: 'ignore',
  }

  try {
    const child = spawn(command, [], options)
    child.unref()

    log(`Started background command: ${command}`)

    return {
      success: true,
      exitCode: null,
      stdout: '',
      stderr: '',
    }
  } catch (error) {
    return {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Execute shell command and wait for completion
 */
function executeBlockingShell(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeout?: number,
  log?: (msg: string) => void
): Promise<ShellResult> {
  return new Promise((resolve) => {
    const options: SpawnOptions = {
      cwd,
      env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }

    const child = spawn(command, [], options)

    let stdout = ''
    let stderr = ''
    let timedOut = false

    // Set up timeout if specified
    let timeoutId: NodeJS.Timeout | undefined
    if (timeout && timeout > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        // Force kill after 5 seconds if SIGTERM doesn't work
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL')
          }
        }, 5000)
      }, timeout)
    }

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (exitCode) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (timedOut) {
        resolve({
          success: false,
          exitCode: exitCode ?? null,
          stdout,
          stderr,
          error: `Command timed out after ${timeout}ms`,
        })
      } else {
        const success = exitCode === 0
        if (!success && log) {
          log(`Shell command failed with exit code ${exitCode}: ${command}`)
        }
        resolve({
          success,
          exitCode: exitCode ?? null,
          stdout,
          stderr,
        })
      }
    })

    child.on('error', (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      resolve({
        success: false,
        exitCode: null,
        stdout,
        stderr,
        error: error.message,
      })
    })
  })
}
