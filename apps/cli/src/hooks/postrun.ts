import { Hook } from '@oclif/core'
import { flushSentry } from '../lib/telemetry.js'

/**
 * Postrun hook - runs after every command
 *
 * Flushes pending Sentry events with a 2s timeout to ensure
 * crash reports are delivered before the process exits.
 */
const hook: Hook<'postrun'> = async function () {
  await flushSentry()
}

export default hook
