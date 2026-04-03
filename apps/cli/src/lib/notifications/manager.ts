/**
 * Notification Manager
 *
 * Integrates with the EventBus and hook system to dispatch notifications.
 * Subscribes to hookable events, looks up notification rules, and dispatches
 * through configured providers. Manages escalation chains with timeout-based
 * escalation (e.g., Slack first, SMS after 10min, email after 30min).
 */

import type Database from 'better-sqlite3'
import type { RuntimeEventName } from '../events/events.js'
import type {
  NotificationContext,
  NotificationResult,
  ActiveEscalation,
  EscalationStep,
} from './types.js'
import { NotificationStorage } from './storage.js'
import { dispatchNotification } from './dispatcher.js'
import { HOOKABLE_EVENTS } from '../work-lifecycle/hooks/types.js'

// =============================================================================
// Manager
// =============================================================================

export interface NotificationManagerOptions {
  db: Database.Database
  log?: (msg: string) => void
}

export class NotificationManager {
  private storage: NotificationStorage
  private log: (msg: string) => void
  private unsubscribers: Array<() => void> = []
  private activeEscalations = new Map<string, ActiveEscalation>()

  constructor(options: NotificationManagerOptions) {
    this.storage = new NotificationStorage(options.db)
    this.log = options.log ?? (() => {})
  }

  /**
   * Start listening to events on the EventBus.
   * Dynamically imports event-bus to avoid circular dependency at module load.
   */
  async start(): Promise<void> {
    const { getEventBus } = await import('../events/event-bus.js')
    const bus = getEventBus()

    for (const event of HOOKABLE_EVENTS) {
      // Use `any` for the listener callback since event payload types vary
      // and we normalize them into NotificationContext in handleEvent.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unsub = bus.on(event as RuntimeEventName, (payload: any) => {
        void this.handleEvent(event, payload as Record<string, unknown>)
      })
      this.unsubscribers.push(unsub)
    }
  }

  /** Stop listening and clear all escalation timers. */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []

    // Clear all escalation timers
    for (const escalation of this.activeEscalations.values()) {
      if (escalation.timerId) {
        clearTimeout(escalation.timerId)
      }
    }
    this.activeEscalations.clear()
  }

  /**
   * Manually fire a notification for an event.
   * Returns results for all matched rules.
   */
  async fireEvent(event: string, context: NotificationContext): Promise<NotificationResult[]> {
    return this.handleEvent(event, context)
  }

  /**
   * Acknowledge an escalation chain (stops further escalation).
   */
  acknowledgeEscalation(group: string): boolean {
    const escalation = this.activeEscalations.get(group)
    if (!escalation) return false

    escalation.acknowledged = true
    if (escalation.timerId) {
      clearTimeout(escalation.timerId)
    }
    this.activeEscalations.delete(group)
    this.log(`Escalation group "${group}" acknowledged — stopping further escalation`)
    return true
  }

  /** Get active escalation chains. */
  getActiveEscalations(): ActiveEscalation[] {
    return Array.from(this.activeEscalations.values())
  }

  // ─── Internal ─────────────────────────────────────────────────

  private async handleEvent(event: string, rawContext: Record<string, unknown>): Promise<NotificationResult[]> {
    const context = this.normalizeContext(event, rawContext)
    const rulesWithProviders = this.storage.getRulesWithProviders(event)

    if (rulesWithProviders.length === 0) return []

    // Separate immediate rules from escalation rules
    const immediateRules = rulesWithProviders.filter(rp => !rp.rule.escalationGroup)
    const escalationRules = rulesWithProviders.filter(rp => rp.rule.escalationGroup)

    // Dispatch immediate notifications
    const results: NotificationResult[] = []
    for (const { rule, provider } of immediateRules) {
      this.log(`Dispatching ${provider.type} notification via "${provider.name}" for ${event}`)
      const result = await dispatchNotification(provider, context)
      results.push(result)

      if (!result.success) {
        this.log(`Notification failed: ${result.error}`)
      }
    }

    // Start escalation chains
    const escalationGroups = new Map<string, EscalationStep[]>()
    for (const { rule, provider } of escalationRules) {
      const group = rule.escalationGroup!
      if (!escalationGroups.has(group)) {
        escalationGroups.set(group, [])
      }
      escalationGroups.get(group)!.push({
        rule,
        provider,
        delaySeconds: rule.escalationDelaySeconds ?? 0,
      })
    }

    for (const [group, steps] of escalationGroups) {
      // Sort by delay (ascending) so we escalate in order
      steps.sort((a, b) => a.delaySeconds - b.delaySeconds)
      this.startEscalationChain(group, event, context, steps)
    }

    return results
  }

  private startEscalationChain(
    group: string,
    event: string,
    context: NotificationContext,
    steps: EscalationStep[],
  ): void {
    // If there's already an active escalation for this group, skip
    if (this.activeEscalations.has(group)) return

    const escalation: ActiveEscalation = {
      group,
      event,
      context,
      steps,
      currentStep: 0,
      startedAt: Date.now(),
      acknowledged: false,
    }

    this.activeEscalations.set(group, escalation)
    this.log(`Starting escalation chain "${group}" with ${steps.length} step(s)`)

    // Execute the first step immediately if delay is 0
    void this.executeEscalationStep(escalation)
  }

  private async executeEscalationStep(escalation: ActiveEscalation): Promise<void> {
    if (escalation.acknowledged || escalation.currentStep >= escalation.steps.length) {
      this.activeEscalations.delete(escalation.group)
      return
    }

    const step = escalation.steps[escalation.currentStep]
    const elapsed = (Date.now() - escalation.startedAt) / 1000
    const remainingDelay = Math.max(0, step.delaySeconds - elapsed)

    if (remainingDelay > 0) {
      // Schedule this step for later
      escalation.timerId = setTimeout(() => {
        void this.executeEscalationStep(escalation)
      }, remainingDelay * 1000)
      return
    }

    // Execute this step now
    this.log(`Escalation "${escalation.group}" step ${escalation.currentStep + 1}/${escalation.steps.length}: ${step.provider.type} via "${step.provider.name}"`)
    await dispatchNotification(step.provider, escalation.context)

    escalation.currentStep++

    // Schedule next step if available
    if (escalation.currentStep < escalation.steps.length) {
      const nextStep = escalation.steps[escalation.currentStep]
      const nextElapsed = (Date.now() - escalation.startedAt) / 1000
      const nextDelay = Math.max(0, nextStep.delaySeconds - nextElapsed)

      escalation.timerId = setTimeout(() => {
        void this.executeEscalationStep(escalation)
      }, nextDelay * 1000)
    } else {
      this.activeEscalations.delete(escalation.group)
    }
  }

  private normalizeContext(event: string, raw: Record<string, unknown>): NotificationContext {
    return {
      event,
      ticket: raw.ticket as string | undefined ?? raw.ticketId as string | undefined,
      pr: raw.pr as number | undefined ?? raw.prNumber as number | undefined,
      branch: raw.branch as string | undefined,
      agent: raw.agent as string | undefined ?? raw.sessionId as string | undefined,
      container: raw.container as string | undefined,
      message: raw.message as string | undefined,
      ...raw,
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _instance: NotificationManager | null = null

export function initNotificationManager(options: NotificationManagerOptions): NotificationManager {
  if (_instance) {
    _instance.stop()
  }
  _instance = new NotificationManager(options)
  return _instance
}

export function getNotificationManager(): NotificationManager | null {
  return _instance
}

export function stopNotificationManager(): void {
  if (_instance) {
    _instance.stop()
    _instance = null
  }
}
