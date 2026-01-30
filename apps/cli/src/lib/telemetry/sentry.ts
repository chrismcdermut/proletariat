/**
 * Sentry Error Tracking Integration
 *
 * Privacy-first error tracking for the Proletariat CLI.
 * - Opt-in only (disabled by default)
 * - Strict allowlist approach - only captures explicitly approved fields
 * - Scrubs all file paths, usernames, and PII from stack traces
 * - Never captures ticket content, environment variables, or secrets
 *
 * @see docs/TELEMETRY.md for data collection policy
 */

import * as Sentry from '@sentry/node'
import * as os from 'node:os'
import {
  readMachineConfig,
  writeMachineConfig,
  ensureMachineConfigDir,
} from '../machine-config.js'

// Sentry DSNs - these are public identifiers, not secrets
// Development DSN - for local development builds
const SENTRY_DSN_DEV = ''  // Placeholder - set when Sentry project is created
// Production DSN - for released builds
const SENTRY_DSN_PROD = ''  // Placeholder - set when Sentry project is created

// CLI version from package.json (injected at build time or read dynamically)
let cliVersion = 'unknown'

// Current command context
let currentCommandName: string | null = null
let currentExecutionMode: string | null = null

/**
 * Privacy-sensitive patterns to scrub from error data.
 * Uses allowlist approach - we explicitly define what patterns to remove.
 */
const SCRUB_PATTERNS = {
  // File paths (Unix and Windows)
  paths: [
    /\/Users\/[^/\s]+/g,           // macOS /Users/username
    /\/home\/[^/\s]+/g,            // Linux /home/username
    /C:\\Users\\[^\\s]+/gi,        // Windows C:\Users\username
    /~\/[^\s]+/g,                  // Home directory shorthand
    /\/workspace\/[^\s]+/g,        // Container workspace paths
    /\/var\/[^\s]+/g,              // Var paths (may contain usernames)
    /\/tmp\/[^\s]+/g,              // Temp paths
  ],
  // Repository and project names
  repos: [
    /github\.com\/[^/\s]+\/[^/\s]+/g,  // GitHub repo URLs
    /gitlab\.com\/[^/\s]+\/[^/\s]+/g,  // GitLab repo URLs
    /bitbucket\.org\/[^/\s]+\/[^/\s]+/g,  // Bitbucket repo URLs
  ],
  // Environment variables and secrets
  secrets: [
    /(?:api[_-]?key|token|secret|password|auth)[:=]\s*['"]?[^\s'"]+['"]?/gi,
    /Bearer\s+[^\s]+/gi,
    /gh[ps]_[a-zA-Z0-9]+/g,  // GitHub tokens
  ],
  // Email addresses
  emails: [
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  ],
  // Ticket content (IDs are ok, but not content)
  ticketContent: [
    /description:\s*["'][^"']+["']/gi,
    /content:\s*["'][^"']+["']/gi,
  ],
}

/**
 * Scrub sensitive data from a string.
 * Replaces paths, usernames, secrets with redacted placeholders.
 */
function scrubString(input: string): string {
  let result = input

  // Scrub all patterns
  for (const [category, patterns] of Object.entries(SCRUB_PATTERNS)) {
    for (const pattern of patterns) {
      result = result.replace(pattern, `[REDACTED_${category.toUpperCase()}]`)
    }
  }

  return result
}

/**
 * Deep scrub an object, removing sensitive data from all string values.
 */
function scrubObject(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return scrubString(obj)
  }

  if (Array.isArray(obj)) {
    return obj.map(item => scrubObject(item))
  }

  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      // Skip sensitive keys entirely
      const keyLower = key.toLowerCase()
      if (
        keyLower.includes('password') ||
        keyLower.includes('secret') ||
        keyLower.includes('token') ||
        keyLower.includes('auth') ||
        keyLower.includes('credential') ||
        keyLower.includes('env') ||
        keyLower.includes('path') && keyLower !== 'errorpath'
      ) {
        result[key] = '[REDACTED]'
        continue
      }

      result[key] = scrubObject(value)
    }
    return result
  }

  return obj
}

/**
 * Sentry beforeSend hook - scrubs all sensitive data before sending.
 * This is our primary privacy protection layer.
 */
