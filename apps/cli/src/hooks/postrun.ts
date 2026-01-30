import { Hook } from '@oclif/core'
import * as path from 'node:path'
import { findHQRoot } from '../lib/workspace.js'
import { isAnalyticsEnabled, trackCommand, flushQueue } from '../lib/analytics/index.js'

// Import package.json version
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function getCliVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    return pkg.version || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Postrun hook - runs after every command
 *
 * Tracks command execution for analytics (when opted-in).
 * Uses start time from prerun hook to calculate duration.
 */
const hook: Hook<'postrun'> = async function ({ Command }) {
  try {
    // Skip analytics tracking for analytics-related commands to avoid recursion
    if (Command?.id?.startsWith('config:analytics') || Command?.id === 'init') {
      return
    }

    // Find HQ root (if in a workspace)
    const hqRoot = findHQRoot()
    if (!hqRoot) {
      return
    }

    // Import Database dynamically to avoid loading if not needed
    const { default: Database } = await import('better-sqlite3')
    const dbPath = path.join(hqRoot, '.proletariat', 'workspace.db')

    let db
    try {
      db = new Database(dbPath)
    } catch {
      // Database doesn't exist or can't be opened - skip tracking
      return
    }

    try {
      // Check if analytics is enabled
      if (!isAnalyticsEnabled(db)) {
        db.close()
        return
      }

      // Calculate duration
      const startTime = global.__prlt_command_start_time
      const duration = startTime ? Date.now() - startTime : undefined

      // Get command name from Command class
      const commandName = Command?.id || 'unknown'

      // Track command execution
      trackCommand(db, {
        command: commandName,
        duration_ms: duration,
        success: true, // postrun only runs on success
        cli_version: getCliVersion(),
        environment: process.env.PRLT_ENVIRONMENT || 'host',
      })

      // Try to flush queue (non-blocking, fail silently)
      flushQueue(db).catch(() => {})

      db.close()
    } catch {
      // Silently fail - analytics should never break the CLI
      try {
        db.close()
      } catch {
        // Ignore close errors
      }
    }
  } catch {
    // Silently fail - analytics should never break the CLI
  }
}

export default hook
