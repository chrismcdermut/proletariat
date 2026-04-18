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

import { execSync, execFileSync } from 'node:child_process'
import type { WorkHookConfig, HookExecutionResult, PokeActionConfig, LlmActionConfig } from './types.js'
import { interpolateTemplate } from './types.js'

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
 * Execute the 'poke' action type — send a message to a named session
 * in-process via `prlt session poke` (execFile, no shell).
 */
function executePoke(
  hook: WorkHookConfig,
  eventName: string,
  eventData: Record<string, unknown>,
): { success: boolean; error?: string } {
  const config = hook.config as PokeActionConfig | null
  const target = config?.target || hook.actionRef || 'orchestrator-main'
  const template = config?.template || hook.actionValue || '{event}: {ticket_id}'

  const payload = { event: eventName, ...eventData }
  const message = interpolateTemplate(template, payload)

  execFileSync('prlt', ['session', 'poke', target, message], {
    timeout: 30_000,
    stdio: 'pipe',
  })

  return { success: true }
}

/**
 * Execute the 'llm' action type — placeholder for LLM judgment.
 * The actual LLM routing is handled by the mode system (mode='llm'),
 * but this action type sends a prompt to LLM for triage/judgment
 * using the template in config.
 */
function executeLlm(
  hook: WorkHookConfig,
  eventName: string,
  eventData: Record<string, unknown>,
): { success: boolean; error?: string } {
  const config = hook.config as LlmActionConfig | null
  const template = config?.prompt || hook.actionValue || 'Triage event: {event}'

  const payload = { event: eventName, ...eventData }
  const message = interpolateTemplate(template, payload)

  // Log the LLM prompt — actual LLM invocation is handled at a higher level
  // (the orchestrate engine's llm-agent.ts) or by the hook mode system.
  console.log(`[hook:${hook.name}:llm] ${message}`)
  return { success: true }
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

      case 'poke': {
        const result = executePoke(hook, eventName, eventData)
        if (!result.success) throw new Error(result.error)
        break
      }

      case 'action': {
        // action_type='action' is handled by HookManager.executeHookAction()
        // which resolves the action_ref to a built-in handler. If we reach
        // here, it means no handler was found — fall through to error.
        const actionName = hook.actionRef || hook.actionValue
        throw new Error(`No built-in handler found for action: ${actionName}`)
      }

      case 'llm': {
        const result = executeLlm(hook, eventName, eventData)
        if (!result.success) throw new Error(result.error)
        break
      }
    }

    return {
      hookId: hook.id,
      hookName: hook.name,
      action: hook.actionRef || hook.actionValue,
      success: true,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      hookId: hook.id,
      hookName: hook.name,
      action: hook.actionRef || hook.actionValue,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}
