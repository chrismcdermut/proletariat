import { Hook } from '@oclif/core'

/**
 * Prerun hook - runs before every command
 *
 * Captures command start time for analytics tracking.
 * The start time is stored globally and used by postrun hook.
 */

// Global storage for command start time (simple approach for CLI)
declare global {
  // eslint-disable-next-line no-var
  var __prlt_command_start_time: number | undefined
}

const hook: Hook<'prerun'> = async function () {
  // Record command start time
  global.__prlt_command_start_time = Date.now()
}

export default hook
