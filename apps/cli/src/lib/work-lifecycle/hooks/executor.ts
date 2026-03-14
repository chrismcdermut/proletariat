/**
 * Hook Executor
 *
 * Executes hook actions (shell commands, webhooks, log messages) when
 * work lifecycle events fire. Each action type has its own execution logic.
 *
 * Shell commands receive event data as environment variables prefixed with
 * PRLT_HOOK_. Webhook actions POST event data as JSON. Log actions print
 * interpolated messages to stdout.
 */

import { execSync } from 'node:child_process'
import type { WorkHookConfig, HookExecutionResult } from './types.js'

/**
 * Build environment variables from event data for shell hook execution.
 * All keys are uppercased and prefixed with PRLT_HOOK_.
 */
function buildEnvVars(eventName: string, eventData: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = {
    PRLT_HOOK_EVENT: eventName,
  }

  for (const [key, value] of Object.entries(eventData)) {
    if (value === null || value === undefined) continue
    const envKey = `PRLT_HOOK_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`
    if (value instanceof Date) {
      env[envKey] = value.toISOString()
    } else {
      env[envKey] = String(value)
    }
  }

  return env
}

/**
 * Interpolate {{variable}} placeholders in a string with event data.
 */
function interpolate(template: string, eventName: string, eventData: Record<string, unknown>): string {
  let result = template.replace(/\{\{event\}\}/g, eventName)

  for (const [key, value] of Object.entries(eventData)) {
    if (value === null || value === undefined) continue
    const strValue = value instanceof Date ? value.toISOString() : String(value)
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), strValue)
  }

  return result
}

/**
 * Execute a single hook action and return the result.
 */
export function executeHook(
  hook: WorkHookConfig,
  eventName: string,
  eventData: Record<string, unknown>,
): HookExecutionResult {
  const start = Date.now()

  try {
    switch (hook.actionType) {
      case 'shell': {
        const env = {
          ...process.env,
          ...buildEnvVars(eventName, eventData),
        }
        execSync(hook.actionValue, {
          env,
          timeout: 30_000, // 30 second timeout
          stdio: 'pipe',
        })
        break
      }

      case 'webhook': {
        // Fire-and-forget POST to the configured URL
        const body = JSON.stringify({
          event: eventName,
          data: eventData,
          hook: { id: hook.id, name: hook.name },
          timestamp: new Date().toISOString(),
        })

        // Use synchronous fetch via execSync to keep it simple
        // This avoids async complexity in the event handler
        execSync(
          `curl -s -X POST -H "Content-Type: application/json" -d '${body.replace(/'/g, "'\\''")}' '${hook.actionValue}'`,
          { timeout: 10_000, stdio: 'pipe' },
        )
        break
      }

      case 'log': {
        const message = interpolate(hook.actionValue, eventName, eventData)
        // eslint-disable-next-line no-console
        console.log(`[hook:${hook.name}] ${message}`)
        break
      }
    }

    return {
      hookId: hook.id,
      hookName: hook.name,
      success: true,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      hookId: hook.id,
      hookName: hook.name,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}
