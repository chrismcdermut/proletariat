/**
 * ReconcileService
 *
 * Service wrapper around the Tier 2 State Reconciler.
 * The reconciler is a safety net that fixes board drift when Tier 1
 * (event-driven hooks) misses a state transition.
 *
 * The core logic lives in lib/reconcile/ — this service provides a clean
 * interface for CLI commands, web routes, and the LLM orchestrator.
 */

import type Database from 'better-sqlite3'
import type { PMOStorage } from '../lib/pmo/types.js'
import type { ProviderStorage } from '../lib/providers/types.js'
import { runReconcile, watchReconcile } from '../lib/reconcile/index.js'
import type { ReconcileReport } from '../lib/reconcile/types.js'
import { ServiceError } from './types.js'
import type { RunReconcileOptions, WatchReconcileOptions } from './types.js'

export class ReconcileService {
  constructor(
    private readonly db: Database.Database,
    private readonly storage: PMOStorage & ProviderStorage,
  ) {}

  /**
   * Run a single reconciliation cycle.
   *
   * Scans non-terminal tickets, finds linked PRs, derives expected state
   * from PR state, and applies transitions through the provider adapter.
   */
  async runOnce(options: RunReconcileOptions = {}): Promise<ReconcileReport> {
    try {
      return await runReconcile(this.db, this.storage, {
        dryRun: options.dryRun,
        projectId: options.projectId,
        cwd: options.cwd,
        log: options.log,
        escalateTo: options.escalateTo,
        cooldownMinutes: options.cooldownMinutes,
        escalationThresholds: options.escalationThresholds,
        listRunningExecutions: options.listRunningExecutions,
      })
    } catch (error) {
      throw new ServiceError(
        'INTERNAL',
        `Reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }

  /**
   * Run a dry-run reconciliation — compute transitions without applying them.
   */
  async dryRun(options: Omit<RunReconcileOptions, 'dryRun'> = {}): Promise<ReconcileReport> {
    return this.runOnce({ ...options, dryRun: true })
  }

  /**
   * Run reconciliation in a loop with a configurable interval.
   * The loop runs until shouldStop() returns true.
   */
  async watch(options: WatchReconcileOptions = {}): Promise<void> {
    try {
      await watchReconcile(this.db, this.storage, {
        dryRun: options.dryRun,
        projectId: options.projectId,
        cwd: options.cwd,
        log: options.log,
        intervalMs: options.intervalMs,
        shouldStop: options.shouldStop,
        onCycle: options.onCycle,
        escalateTo: options.escalateTo,
        cooldownMinutes: options.cooldownMinutes,
        escalationThresholds: options.escalationThresholds,
        listRunningExecutions: options.listRunningExecutions,
      })
    } catch (error) {
      throw new ServiceError(
        'INTERNAL',
        `Reconcile watch failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }
}
