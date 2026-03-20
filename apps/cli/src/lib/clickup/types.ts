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
  description: string
  status: {
    status: string
    type: string         // 'open' | 'custom' | 'closed' | 'done'
    orderindex: number
  }
  priority: {
    id: string
    priority: string     // 'urgent' | 'high' | 'normal' | 'low'
    color: string
    orderindex: string
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
  date_created: string
  date_updated: string
  due_date: string | null
}

/**
 * Represents a ClickUp workspace (team).
 */
export interface ClickUpWorkspace {
  id: string
  name: string
  color: string
  avatar: string | null
  members: Array<{
    user: {
      id: number
      username: string
      email: string
    }
  }>
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
  space: {
    id: string
    name: string
  }
  folder: {
    id: string
    name: string
  }
  statuses: ClickUpStatus[]
}

/**
 * Represents a ClickUp status.
 */
export interface ClickUpStatus {
  status: string
  type: string           // 'open' | 'custom' | 'closed' | 'done'
  orderindex: number
  color: string
}

/**
 * Represents a ClickUp folder.
 */
export interface ClickUpFolder {
  id: string
  name: string
  lists: ClickUpList[]
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * ClickUp connection configuration stored in workspace_settings.
 */
export interface ClickUpConfig {
  apiKey: string
  workspaceId?: string
  workspaceName?: string
  spaceId?: string
  spaceName?: string
}

// =============================================================================
// Mapping Types
// =============================================================================

/**
 * Mapping record between a ClickUp task and a PMO ticket.
 */
export interface ClickUpTaskMap {
  pmoTicketId: string
  clickupTaskId: string
  clickupListId: string
  clickupSpaceId?: string
  syncDirection: 'inbound' | 'outbound' | 'bidirectional'
  lastSyncedAt?: Date
  createdAt: Date
}

// =============================================================================
// Priority Mapping
// =============================================================================

/**
 * ClickUp priority IDs to PMO priority mapping.
 * ClickUp: 1=Urgent, 2=High, 3=Normal, 4=Low (null=No priority)
 * PMO: P0=Critical, P1=High, P2=Medium, P3=Low
 */
export const CLICKUP_PRIORITY_TO_PMO: Record<string, string> = {
  '1': 'P0',     // Urgent → Critical
  '2': 'P1',     // High → High
  '3': 'P2',     // Normal → Medium
  '4': 'P3',     // Low → Low
}

export const PMO_PRIORITY_TO_CLICKUP: Record<string, number> = {
  P0: 1,     // Critical → Urgent
  P1: 2,     // High → High
  P2: 3,     // Medium → Normal
  P3: 4,     // Low → Low
}

/**
 * ClickUp status type to PMO state category mapping.
 */
export const CLICKUP_STATUS_TYPE_TO_PMO_CATEGORY: Record<string, string> = {
  open: 'backlog',
  custom: 'started',
  closed: 'completed',
  done: 'completed',
}
