/**
 * Prerun Hook - Analytics Command Start Time
 *
 * Runs before every command to record the start time.
 * This allows the postrun hook to calculate command duration.
 */

import { Hook } from '@oclif/core'

// Declare global for command start time
declare global {
  // eslint-disable-next-line no-var
  var __prlt_command_start_time: number | undefined
}

const hook: Hook<'prerun'> = async function ({ Command }) {
  // Skip analytics commands to avoid recursion
  if (Command.id?.startsWith('config analytics')) {
    return
  }

  // Record start time in global
  global.__prlt_command_start_time = Date.now()
}

export default hook
