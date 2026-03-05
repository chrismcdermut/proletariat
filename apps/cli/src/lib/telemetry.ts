/**
 * Telemetry and error tracking via Sentry.
 *
 * Implements opt-out crash reporting with:
 * - First-run notice shown once
 * - `prlt telemetry disable/enable/status` commands
 * - Respects DO_NOT_TRACK=1 and PRLT_TELEMETRY_DISABLED=1 env vars
 * - Consent stored in ~/.proletariat/config.json
 * - Path scrubbing to remove usernames from stack traces
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getMachineConfigDir, ensureMachineConfigDir } from './machine-config.js'

// Sentry DSN — safe to embed, only allows sending events (not reading)
const SENTRY_DSN = 'https://dfc8445d17ed9bb0c56f680ed28f72f8@o4510992964714496.ingest.us.sentry.io/4510992973037568'

interface TelemetryConfig {
  enabled?: boolean
  noticeShown?: boolean
}

/**
 * Read the telemetry section from machine config.
 */
export function readTelemetryConfig(): TelemetryConfig {
  const configPath = path.join(getMachineConfigDir(), 'config.json')

  if (!fs.existsSync(configPath)) {
    return {}
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(content)
    return {
      enabled: config.telemetry,
      noticeShown: config.telemetryNoticeShown,
    }
  } catch {
    return {}
  }
}

/**
 * Write telemetry preferences to machine config.
 */
export function writeTelemetryConfig(telemetry: TelemetryConfig): void {
  ensureMachineConfigDir()
  const configPath = path.join(getMachineConfigDir(), 'config.json')

  let config: Record<string, unknown> = {}
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    } catch {
      // If corrupt, start fresh but preserve as much as possible
    }
  }

  if (telemetry.enabled !== undefined) {
    config.telemetry = telemetry.enabled
  }

  if (telemetry.noticeShown !== undefined) {
    config.telemetryNoticeShown = telemetry.noticeShown
  }

  const tempPath = `${configPath}.tmp.${process.pid}`
  try {
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf-8')
    fs.renameSync(tempPath, configPath)
  } catch {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check if telemetry is enabled.
 *
 * Disabled when any of:
 * - DO_NOT_TRACK=1 (consoledonottrack.com standard)
 * - PRLT_TELEMETRY_DISABLED=1
 * - User ran `prlt telemetry disable` (config.telemetry === false)
 *
 * Enabled by default (opt-out model).
 */
export function isTelemetryEnabled(): boolean {
  // Env vars take precedence
  if (process.env.DO_NOT_TRACK === '1') return false
  if (process.env.PRLT_TELEMETRY_DISABLED === '1') return false

  // Check stored preference
  const config = readTelemetryConfig()
  if (config.enabled === false) return false

  return true
}

/**
 * Check if the first-run telemetry notice has been shown.
 */
export function hasShownTelemetryNotice(): boolean {
  const config = readTelemetryConfig()
  return config.noticeShown === true
}

/**
 * Mark the telemetry notice as shown.
 */
export function markTelemetryNoticeShown(): void {
  writeTelemetryConfig({ noticeShown: true })
}

/**
 * Show the first-run telemetry notice.
 * Returns true if the notice was shown (first time), false if already shown.
 */
export function showTelemetryNotice(): boolean {
  if (hasShownTelemetryNotice()) return false

  // Only show in interactive TTY sessions
  if (!process.stdout.isTTY) {
    markTelemetryNoticeShown()
    return false
  }

  console.log('')
  console.log('Proletariat collects anonymous crash reports to improve the CLI.')
  console.log('No personal data is collected. You can opt out at any time:')
  console.log('')
  console.log('  prlt telemetry disable')
  console.log('')

  markTelemetryNoticeShown()
  return true
}

/**
 * Scrub file paths to remove usernames / home directory references.
 * Replaces /Users/<username>/... or /home/<username>/... with ~/ ...
 */
function scrubFilePaths(text: string): string {
  const home = os.homedir()
  // Replace the actual home directory with ~
  return text.replaceAll(home, '~')
}

/**
 * Get the Sentry DSN. Exposed for testing.
 */
export function getSentryDSN(): string {
  return process.env.SENTRY_DSN || SENTRY_DSN
}

/**
 * Initialize Sentry error tracking.
 * Should be called as early as possible in the CLI lifecycle.
 *
 * @param cliVersion - The CLI version string from oclif config
 */
export async function initSentry(cliVersion: string): Promise<void> {
  if (!isTelemetryEnabled()) return

  showTelemetryNotice()

  try {
    const Sentry = await import('@sentry/node')

    Sentry.init({
      dsn: getSentryDSN(),
      tracesSampleRate: 0, // Disable performance monitoring, errors only
      sendDefaultPii: false,
      release: `proletariat-cli@${cliVersion}`,
      beforeSend(event) {
        // Scrub file paths in exception stack traces
        if (event.exception?.values) {
          for (const exception of event.exception.values) {
            if (exception.stacktrace?.frames) {
              for (const frame of exception.stacktrace.frames) {
                if (frame.filename) {
                  frame.filename = scrubFilePaths(frame.filename)
                }
                if (frame.abs_path) {
                  frame.abs_path = scrubFilePaths(frame.abs_path)
                }
              }
            }

            if (exception.value) {
              exception.value = scrubFilePaths(exception.value)
            }
          }
        }

        // Scrub file paths in breadcrumbs
        if (event.breadcrumbs) {
          for (const breadcrumb of event.breadcrumbs) {
            if (breadcrumb.message) {
              breadcrumb.message = scrubFilePaths(breadcrumb.message)
            }
          }
        }

        return event
      },
    })

    // Set tags for environment context
    Sentry.setTag('os', os.platform())
    Sentry.setTag('os_version', os.release())
    Sentry.setTag('node_version', process.version)
    Sentry.setTag('arch', os.arch())
    Sentry.setTag('cli_version', cliVersion)
  } catch {
    // Silently fail — telemetry should never break the CLI
  }
}

/**
 * Flush pending Sentry events with a timeout.
 * Should be called in the postrun hook.
 */
export async function flushSentry(): Promise<void> {
  if (!isTelemetryEnabled()) return

  try {
    const Sentry = await import('@sentry/node')
    await Sentry.close(2000)
  } catch {
    // Silently fail
  }
}
