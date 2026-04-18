/**
 * Hook Executor
 *
 * Executes hook actions (shell commands, webhooks, log messages) when
 * work lifecycle events fire. Each action type has its own execution logic.
 *
 * Shell commands receive event data as environment variables prefixed with
 * PRLT_HOOK_. A PRLT_HOOK_JSON variable carries the full payload as valid
 * JSON so hooks can parse it reliably. Webhook actions POST event data as
 * JSON. Log actions print interpolated messages to stdout.
 */

import { execSync } from 'node:child_process'
import type { WorkHookConfig, HookExecutionResult } from './types.js'

/**
 * JSON replacer that converts Date objects to ISO-8601 strings.
 * Prevents [object Object] or invalid serialisation for non-primitive values.
 */
export function safeJsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  return value
}

/**
 * Safely serialise event data to a JSON string.
 * Returns a valid JSON string even when the payload contains Date objects
 * or other non-primitive values.  On serialisation failure returns a
 * minimal fallback so hooks always receive parseable JSON.
 */
export function safeJsonStringify(eventName: string, eventData: Record<string, unknown>): string {
  try {
    return JSON.stringify({ event: eventName, ...eventData }, safeJsonReplacer)
  } catch {
    // Fallback: emit at least the event name so consumers always get valid JSON
    return JSON.stringify({ event: eventName, error: 'payload_serialization_failed' })
  }
}

/**
 * Build environment variables from event data for shell hook execution.
 * All keys are uppercased and prefixed with PRLT_HOOK_.
 *
 * PRLT_HOOK_JSON contains the full event payload as valid JSON.
 */
export function buildEnvVars(eventName: string, eventData: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = {
    PRLT_HOOK_EVENT: eventName,
    PRLT_HOOK_JSON: safeJsonStringify(eventName, eventData),
  }

  for (const [key, value] of Object.entries(eventData)) {
    if (value === null || value === undefined) continue
    const envKey = `PRLT_HOOK_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`
    if (value instanceof Date) {
      env[envKey] = value.toISOString()
    } else if (typeof value === 'object') {
      // Serialize objects/arrays as JSON instead of [object Object]
      try {
        env[envKey] = JSON.stringify(value, safeJsonReplacer)
      } catch {
        env[envKey] = String(value)
      }
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
        // Fire-and-forget POST to the configured URL.
        // Uses safeJsonReplacer so Date objects become ISO strings.
        const body = JSON.stringify(
          {
            event: eventName,
            data: eventData,
            hook: { id: hook.id, name: hook.name },
            timestamp: new Date().toISOString(),
          },
          safeJsonReplacer,
        )

        // Pass JSON via stdin to avoid shell-escaping issues that
        // caused invalid JSON on abnormal termination (PRLT-1260).
        execSync(
          `curl -s -X POST -H "Content-Type: application/json" -d @- '${hook.actionValue.replace(/'/g, "'\\''")}' `,
          { input: body, timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] },
        )
        break
      }

      case 'log': {
        const message = interpolate(hook.actionValue, eventName, eventData)
        console.log(`[hook:${hook.name}] ${message}`)
        break
      }

      case 'action': {
        // Action-type hooks are handled directly by HookManager via
        // built-in action handlers — they should not reach the executor.
        // If they do, return an error so the misconfiguration is visible.
        return {
          hookId: hook.id,
          hookName: hook.name,
          action: hook.actionValue,
          success: false,
          error: 'action-type hooks must be routed through built-in action handlers, not the executor',
          durationMs: Date.now() - start,
        }
      }

      case 'poke': {
        // Poke-type hooks are handled by HookManager via service action handlers.
        // They should not reach the executor directly.
        return {
          hookId: hook.id,
          hookName: hook.name,
          action: hook.actionValue,
          success: false,
          error: 'poke-type hooks must be routed through built-in action handlers, not the executor',
          durationMs: Date.now() - start,
        }
      }

      case 'llm': {
        // LLM-type hooks are handled by HookManager via service action handlers.
        // They should not reach the executor directly.
        return {
          hookId: hook.id,
          hookName: hook.name,
          action: hook.actionValue,
          success: false,
          error: 'llm-type hooks must be routed through built-in action handlers, not the executor',
          durationMs: Date.now() - start,
        }
      }
    }

    return {
      hookId: hook.id,
      hookName: hook.name,
      action: hook.actionValue,
      success: true,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      hookId: hook.id,
      hookName: hook.name,
      action: hook.actionValue,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}
