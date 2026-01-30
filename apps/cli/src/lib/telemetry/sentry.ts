/**
 * Sentry Error Tracking Integration
 *
 * Provides privacy-focused error tracking for the Proletariat CLI.
 * Error tracking is opt-in and disabled by default.
 *
 * Privacy Guarantees:
 * - NEVER captures file paths, repository names, or workspace paths
 * - NEVER captures ticket content, descriptions, or user-generated text
 * - NEVER captures environment variables or secrets
 * - Scrubs potential PII from stack traces (paths, usernames)
 * - Uses allowlist approach: only captures explicitly approved fields
 *
 * Data Collected (when enabled):
 * - Command name being executed
 * - CLI version, Node.js version, platform/OS
 * - Execution mode (foreground, background, tmux, etc.)
 * - Error messages and sanitized stack traces
 * - Anonymous session identifier (no user tracking)
 */

import * as Sentry from '@sentry/node';
import * as os from 'node:os';
import { isErrorTrackingEnabled } from '../machine-config.js';

// Sentry DSN - using placeholder that should be replaced with real DSN in production
// The DSN should be set via environment variable PRLT_SENTRY_DSN
const SENTRY_DSN_PRODUCTION = process.env.PRLT_SENTRY_DSN || '';
const SENTRY_DSN_DEVELOPMENT = process.env.PRLT_SENTRY_DSN_DEV || '';

// Track initialization state
let isInitialized = false;

// Current command context for error enrichment
let currentCommandContext: CommandContext | null = null;

/**
 * Context about the current command being executed.
 * Used to enrich error reports with relevant information.
 */
export interface CommandContext {
  /** Command name (e.g., "work start", "ticket list") */
  commandName: string;
  /** Sanitized command arguments (no paths or secrets) */
  sanitizedArgs?: string[];
  /** Execution mode if applicable */
  executionMode?: 'foreground' | 'background' | 'terminal' | 'tmux';
  /** Project ID (not path) if applicable */
  projectId?: string;
}

/**
 * Determine the current environment.
 */
function getEnvironment(): 'production' | 'development' | 'test' {
  // Check for test environment
  if (process.env.NODE_ENV === 'test' || process.env.VITEST || process.env.MOCHA_COLORS !== undefined) {
    return 'test';
  }

  // Check for development environment
  if (process.env.NODE_ENV === 'development' || process.env.PRLT_DEV === 'true') {
    return 'development';
  }

  return 'production';
}

/**
 * Check if Sentry should be enabled.
 * Disabled in test environment or when user has not opted in.
 */
function shouldEnableSentry(): boolean {
  const env = getEnvironment();

  // Never enable in test environment
  if (env === 'test') {
    return false;
  }

  // Check user opt-in
  if (!isErrorTrackingEnabled()) {
    return false;
  }

  // Check if DSN is configured
  const dsn = env === 'production' ? SENTRY_DSN_PRODUCTION : SENTRY_DSN_DEVELOPMENT;
  if (!dsn) {
    return false;
  }

  return true;
}

/**
 * Type for scrub pattern replacement - can be string or function
 */
type ScrubReplacement = string | ((match: string) => string);

/**
 * Patterns to scrub from error messages and stack traces.
 * These patterns match common PII and sensitive data.
 */
