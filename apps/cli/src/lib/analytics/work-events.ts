/**
 * Work Lifecycle Event Tracking
 *
 * Helper functions for tracking work events from execution commands.
 * These are called by work start, work stop, and similar commands.
 */

import Database from 'better-sqlite3'
import { trackWork, isAnalyticsEnabled } from './index.js'
import { WorkEventProperties } from './types.js'
import { AgentWork } from '../execution/types.js'

/**
 * Track when work execution starts
 */
export async function trackWorkStarted(
  db: Database.Database,
  work: Pick<AgentWork, 'executor' | 'environment' | 'displayMode' | 'sandboxed'>
): Promise<void> {
  if (!isAnalyticsEnabled(db)) return

  const properties: WorkEventProperties = {
    executor: work.executor,
    environment: work.environment,
    display_mode: work.displayMode,
    sandboxed: work.sandboxed,
  }

  await trackWork(db, 'work.started', properties)
}

/**
 * Track when work execution completes successfully
 */
export async function trackWorkCompleted(
  db: Database.Database,
  work: Pick<AgentWork, 'executor' | 'environment' | 'displayMode' | 'sandboxed' | 'startedAt' | 'exitCode'>
): Promise<void> {
  if (!isAnalyticsEnabled(db)) return

  const durationMs = Date.now() - work.startedAt.getTime()

  const properties: WorkEventProperties = {
    executor: work.executor,
    environment: work.environment,
    display_mode: work.displayMode,
    sandboxed: work.sandboxed,
    duration_ms: durationMs,
    exit_code: work.exitCode,
  }

  await trackWork(db, 'work.completed', properties)
}

/**
 * Track when work execution fails
 */
export async function trackWorkFailed(
  db: Database.Database,
  work: Pick<AgentWork, 'executor' | 'environment' | 'displayMode' | 'sandboxed' | 'startedAt' | 'exitCode'>
): Promise<void> {
  if (!isAnalyticsEnabled(db)) return

  const durationMs = Date.now() - work.startedAt.getTime()

  const properties: WorkEventProperties = {
    executor: work.executor,
    environment: work.environment,
    display_mode: work.displayMode,
    sandboxed: work.sandboxed,
    duration_ms: durationMs,
    exit_code: work.exitCode,
  }

  await trackWork(db, 'work.failed', properties)
}

/**
 * Track when work execution is stopped manually
 */
export async function trackWorkStopped(
  db: Database.Database,
  work: Pick<AgentWork, 'executor' | 'environment' | 'displayMode' | 'sandboxed' | 'startedAt'>
): Promise<void> {
  if (!isAnalyticsEnabled(db)) return

  const durationMs = Date.now() - work.startedAt.getTime()

  const properties: WorkEventProperties = {
    executor: work.executor,
    environment: work.environment,
    display_mode: work.displayMode,
    sandboxed: work.sandboxed,
    duration_ms: durationMs,
  }

  await trackWork(db, 'work.stopped', properties)
}
