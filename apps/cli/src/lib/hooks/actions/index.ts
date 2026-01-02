/**
 * Hook Actions
 *
 * Main entry point for action execution.
 * Routes action types to their specific executors.
 */

import {
  HookAction,
  HookExecutionContext,
  SpawnAgentAction,
  ShellAction,
  LogAction,
  WebhookAction,
  NotifyAction,
} from '../types.js'
import { executeSpawnAction } from './spawn.js'
import { executeShellAction } from './shell.js'
import { executeLogAction } from './log.js'
import { executeWebhookAction } from './webhook.js'

/**
 * Execute a hook action based on its type
 */
export async function executeAction(
  action: HookAction,
  context: HookExecutionContext
): Promise<unknown> {
  switch (action.type) {
    case 'spawn_agent':
      return executeSpawnAction(action as SpawnAgentAction, context)

    case 'shell':
      return executeShellAction(action as ShellAction, context)

    case 'log':
      return executeLogAction(action as LogAction, context)

    case 'webhook':
      return executeWebhookAction(action as WebhookAction, context)

    case 'notify':
      // Notify is a placeholder for future implementation
      context.log(`[WARN] Notify action not yet implemented: ${(action as NotifyAction).channel}`)
      return {
        success: false,
        error: 'Notify action not yet implemented',
      }

    default:
      throw new Error(`Unknown action type: ${(action as HookAction).type}`)
  }
}

// Re-export individual action executors for direct use
export { executeSpawnAction } from './spawn.js'
export { executeShellAction } from './shell.js'
export { executeLogAction } from './log.js'
export { executeWebhookAction } from './webhook.js'
export { interpolateTemplate, getNestedValue, formatValue } from './utils.js'
