/**
 * Postrun Hook - Analytics Command Tracking
 *
 * Runs after every command to track execution metrics.
 * Analytics are only sent if the user has opted in.
 */

import { Hook } from '@oclif/core'
import { findHQRoot } from '../lib/workspace.js'
import { openWorkspaceDatabase } from '../lib/database/index.js'
import { trackCommand, flushQueue, isAnalyticsEnabled } from '../lib/analytics/index.js'

// Store command start time (set by prerun hook via global)
declare global {
  // eslint-disable-next-line no-var
  var __prlt_command_start_time: number | undefined
}

const hook: Hook<'postrun'> = async function ({ Command, result }) {
  // Skip analytics commands to avoid recursion
  if (Command.id?.startsWith('config analytics')) {
    return
  }

  // Find HQ root - if not in an HQ, skip analytics
  const hqRoot = findHQRoot()
  if (!hqRoot) {
    return
  }

  let db
  try {
    db = openWorkspaceDatabase(hqRoot)

    // Check if analytics is enabled before doing any work
    if (!isAnalyticsEnabled(db)) {
      db.close()
      return
    }

    // Calculate duration if start time was recorded
    const startTime = global.__prlt_command_start_time
    const durationMs = startTime ? Date.now() - startTime : undefined

    // Track command completion (success if no error was thrown)
    await trackCommand(db, Command.id || 'unknown', true, {
      durationMs,
      exitCode: 0,
    })

    // Try to flush any queued events
    await flushQueue(db)

    db.close()
  } catch {
    // Never let analytics errors affect the CLI
    if (db) {
      try {
        db.close()
      } catch {
        // Ignore close errors
      }
    }
  }
}

export default hook
