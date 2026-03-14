/**
 * Linear Integration Types
 *
 * Type definitions for the Linear ↔ PMO integration layer.
 */

// =============================================================================
// Linear API Types
// =============================================================================

/**
 * Represents a Linear issue as fetched from the API.
 */
export interface LinearIssue {
  id: string
  identifier: string        // e.g., "ENG-123"
  title: string
  description?: string
  priority: number           // 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
  state: {
    id: string
    name: string
    type: string             // 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | 'triage'
  }
  team: {
    id: string
    key: string              // e.g., "ENG"
    name: string
  }
  assignee?: {
    id: string
    name: string
    email: string
  }
  labels: Array<{
    id: string
    name: string
    color: string
  }>
  cycle?: {
    id: string
    name: string
    number: number
  }
  project?: {
    id: string
    name: string
  }
  estimate?: number
  dueDate?: string
  url: string
  createdAt: string
  updatedAt: string
}

/**
 * Represents a Linear team (workspace organizational unit).
 */
export interface LinearTeam {
  id: string
  key: string
  name: string
  description?: string
}

/**
 * Represents a Linear workflow state.
 */
export interface LinearWorkflowState {
  id: string
  name: string
  type: string               // 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | 'triage'
  color: string
  position: number
}

/**
 * Represents a Linear cycle (sprint).
 */
export interface LinearCycle {
  id: string
  name: string
  number: number
  startsAt: string
  endsAt: string
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Linear connection configuration stored in workspace_settings.
 */
export interface LinearConfig {
  apiKey: string
  defaultTeamId?: string
  defaultTeamKey?: string
  organizationName?: string
}

// =============================================================================
// Filter Types
// =============================================================================

/**
 * Filters for querying Linear issues.
 */
export interface LinearIssueFilter {
  teamId?: string
  teamKey?: string
  stateType?: string          // Filter by state type
  stateName?: string          // Filter by state name
  assigneeId?: string         // Filter by assignee user ID
  assigneeMe?: boolean        // Filter by current authenticated user
  labelName?: string
  cycleId?: string
  projectId?: string
  search?: string
  limit?: number
}

// =============================================================================
// Mapping Types
// =============================================================================

/**
 * Mapping record between a Linear issue and a PMO ticket.
 * Stored in pmo_external_issue_map table (provider = 'linear').
 */
export interface LinearIssueMap {
  pmoTicketId: string
  linearIssueId: string
  linearIdentifier: string     // e.g., "ENG-123"
  linearTeamKey: string
  linearUrl: string
  syncDirection: 'inbound' | 'outbound' | 'bidirectional'
  lastSyncedAt?: Date
  createdAt: Date
}

// =============================================================================
// Sync Types
// =============================================================================

/**
 * Result of a sync operation.
 */
export interface LinearSyncResult {
  imported: number
  updated: number
  skipped: number
  errors: Array<{
    identifier: string
    error: string
  }>
}

/**
 * Status mapping between Linear state types and PMO state categories.
 */
export const LINEAR_STATE_TO_PMO_CATEGORY: Record<string, string> = {
  triage: 'triage',
  backlog: 'backlog',
  unstarted: 'unstarted',
  started: 'started',
  completed: 'completed',
  canceled: 'canceled',
}

/**
 * Priority mapping between Linear (1-4) and PMO (P0-P3).
 * Linear: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
 * PMO: P0=Critical, P1=High, P2=Medium, P3=Low
 */
export const LINEAR_PRIORITY_TO_PMO: Record<number, string> = {
  0: 'P3',   // No priority → Low
  1: 'P0',   // Urgent → Critical
  2: 'P1',   // High → High
  3: 'P2',   // Medium → Medium
  4: 'P3',   // Low → Low
}

export const PMO_PRIORITY_TO_LINEAR: Record<string, number> = {
  P0: 1,     // Critical → Urgent
  P1: 2,     // High → High
  P2: 3,     // Medium → Medium
  P3: 4,     // Low → Low
}
