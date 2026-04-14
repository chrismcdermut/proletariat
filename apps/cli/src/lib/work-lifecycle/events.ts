/**
 * Work Lifecycle Event Definitions
 *
 * Provider-agnostic domain events for work item state changes.
 * These events represent what happened in the work lifecycle,
 * regardless of which system (PMO, Linear, GitHub, etc.) reported the change.
 *
 * The adapter layer translates provider-specific events into these
 * domain events, decoupling consumers from any single provider.
 */

import type { StateCategory } from '../pmo/types.js'

/**
 * Sources that can emit work-lifecycle events.
 * PMO is just another provider, not the central hub.
 */
export type WorkEventSource = 'pmo' | 'linear' | 'github' | 'jira' | 'asana' | 'shortcut' | 'trello' | 'monday' | 'clickup' | 'notion'

/** Emitted when work begins on a work item (status moved to 'started' category). */
export interface WorkStartedEvent {
  workItemId: string
  source: WorkEventSource
  projectId?: string
  status: string | null
  timestamp: Date
}

/** Emitted when a work item's status changes. */
export interface WorkStatusChangedEvent {
  workItemId: string
  source: WorkEventSource
  projectId?: string
  previousStatus: string | null
  previousCategory: StateCategory | null
  newStatus: string | null
  newCategory: StateCategory | null
  timestamp: Date
}

/** Emitted when a PR is created or linked for a work item. */
export interface WorkPRCreatedEvent {
  workItemId: string
  source: WorkEventSource
  projectId?: string
  prUrl: string
  prTitle: string | null
  timestamp: Date
}

/** Emitted when a PR linked to a work item is merged. */
export interface WorkPRMergedEvent {
  workItemId: string
  source: WorkEventSource
  projectId?: string
  prNumber: number
  prTitle: string | null
  prUrl: string | null
  mergeMethod: string
  timestamp: Date
}

/** Emitted when a PR linked to a work item is closed (without merging). */
export interface WorkPRClosedEvent {
  workItemId: string
  source: WorkEventSource
  projectId?: string
  prNumber: number
  prTitle: string | null
  prUrl: string | null
  comment?: string
  timestamp: Date
}

/** Emitted when work on an item is completed (status moved to 'completed' category). */
export interface WorkCompletedEvent {
  workItemId: string
  source: WorkEventSource
  projectId?: string
  status: string | null
  timestamp: Date
}
