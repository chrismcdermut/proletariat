import { Hook } from '@oclif/core'
import { flushSentry } from '../lib/telemetry.js'
import { trackCommandRun, shutdownAnalytics } from '../lib/telemetry/analytics.js'
import { flushPendingVersionCheck } from '../lib/update-check.js'

/**
 * Postrun hook - runs after every command completes
 *
 * Tracks the command_run event with duration and success via Statsig,
 * then flushes pending analytics events, version check, and Sentry crash
 * reports before CLI exit.
 */
const hook: Hook<'postrun'> = async function ({ Command, argv }) {
  const startTime = (globalThis as Record<string, unknown>).__prlt_command_start as number | undefined
  const commandId = (globalThis as Record<string, unknown>).__prlt_command_id as string | undefined

  if (commandId && startTime) {
    const durationMs = Date.now() - startTime

    // Extract flag names (not values) from argv for privacy
    const flagsUsed = (argv ?? [])
      .filter((arg: string) => arg.startsWith('-'))
      .map((arg: string) => arg.replace(/=.*/, ''))

    trackCommandRun({
      command: commandId,
      durationMs,
      success: true,
      flags: flagsUsed,
    })
  }

  // Flush pending events — don't delay CLI exit longer than necessary
  await Promise.all([
    flushPendingVersionCheck(),
    shutdownAnalytics(),
    flushSentry(),
  ])
}

export default hook