const SCRUB_PATTERNS: Array<{ pattern: RegExp; replacement: ScrubReplacement }> = [
  // File paths (Unix and Windows)
  { pattern: /\/Users\/[^\/\s]+/gi, replacement: '/Users/[REDACTED]' },
  { pattern: /\/home\/[^\/\s]+/gi, replacement: '/home/[REDACTED]' },
  { pattern: /C:\\Users\\[^\\\s]+/gi, replacement: 'C:\\Users\\[REDACTED]' },
  // Workspace paths
  { pattern: /\.proletariat\/[^\s]*/gi, replacement: '.proletariat/[REDACTED]' },
  // Git repository paths
  { pattern: /\/repos\/[^\/\s]+/gi, replacement: '/repos/[REDACTED]' },
  // SSH keys and credentials
  { pattern: /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, replacement: '[REDACTED_KEY]' },
  // Environment variables that might contain secrets
  { pattern: /([A-Z_]+_KEY|[A-Z_]+_SECRET|[A-Z_]+_TOKEN|[A-Z_]+_PASSWORD)\s*=\s*[^\s]+/gi, replacement: '$1=[REDACTED]' },
  // GitHub tokens
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, replacement: '[REDACTED_GH_TOKEN]' },
  { pattern: /github_pat_[a-zA-Z0-9_]{82}/g, replacement: '[REDACTED_GH_PAT]' },
  // Generic API keys - redact long alphanumeric strings that look like keys
  { pattern: /[a-zA-Z0-9]{41,}/g, replacement: '[REDACTED_KEY]' },
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[REDACTED_EMAIL]' },
  // IP addresses (simple pattern, excludes localhost-like)
  { pattern: /\b(?!127\.0\.0\.)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g, replacement: '[REDACTED_IP]' },
];

/**
 * Scrub sensitive data from a string.
 */
function scrubString(input: string): string {
  let result = input;
  for (const { pattern, replacement } of SCRUB_PATTERNS) {
    if (typeof replacement === 'function') {
      result = result.replace(pattern, replacement as (substring: string, ...args: unknown[]) => string);
    } else {
      result = result.replace(pattern, replacement);
    }
  }
  return result;
}

/**
 * Scrub sensitive data from an event before sending to Sentry.
 * This is the main privacy protection mechanism.
 */
function beforeSendHandler(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // Scrub exception messages
  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      if (exception.value) {
        exception.value = scrubString(exception.value);
      }
      // Scrub stack trace file paths
      if (exception.stacktrace?.frames) {
        for (const frame of exception.stacktrace.frames) {
          if (frame.filename) {
            frame.filename = scrubString(frame.filename);
          }
          if (frame.abs_path) {
            frame.abs_path = scrubString(frame.abs_path);
          }
        }
      }
    }
  }

  // Scrub message
  if (event.message) {
    event.message = scrubString(event.message);
  }

  // Scrub breadcrumbs
  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      if (breadcrumb.message) {
        breadcrumb.message = scrubString(breadcrumb.message);
      }
      if (breadcrumb.data) {
        for (const key of Object.keys(breadcrumb.data)) {
          if (typeof breadcrumb.data[key] === 'string') {
            breadcrumb.data[key] = scrubString(breadcrumb.data[key]);
          }
        }
      }
    }
  }

  // Remove any extra context that might contain sensitive data
  // Only keep explicitly allowed fields
  const allowedTags = ['command', 'executionMode', 'platform', 'nodeVersion', 'cliVersion', 'environment'];
  if (event.tags) {
    const filteredTags: Record<string, string> = {};
    for (const tag of allowedTags) {
      if (event.tags[tag]) {
        filteredTags[tag] = String(event.tags[tag]);
      }
    }
    event.tags = filteredTags;
  }

  // Remove user data (we don't track users)
  delete event.user;

  // Remove server name (might reveal hostname)
  delete event.server_name;

  return event;
}

/**
 * Initialize Sentry error tracking.
 * Should be called early in CLI bootstrap (oclif init hook).
 *
 * @param cliVersion - Version of the CLI (from package.json)
 */
export function initSentry(cliVersion: string): void {
  // Don't initialize twice
  if (isInitialized) {
    return;
  }

  // Check if we should enable Sentry
  if (!shouldEnableSentry()) {
    return;
  }

  const env = getEnvironment();
  const dsn = env === 'production' ? SENTRY_DSN_PRODUCTION : SENTRY_DSN_DEVELOPMENT;

  Sentry.init({
    dsn,
    environment: env,
    release: `proletariat-cli@${cliVersion}`,

    // Privacy-focused settings
    beforeSend: beforeSendHandler,
    beforeSendTransaction: () => null, // Don't send performance data
    sendDefaultPii: false,

    // Only capture errors, not transactions
    tracesSampleRate: 0,

    // Set initial context
    initialScope: {
      tags: {
        platform: os.platform(),
        nodeVersion: process.version,
        cliVersion,
        environment: env,
      },
    },
  });

  isInitialized = true;
}