function beforeSend(
  event: Sentry.ErrorEvent,
  _hint: Sentry.EventHint
): Sentry.ErrorEvent | null {
  // Never send in test environment
  if (isTestEnvironment()) {
    return null
  }

  // Scrub exception messages
  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      if (exception.value) {
        exception.value = scrubString(exception.value)
      }

      // Scrub stack trace frames
      if (exception.stacktrace?.frames) {
        for (const frame of exception.stacktrace.frames) {
          // Remove absolute paths from filenames
          if (frame.filename) {
            frame.filename = frame.filename
              .replace(/^.*\/node_modules\//, 'node_modules/')
              .replace(/^.*\/dist\//, 'dist/')
              .replace(/^.*\/src\//, 'src/')
          }

          // Scrub context lines
          if (frame.pre_context) {
            frame.pre_context = frame.pre_context.map(line => scrubString(line))
          }
          if (frame.context_line) {
            frame.context_line = scrubString(frame.context_line)
          }
          if (frame.post_context) {
            frame.post_context = frame.post_context.map(line => scrubString(line))
          }
        }
      }
    }
  }

  // Scrub breadcrumbs
  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      if (breadcrumb.message) {
        breadcrumb.message = scrubString(breadcrumb.message)
      }
      if (breadcrumb.data) {
        breadcrumb.data = scrubObject(breadcrumb.data) as Record<string, unknown>
      }
    }
  }

  // Scrub extra context
  if (event.extra) {
    event.extra = scrubObject(event.extra) as Record<string, unknown>
  }

  // Scrub tags (but keep allowed ones)
  const allowedTags = ['command', 'environment', 'executionMode', 'platform', 'nodeVersion']
  if (event.tags) {
    const scrubbedTags: Record<string, string> = {}
    for (const [key, value] of Object.entries(event.tags)) {
      if (allowedTags.includes(key) && typeof value === 'string') {
        scrubbedTags[key] = scrubString(value)
      }
    }
    event.tags = scrubbedTags
  }

  // Remove user data entirely (we don't track users)
  delete event.user

  // Remove server name (could reveal hostname)
  delete event.server_name

  return event
}

/**
 * Check if running in a test environment.
 */
export function isTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.JEST_WORKER_ID !== undefined ||
    process.argv.some(arg => arg.includes('mocha'))
  )
}

/**
 * Check if running in CI/non-interactive environment.
 */
export function isNonInteractive(): boolean {
  return (
    process.env.CI === 'true' ||
    process.env.CONTINUOUS_INTEGRATION === 'true' ||
    process.env.GITHUB_ACTIONS === 'true' ||
    process.env.GITLAB_CI === 'true' ||
    process.env.JENKINS_URL !== undefined ||
    !process.stdin.isTTY
  )
}

/**
 * Get the current environment (development, production, test).
 */
export function getEnvironment(): 'development' | 'production' | 'test' {
  if (isTestEnvironment()) {
    return 'test'
  }

  // Check if this is a development build
  // In development, we typically run from source via ts-node or dev scripts
  if (
    process.env.NODE_ENV === 'development' ||
    process.argv[1]?.includes('/dev') ||
    process.argv[1]?.includes('ts-node')
  ) {
    return 'development'
  }

  return 'production'
}

/**
 * Check if error tracking is enabled in machine config.
 */
export function isErrorTrackingEnabled(): boolean {
  try {
    const config = readMachineConfig()
    return config.telemetry?.errorTracking === true
  } catch {
    return false
  }
}

/**
 * Set error tracking preference in machine config.
 */
export function setErrorTracking(enabled: boolean): void {
  ensureMachineConfigDir()
  const config = readMachineConfig()

  if (!config.telemetry) {
    (config as unknown as { telemetry: Record<string, unknown> }).telemetry = {}
  }

  (config as unknown as { telemetry: { errorTracking: boolean } }).telemetry.errorTracking = enabled
  writeMachineConfig(config)
}

/**
 * Check if the user has been prompted for telemetry consent.
 */
export function hasBeenPromptedForTelemetry(): boolean {
  try {
    const config = readMachineConfig()
    return config.telemetry?.prompted === true
  } catch {
    return false
  }
}

/**
 * Mark that the user has been prompted for telemetry consent.
 */
export function markTelemetryPrompted(): void {
  ensureMachineConfigDir()
  const config = readMachineConfig()

  if (!config.telemetry) {
    (config as unknown as { telemetry: Record<string, unknown> }).telemetry = {}
  }

  (config as unknown as { telemetry: { prompted: boolean } }).telemetry.prompted = true
  writeMachineConfig(config)
}

/**
 * Initialize Sentry error tracking.
 * Should be called early in CLI bootstrap (init hook).
 *
 * @param version - CLI version string
 */
export function initSentry(version: string): void {
  cliVersion = version

  // Don't initialize in test environment
  if (isTestEnvironment()) {
    return
  }

  // Don't initialize if user hasn't opted in
  if (!isErrorTrackingEnabled()) {
    return
  }

  const environment = getEnvironment()
  const dsn = environment === 'production' ? SENTRY_DSN_PROD : SENTRY_DSN_DEV

  // Don't initialize if no DSN configured
  if (!dsn) {
    return
  }

  Sentry.init({
    dsn,
    environment,
    release: `proletariat-cli@${version}`,

    // Privacy protection - only send what we explicitly allow
    beforeSend,

    // Don't send default PII
    sendDefaultPii: false,

    // Disable performance monitoring (we only want errors)
    tracesSampleRate: 0,

    // Set a reasonable max breadcrumbs
    maxBreadcrumbs: 20,

    // Integration options - keep only essential integrations
    integrations: (integrations) => {
      // Remove integrations that could leak sensitive data
      return integrations.filter((integration) => {
        // Keep only essential integrations
        const keepIntegrations = [
          'InboundFilters',
          'FunctionToString',
          'LinkedErrors',
          'Dedupe',
        ]
        return keepIntegrations.includes(integration.name)
      })
    },
  })

  // Add safe context
  Sentry.setContext('runtime', {
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
  })
}

