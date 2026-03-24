/**
 * ClickUp Integration Types
 *
 * Type definitions for the ClickUp ↔ PMO integration layer.
 */

// =============================================================================
// ClickUp API Types
// =============================================================================

/**
 * Represents a ClickUp task as fetched from the API.
 */
export interface ClickUpTask {
  id: string
  custom_id: string | null
  name: string
  description: string | null
  status: {
    id: string
    status: string          // Status name (e.g., "open", "in progress", "closed")
    type: string            // 'open' | 'custom' | 'closed'
    color: string
  }
  priority: {
    id: string
    priority: string        // 'urgent' | 'high' | 'normal' | 'low'
    color: string
  } | null
  assignees: Array<{
    id: number
    username: string
    email: string
    profilePicture: string | null
  }>
  tags: Array<{
    name: string
    tag_fg: string
    tag_bg: string
  }>
  list: {
    id: string
    name: string
  }
  folder: {
    id: string
    name: string
  }
  space: {
    id: string
  }
  url: string
  date_created: string     // Unix timestamp in ms
  date_updated: string     // Unix timestamp in ms
}

/**
 * Represents a ClickUp status in a list/space.
 */
export interface ClickUpStatus {
  id: string
  status: string
  type: string             // 'open' | 'custom' | 'closed'
  color: string
  orderindex: number
}

/**
 * Represents a ClickUp space.
 */
export interface ClickUpSpace {
  id: string
  name: string
  statuses: ClickUpStatus[]
}

/**
 * Represents a ClickUp list.
 */
export interface ClickUpList {
  id: string
  name: string
  statuses: ClickUpStatus[]
  folder: {
    id: string
    name: string
  }
  space: {
    id: string
    name: string
  }
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * ClickUp connection configuration stored in workspace_settings.
 */
export interface ClickUpConfig {
  apiKey: string
  defaultListId?: string
  defaultListName?: string
  workspaceName?: string
}

// =============================================================================
// Mapping Types
// =============================================================================

/**
 * Priority mapping between ClickUp and PMO (P0-P3).
 * ClickUp: 1=Urgent, 2=High, 3=Normal, 4=Low
 * PMO: P0=Critical, P1=High, P2=Medium, P3=Low
 */
export const CLICKUP_PRIORITY_TO_PMO: Record<string, string> = {
  '1': 'P0',   // Urgent → Critical
  '2': 'P1',   // High → High
  '3': 'P2',   // Normal → Medium
  '4': 'P3',   // Low → Low
}

export const PMO_PRIORITY_TO_CLICKUP: Record<string, number> = {
  P0: 1,     // Critical → Urgent
  P1: 2,     // High → High
  P2: 3,     // Medium → Normal
  P3: 4,     // Low → Low
}

/**
 * Map ClickUp status type to PMO state category.
 */
export const CLICKUP_STATUS_TYPE_TO_PMO_CATEGORY: Record<string, string> = {
  open: 'unstarted',
  custom: 'started',
  closed: 'completed',
}
