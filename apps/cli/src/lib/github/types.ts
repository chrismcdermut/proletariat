/**
 * GitHub Issues Integration Types
 *
 * Type definitions for the GitHub Issues + Projects v2 integration.
 * Uses labels for state mapping and open/closed for terminal states.
 */

// =============================================================================
// GitHub API Types
// =============================================================================

/**
 * Represents a GitHub issue as returned by the REST API.
 */
export interface GitHubIssue {
  id: number
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  labels: GitHubLabel[]
  assignee: GitHubUser | null
  assignees: GitHubUser[]
  milestone: GitHubMilestone | null
  html_url: string
  created_at: string
  updated_at: string
  closed_at: string | null
}

export interface GitHubLabel {
  id: number
  name: string
  color: string
  description: string | null
}

export interface GitHubUser {
  id: number
  login: string
  avatar_url: string
  html_url: string
}

export interface GitHubMilestone {
  id: number
  number: number
  title: string
  state: 'open' | 'closed'
}

export interface GitHubRepo {
  id: number
  name: string
  full_name: string
  owner: GitHubUser
  html_url: string
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * GitHub Issues connection configuration stored in workspace_settings.
 */
export interface GitHubConfig {
  token: string
  owner: string
  repo: string
  /** Optional: label prefix for state labels (e.g., "status:") */
  statusLabelPrefix?: string
}

// =============================================================================
// Mapping Types
// =============================================================================

/**
 * Map GitHub issue labels to PMO state categories.
 * These are the default label names that map to PMO categories.
 * Users can customize via the statusLabelPrefix config.
 */
export const GITHUB_LABEL_TO_PMO_CATEGORY: Record<string, string> = {
  'in progress': 'started',
  'in review': 'started',
  'review': 'started',
  'todo': 'unstarted',
  'to do': 'unstarted',
  'backlog': 'backlog',
  'blocked': 'started',
  'done': 'completed',
  'closed': 'completed',
  'wontfix': 'canceled',
  "won't fix": 'canceled',
  'duplicate': 'canceled',
  'invalid': 'canceled',
}

/**
 * Priority mapping between GitHub labels and PMO (P0-P3).
 * GitHub doesn't have native priority — we use label conventions.
 */
export const GITHUB_PRIORITY_LABELS: Record<string, string> = {
  'priority: critical': 'P0',
  'priority: high': 'P1',
  'priority: medium': 'P2',
  'priority: low': 'P3',
  'P0': 'P0',
  'P1': 'P1',
  'P2': 'P2',
  'P3': 'P3',
}

export const PMO_PRIORITY_TO_GITHUB_LABEL: Record<string, string> = {
  P0: 'priority: critical',
  P1: 'priority: high',
  P2: 'priority: medium',
  P3: 'priority: low',
}
