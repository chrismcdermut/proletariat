/**
 * Hook Executor
 *
 * Executes hook actions (shell commands, webhooks, log messages, pokes,
 * direct actions, LLM prompts) when work lifecycle events fire.
 * Each action type has its own execution logic.
 *
 * Shell commands receive event data as environment variables prefixed with
 * PRLT_HOOK_. A PRLT_HOOK_JSON variable carries the full payload as valid
 * JSON so hooks can parse it reliably. Webhook actions POST event data as
 * JSON. Log actions print interpolated messages to stdout.
 *
 * Poke actions send a templated message to a named session without shelling
 * out — they use the session utilities directly for in-process delivery.
 *
 * Action-type hooks resolve a named action (action_ref) and call the
 * built-in handler directly, skipping shell indirection.
 */

import { execSync, execFileSync } from 'node:child_process'
import type { WorkHookConfig, HookExecutionResult, HookActionHandler } from './types.js'

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
 * Interpolate template placeholders in a string with event data.
 *
 * Supports two placeholder styles:
 * - {{variable}} — legacy log-style (double-brace)
 * - {variable}  — new action template style (single-brace)
 *
 * Both styles are expanded from the same event data map.
 */
export function interpolate(template: string, eventName: string, eventData: Record<string, unknown>): string {
  // Replace {{event}} and {event} with event name
  let result = template.replace(/\{\{event\}\}/g, eventName).replace(/\{event\}/g, eventName)

  for (const [key, value] of Object.entries(eventData)) {
    if (value === null || value === undefined) continue
    const strValue = value instanceof Date ? value.toISOString() : String(value)
    // Double-brace {{key}}
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), strValue)
    // Single-brace {key} — but not double-brace (negative lookbehind/ahead)
    result = result.replace(new RegExp(`(?<!\\{)\\{${key}\\}(?!\\})`, 'g'), strValue)
  }

  return result
}

/**
 * Execute a poke action — send a templated message to a named session.
 *
 * Uses `prlt session poke` via execFileSync for reliable delivery.
 * The target session is read from hook config (`config.target`).
 * The message is the interpolated actionValue template.
 */
function executePoke(
  hook: WorkHookConfig,
  eventName: string,
  eventData: Record<string, unknown>,
): HookExecutionResult {
  const start = Date.now()
  const target = (hook.config?.target as string) || hook.actionRef || hook.actionValue
  if (!target) {
    return {
      hookId: hook.id,
      hookName: hook.name,
      action: 'poke',
      success: false,
      error: 'No poke target specified (set config.target or action_ref)',
      durationMs: Date.now() - start,
    }
  }

  // Build the message from the template
  const template = (hook.config?.template as string) || hook.actionValue || '{event}: {ticket_id}'
  const message = interpolate(template, eventName, eventData)

  try {
    execFileSync('prlt', ['session', 'poke', target, message], {
      timeout: 30_000,
      stdio: 'pipe',
    })
    return {
      hookId: hook.id,
      hookName: hook.name,
      action: `poke:${target}`,
      success: true,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      hookId: hook.id,
      hookName: hook.name,
      action: `poke:${target}`,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * Execute an action-type hook — resolve a named action and call its handler.
 *
 * The action name is read from action_ref or actionValue.
 * The handler is looked up in the provided actionHandlers map.
 */
function executeAction(
  hook: WorkHookConfig,
  eventData: Record<string, unknown>,
  actionHandlers: Record<string, HookActionHandler>,
): HookExecutionResult {
  const start = Date.now()
  const actionName = hook.actionRef || hook.actionValue
  if (!actionName) {
    return {
      hookId: hook.id,
      hookName: hook.name,
      action: 'action',
      success: false,
      error: 'No action_ref or action_value specified for action-type hook',
      durationMs: Date.now() - start,
    }
  }

  const handler = actionHandlers[actionName]
  if (!handler) {
    return {
      hookId: hook.id,
      hookName: hook.name,
      action: actionName,
      success: false,
      error: `Unknown action: ${actionName}`,
      durationMs: Date.now() - start,
    }
  }

  const handlerResult = handler(eventData, hook.config ?? undefined)
  return {
    hookId: hook.id,
    hookName: hook.name,
    action: handlerResult.action,
    success: handlerResult.success,
    error: handlerResult.error,
    durationMs: handlerResult.durationMs,
    skipped: handlerResult.skipped,
  }
}

/**
 * Execute an LLM-type hook — send a prompt for judgment/triage.
 *
 * Currently logs the interpolated prompt. Full LLM integration
 * is handled by the mode=llm supervision tier; this action_type
 * is for actions where the LLM IS the execution, not the gate.
 */
function executeLlm(
  hook: WorkHookConfig,
  eventName: string,
  eventData: Record<string, unknown>,
): HookExecutionResult {
  const start = Date.now()
  const prompt = (hook.config?.prompt as string) || hook.actionValue
  const message = interpolate(prompt, eventName, eventData)

  // Log the LLM prompt — actual LLM invocation is wired through
  // the escalation pipeline (mode=llm) or future LLM action dispatch
  console.log(`[hook:${hook.name}:llm] ${message}`)

  return {
    hookId: hook.id,
    hookName: hook.name,
    action: `llm:${hook.name}`,
    success: true,
    durationMs: Date.now() - start,
  }
}

/**
 * Execute a single hook action and return the result.
 *
 * For 'action' type hooks, pass actionHandlers to resolve named actions.
 */
export function executeHook(
  hook: WorkHookConfig,
  eventName: string,
  eventData: Record<string, unknown>,
  actionHandlers?: Record<string, HookActionHandler>,
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

      case 'poke':
        return executePoke(hook, eventName, eventData)

      case 'action':
        return executeAction(hook, eventData, actionHandlers ?? {})

      case 'llm':
        return executeLlm(hook, eventName, eventData)
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