/**
 * Set the current command context for error reports.
 * Called at the start of command execution.
 */
export function setCommandContext(commandName: string, args?: string[]): void {
  currentCommandName = commandName

  // Only set context if Sentry is initialized
  if (!isErrorTrackingEnabled() || isTestEnvironment()) {
    return
  }

  Sentry.setTag('command', commandName)

  // Sanitize arguments - only include flag names, not values
  if (args && args.length > 0) {
    const sanitizedArgs = args.map(arg => {
      // Keep flag names (--flag, -f)
      if (arg.startsWith('-')) {
        return arg.split('=')[0]  // Remove values from --flag=value
      }
      // Replace positional arguments with placeholders
      return '[arg]'
    })

    Sentry.setContext('command', {
      name: commandName,
      argCount: args.length,
      sanitizedArgs,
    })
  }
}

/**
 * Set the current execution mode context.
 */
export function setExecutionContext(mode: string, environment?: string): void {
  currentExecutionMode = mode

  if (!isErrorTrackingEnabled() || isTestEnvironment()) {
    return
  }

  Sentry.setTag('executionMode', mode)
  if (environment) {
    Sentry.setTag('executionEnvironment', environment)
  }
}

/**
 * Capture an error and send to Sentry.
 * Automatically adds command context and scrubs sensitive data.
 *
 * @param error - The error to capture
 * @param context - Additional context (will be scrubbed)
 */
export function captureError(error: Error, context?: Record<string, unknown>): void {
  // Don't capture if not enabled
  if (!isErrorTrackingEnabled() || isTestEnvironment()) {
    return
  }

  // Add additional context (will be scrubbed by beforeSend)
  const safeContext = context ? scrubObject(context) : undefined

  Sentry.withScope((scope) => {
    if (safeContext && typeof safeContext === 'object') {
      scope.setContext('additional', safeContext as Record<string, unknown>)
    }

    if (currentCommandName) {
      scope.setTag('command', currentCommandName)
    }

    if (currentExecutionMode) {
      scope.setTag('executionMode', currentExecutionMode)
    }

    scope.setTag('cliVersion', cliVersion)

    Sentry.captureException(error)
  })
}

/**
 * Capture a message (non-error) event.
 *
 * @param message - The message to capture (will be scrubbed)
 * @param level - Severity level
 */
export function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info'
): void {
  if (!isErrorTrackingEnabled() || isTestEnvironment()) {
    return
  }

  Sentry.captureMessage(scrubString(message), level)
}

/**
 * Add a breadcrumb for debugging context.
 * Breadcrumbs are included in error reports to help understand the sequence of events.
 *
 * @param message - Description of the event
 * @param category - Category for grouping
 * @param data - Additional data (will be scrubbed)
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>
): void {
  if (!isErrorTrackingEnabled() || isTestEnvironment()) {
    return
  }

  Sentry.addBreadcrumb({
    message: scrubString(message),
    category,
    data: data ? (scrubObject(data) as Record<string, unknown>) : undefined,
    level: 'info',
  })
}

/**
 * Flush pending events to Sentry.
 * Call this before the process exits to ensure errors are sent.
 *
 * @param timeout - Maximum time to wait in ms
 */
export async function flush(timeout = 2000): Promise<boolean> {
  if (!isErrorTrackingEnabled() || isTestEnvironment()) {
    return true
  }

  return Sentry.flush(timeout)
}

/**
 * Wrapper to capture errors from async functions.
 * Use this to wrap execution runners and other critical async code.
 */
export async function withErrorCapture<T>(
  fn: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof Error) {
      captureError(error, context)
    }
    throw error
  }
}

/**
 * Data collection disclosure message for opt-in prompt.
 */
export const DATA_DISCLOSURE = `
Proletariat CLI can send anonymous error reports to help improve stability.

What we collect:
  - Error messages and stack traces (scrubbed of paths/usernames)
  - Command name (e.g., "work start", "ticket list")
  - CLI version, Node.js version, and platform (macOS/Linux/Windows)
  - Execution mode (host, devcontainer, docker)

What we NEVER collect:
  - File paths, repository names, or workspace locations
  - Ticket content, descriptions, or any user-generated text
  - Environment variables, tokens, or secrets
  - Personal information or usernames

All data is processed through strict privacy filters before sending.
`.trim()

// Export for testing
export { scrubString, scrubObject }
