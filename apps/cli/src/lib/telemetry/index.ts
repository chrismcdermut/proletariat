/**
 * Telemetry Module
 *
 * Provides privacy-focused error tracking and analytics for the Proletariat CLI.
 * All telemetry is opt-in and disabled by default.
 *
 * @module telemetry
 */

export {
  initSentry,
  setCommandContext,
  clearCommandContext,
  captureError,
  captureMessage,
  addBreadcrumb,
  flushSentry,
  isSentryEnabled,
  withErrorCapture,
  type CommandContext,
  type SeverityLevel,
} from './sentry.js';
