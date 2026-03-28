/**
 * Jira Integration Types
 *
 * Type definitions for the Jira ↔ PMO integration layer.
 * Supports both Jira Cloud (REST API v3) and Jira Server (REST API v2).
 */

// =============================================================================
// Jira API Types
// =============================================================================

/**
 * Represents a Jira issue as fetched from the API.
 */
export interface JiraIssue {
  id: string
  key: string                  // e.g., "PROJ-123"
  self: string                 // API URL
  fields: {
    summary: string
    description?: string | null
    status: JiraStatus
    priority?: JiraPriority | null
    issuetype: JiraIssueType
    assignee?: JiraUser | null
    reporter?: JiraUser | null
    labels: string[]
    project: JiraProject
    created: string            // ISO date
    updated: string            // ISO date
    comment?: {
      comments: JiraComment[]
      total: number
    }
  }
}

/**
 * Jira status object.
 */
export interface JiraStatus {
  id: string
  name: string
  statusCategory: JiraStatusCategory
}

/**
 * Jira status category — the semantic grouping for statuses.
 * Jira has exactly 3 categories: "new", "indeterminate", "done".
 */
export interface JiraStatusCategory {
  id: number
  key: string                  // 'new' | 'indeterminate' | 'done'
  name: string
  colorName: string
}

/**
 * Jira priority object.
 */
export interface JiraPriority {
  id: string
  name: string                 // e.g., "Highest", "High", "Medium", "Low", "Lowest"
  iconUrl?: string
}

/**
 * Jira issue type.
 */
export interface JiraIssueType {
  id: string
  name: string                 // e.g., "Story", "Task", "Bug", "Epic"
  subtask: boolean
}

/**
 * Jira project.
 */
export interface JiraProject {
  id: string
  key: string                  // e.g., "PROJ"
  name: string
  self: string
}

/**
 * Jira user.
 */
export interface JiraUser {
  accountId?: string           // Cloud
  key?: string                 // Server
  name?: string                // Server
  emailAddress?: string
  displayName: string
  active: boolean
}

/**
 * Jira comment.
 */
export interface JiraComment {
  id: string
  body: string
  author: JiraUser
  created: string
  updated: string
}

/**
 * Jira transition — available status changes for an issue.
 */
export interface JiraTransition {
  id: string
  name: string
  to: JiraStatus
  isAvailable?: boolean
}

// =============================================================================
// Priority Mapping
// =============================================================================

/**
 * Map PMO priority (P0-P3) to Jira priority name.
 * Jira Cloud default priorities: Highest, High, Medium, Low, Lowest.
 */
export const PMO_PRIORITY_TO_JIRA: Record<string, string> = {
  P0: 'Highest',    // Critical → Highest
  P1: 'High',       // High → High
  P2: 'Medium',     // Medium → Medium
  P3: 'Low',        // Low → Low
}

/**
 * Map Jira priority name to PMO priority (P0-P3).
 * Handles common Jira priority names (case-insensitive matching done at runtime).
 */
export const JIRA_PRIORITY_TO_PMO: Record<string, string> = {
  Highest: 'P0',
  Urgent: 'P0',
  Critical: 'P0',
  Blocker: 'P0',
  High: 'P1',
  Medium: 'P2',
  Normal: 'P2',
  Low: 'P3',
  Lowest: 'P3',
  Minor: 'P3',
  Trivial: 'P3',
}

/**
 * Map Jira status category key to PMO state category.
 */
export const JIRA_STATUS_CATEGORY_TO_PMO: Record<string, string> = {
  new: 'unstarted',
  indeterminate: 'started',
  done: 'completed',
}
