/**
 * Provider Trigger Configuration
 *
 * Configurable triggers that map work lifecycle events to automatic
 * column/status transitions. When a trigger event fires, the system
 * automatically moves the affected ticket to the configured target status.
 *
 * Supported trigger events:
 * - agent_started: An agent begins working on a ticket
 * - pr_created: A pull request is created or linked
 * - pr_merged: A pull request is merged
 * - tests_passed: Tests pass for the work item
 * - work_completed: Work on the item is marked complete
 *
 * Triggers can be scoped per provider (or '*' for all providers)
 * and per project (or null for all projects).
 *
 * Example:
 *   trigger_event: 'pr_created', target_status: 'Review'
 *   → When a PR is created, move the ticket to "Review"
 *
 *   trigger_event: 'pr_merged', target_status: 'Done'
 *   → When a PR is merged, move the ticket to "Done"
 */

import type Database from 'better-sqlite3'
import { getEventBus } from '../events/event-bus.js'

/**
 * Valid trigger event names that can be configured.
 */
export type TriggerEvent =
  | 'agent_started'
  | 'pr_created'
  | 'pr_merged'
  | 'tests_passed'
  | 'work_completed'

export const TRIGGER_EVENTS: readonly TriggerEvent[] = [
  'agent_started',
  'pr_created',
  'pr_merged',
  'tests_passed',
  'work_completed',
]

export interface TriggerConfig {
  id?: number
  provider: string
  triggerEvent: TriggerEvent
  targetStatus: string
  projectId: string | null
  enabled: boolean
}

/**
 * ProviderTriggerStore manages the pmo_provider_triggers table.
 * Provides CRUD operations for configurable triggers.
 */
export class ProviderTriggerStore {
  constructor(private db: Database.Database) {}

  /**
   * Get all triggers for a specific event, optionally filtered by provider and project.
   */
  getTriggersForEvent(
    triggerEvent: TriggerEvent,
    provider?: string,
    projectId?: string | null,
  ): TriggerConfig[] {
    try {
      const rows = this.db.prepare(`
        SELECT id, provider, trigger_event, target_status, project_id, enabled
        FROM pmo_provider_triggers
        WHERE trigger_event = ?
          AND enabled = 1
          AND (provider = '*' OR provider = ?)
          AND (project_id IS NULL OR project_id = ?)
        ORDER BY
          CASE WHEN provider != '*' THEN 0 ELSE 1 END,
          CASE WHEN project_id IS NOT NULL THEN 0 ELSE 1 END
      `).all(triggerEvent, provider ?? '*', projectId ?? null) as Array<{
        id: number
        provider: string
        trigger_event: string
        target_status: string
        project_id: string | null
        enabled: number
      }>

      return rows.map(row => ({
        id: row.id,
        provider: row.provider,
        triggerEvent: row.trigger_event as TriggerEvent,
        targetStatus: row.target_status,
        projectId: row.project_id,
        enabled: row.enabled === 1,
      }))
    } catch {
      return []
    }
  }

  /**
   * List all configured triggers.
   */
  listTriggers(): TriggerConfig[] {
    try {
      const rows = this.db.prepare(`
        SELECT id, provider, trigger_event, target_status, project_id, enabled
        FROM pmo_provider_triggers
        ORDER BY trigger_event, provider
      `).all() as Array<{
        id: number
        provider: string
        trigger_event: string
        target_status: string
        project_id: string | null
        enabled: number
      }>

      return rows.map(row => ({
        id: row.id,
        provider: row.provider,
        triggerEvent: row.trigger_event as TriggerEvent,
        targetStatus: row.target_status,
        projectId: row.project_id,
        enabled: row.enabled === 1,
      }))
    } catch {
      return []
    }
  }

  /**
   * Add or update a trigger configuration.
   */
  upsertTrigger(config: TriggerConfig): void {
    this.db.prepare(`
      INSERT INTO pmo_provider_triggers (provider, trigger_event, target_status, project_id, enabled)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(provider, trigger_event, project_id) DO UPDATE SET
        target_status = excluded.target_status,
        enabled = excluded.enabled
    `).run(
      config.provider,
      config.triggerEvent,
      config.targetStatus,
      config.projectId,
      config.enabled ? 1 : 0,
    )
  }

  /**
   * Remove a trigger by ID.
   */
  removeTrigger(id: number): void {
    this.db.prepare('DELETE FROM pmo_provider_triggers WHERE id = ?').run(id)
  }

  /**
   * Enable or disable a trigger.
   */
  setEnabled(id: number, enabled: boolean): void {
    this.db.prepare('UPDATE pmo_provider_triggers SET enabled = ? WHERE id = ?').run(
      enabled ? 1 : 0,
      id,
    )
  }
}

/**
 * TriggerHandler subscribes to work-lifecycle events on the EventBus
 * and automatically transitions tickets based on configured triggers.
 */
export class TriggerHandler {
  private unsubscribers: Array<() => void> = []
  private store: ProviderTriggerStore
  private moveTicket: (ticketId: string, projectId: string, targetStatus: string) => Promise<void>

  constructor(
    db: Database.Database,
    moveTicket: (ticketId: string, projectId: string, targetStatus: string) => Promise<void>,
  ) {
    this.store = new ProviderTriggerStore(db)
    this.moveTicket = moveTicket
  }

  /**
   * Start listening for work-lifecycle events and applying triggers.
   */
  start(): void {
    const bus = getEventBus()

    // agent_started trigger: fires on work:started events
    this.unsubscribers.push(
      bus.on('work:started', (event) => {
        void this.applyTrigger('agent_started', event.source, event.workItemId, event.projectId ?? null)
      }),
    )

    // pr_created trigger: fires on work:pr_created events
    this.unsubscribers.push(
      bus.on('work:pr_created', (event) => {
        void this.applyTrigger('pr_created', event.source, event.workItemId, event.projectId ?? null)
      }),
    )

    // pr_merged trigger: fires on work:pr_merged events
    this.unsubscribers.push(
      bus.on('work:pr_merged', (event) => {
        void this.applyTrigger('pr_merged', event.source, event.workItemId, event.projectId ?? null)
      }),
    )

    // work_completed trigger: fires on work:completed events
    this.unsubscribers.push(
      bus.on('work:completed', (event) => {
        void this.applyTrigger('work_completed', event.source, event.workItemId, event.projectId ?? null)
      }),
    )
  }

  /**
   * Stop listening for events.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
  }

  /**
   * Apply a trigger: look up configured triggers for the event
   * and move the ticket to the target status if a match is found.
   */
  private async applyTrigger(
    triggerEvent: TriggerEvent,
    source: string,
    workItemId: string,
    projectId: string | null,
  ): Promise<void> {
    const triggers = this.store.getTriggersForEvent(triggerEvent, source, projectId)

    if (triggers.length === 0) return

    // Use the most specific trigger (provider-specific + project-specific first)
    const trigger = triggers[0]

    try {
      await this.moveTicket(workItemId, projectId ?? '', trigger.targetStatus)
    } catch {
      // Trigger application is non-fatal
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _handler: TriggerHandler | undefined

/**
 * Initialize the trigger handler.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initTriggerHandler(
  db: Database.Database,
  moveTicket: (ticketId: string, projectId: string, targetStatus: string) => Promise<void>,
): TriggerHandler {
  if (!_handler) {
    _handler = new TriggerHandler(db, moveTicket)
    _handler.start()
  }
  return _handler
}

/**
 * Stop the trigger handler (primarily for testing).
 */
export function stopTriggerHandler(): void {
  if (_handler) {
    _handler.stop()
    _handler = undefined
  }
}
