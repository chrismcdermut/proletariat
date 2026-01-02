/**
 * Log Action
 *
 * Outputs log messages when hooks fire.
 */

import { LogAction, HookExecutionContext } from '../types.js'
import { interpolateTemplate } from './utils.js'

export interface LogResult {
  message: string
  level: string
}

/**
 * Execute a log action
 */
export async function executeLogAction(
  action: LogAction,
  context: HookExecutionContext
): Promise<LogResult> {
  const { payload, log } = context

  // Interpolate message with payload values
  const message = interpolateTemplate(action.message, payload)
  const level = action.level || 'info'

  // Format message with level prefix
  const prefix = getLogPrefix(level)
  const formattedMessage = `${prefix} ${message}`

  // Output via context log function
  log(formattedMessage)

  return {
    message,
    level,
  }
}

/**
 * Get log level prefix
 */
function getLogPrefix(level: string): string {
  switch (level) {
    case 'debug':
      return '[DEBUG]'
    case 'info':
      return '[INFO]'
    case 'warn':
      return '[WARN]'
    case 'error':
      return '[ERROR]'
    default:
      return '[LOG]'
  }
}
