import { Hook } from '@oclif/core'
import { flushSentry } from '../lib/telemetry.js'
import { trackCommandRun, shutdownAnalytics } from '../lib/telemetry/analytics.js'
import { flushPendingVersionCheck } from '../lib/update-check.js'

/**
 * Postrun hook - runs after every command completes (when not bypassed by process.exit)
 *
 * Tracks the command_run event and flushes pending analytics, version check,
 * and Sentry crash reports. The init hook also registers a process.on('exit')
 * handler as a safety net for telemetry tracking in case signal handlers
 * call process.exit() directly. The __prlt_telemetry_tracked flag prevents
 * double-counting between the two mechanisms.
 */
const hook: Hook<'postrun'> = async function ({ Command, argv }) {
  // Mark as tracked so the process.on('exit') fallback in init.ts skips
  if (!(globalThis as Record<string, unknown>).__prlt_telemetry_tracked) {
    ;(globalThis as Record<string, unknown>).__prlt_telemetry_tracked = true

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
  }

  // Flush pending events — don't delay CLI exit longer than necessary
  await Promise.all([
    flushPendingVersionCheck(),
    shutdownAnalytics(),
    flushSentry(),
  ])
}

export default hook