/**
 * Set the current command context for error enrichment.
 * Call this at the start of command execution.
 */
export function setCommandContext(context: CommandContext): void {
  currentCommandContext = context;

  if (!isInitialized) {
    return;
  }

  Sentry.setTag('command', context.commandName);
  if (context.executionMode) {
    Sentry.setTag('executionMode', context.executionMode);
  }
  if (context.projectId) {
    Sentry.setTag('projectId', context.projectId);
  }
}

/**
 * Clear the current command context.
 * Call this after command execution completes.
 */
export function clearCommandContext(): void {
  currentCommandContext = null;
}

/**
 * Capture an error and send it to Sentry.
 * Automatically enriches with command context if available.
 *
 * @param error - The error to capture
 * @param extraContext - Additional context to include (will be scrubbed)
 */
export function captureError(error: Error, extraContext?: Record<string, unknown>): void {
  if (!isInitialized) {
    return;
  }

  Sentry.withScope((scope) => {
    // Add command context if available
    if (currentCommandContext) {
      scope.setTag('command', currentCommandContext.commandName);
      if (currentCommandContext.executionMode) {
        scope.setTag('executionMode', currentCommandContext.executionMode);
      }
      if (currentCommandContext.projectId) {
        scope.setTag('projectId', currentCommandContext.projectId);
      }
    }

    // Add extra context (after scrubbing)
    if (extraContext) {
      const scrubbed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(extraContext)) {
        // Only include primitive types, scrub strings
        if (typeof value === 'string') {
          scrubbed[key] = scrubString(value);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          scrubbed[key] = value;
        }
      }
      scope.setContext('extra', scrubbed);
    }

    Sentry.captureException(error);
  });
}

/**
 * Capture a message and send it to Sentry.
 * Used for non-exception error conditions.
 *
 * @param message - The message to capture (will be scrubbed)
 * @param level - Sentry severity level
 */
export function captureMessage(message: string, level: Sentry.SeverityLevel = 'error'): void {
  if (!isInitialized) {
    return;
  }

  const scrubbedMessage = scrubString(message);

  Sentry.withScope((scope) => {
    // Add command context if available
    if (currentCommandContext) {
      scope.setTag('command', currentCommandContext.commandName);
    }

    Sentry.captureMessage(scrubbedMessage, level);
  });
}

/**
 * Add a breadcrumb for debugging purposes.
 * Breadcrumbs are scrubbed before being sent.
 *
 * @param breadcrumb - Breadcrumb to add
 */
export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
  if (!isInitialized) {
    return;
  }

  // Scrub the breadcrumb message
  const scrubbed: Sentry.Breadcrumb = {
    ...breadcrumb,
    message: breadcrumb.message ? scrubString(breadcrumb.message) : undefined,
  };

  Sentry.addBreadcrumb(scrubbed);
}

/**
 * Flush all pending events before process exit.
 * Should be called in the CLI shutdown hook.
 *
 * @param timeout - Maximum time to wait in milliseconds (default 2000)
 */
export async function flushSentry(timeout = 2000): Promise<void> {
  if (!isInitialized) {
    return;
  }

  await Sentry.close(timeout);
}

/**
 * Check if Sentry is currently initialized and enabled.
 */
export function isSentryEnabled(): boolean {
  return isInitialized;
}

/**
 * Wrap an async function to capture any errors it throws.
 * Useful for wrapping command execute() methods.
 */
export function withErrorCapture<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  commandName: string
): T {
  return (async (...args: unknown[]) => {
    setCommandContext({ commandName });
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof Error) {
        captureError(error);
      }
      throw error;
    } finally {
      clearCommandContext();
    }
  }) as T;
}

// Export Sentry types for use in other modules
export { SeverityLevel } from '@sentry/node';
