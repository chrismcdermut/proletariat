/**
 * External Issue Adapter Types
 *
 * Canonical types for normalizing issues from external sources
 * (Linear, Jira, and planned providers) into a shared IssueEnvelope format
 * that can be mapped to spawn context.
 */

// =============================================================================
// Source Types
// =============================================================================

/**
 * Supported external issue sources.
 *
 * Includes currently supported providers (Linear, Jira) and the
 * near-term adapter targets (Monday, Asana, Basecamp).
 */
export type IssueSource = 'linear' | 'jira' | 'monday' | 'asana' | 'basecamp'

/**
 * All valid issue sources as a const array.
 */
export const ISSUE_SOURCES = ['linear', 'jira', 'monday', 'asana', 'basecamp'] as const

// =============================================================================
// IssueEnvelope - Canonical External Issue Format
// =============================================================================

/**
 * Canonical envelope for external issues/work items.
 *
 * Normalizes issues from different sources into a shared structure that can be
 * deterministically mapped to spawn context.
 *
 * Source-specific fields are preserved in the `raw` payload.
 */
export interface IssueEnvelope {
  /** Which external system this issue came from */
  source: IssueSource

  /** Unique identifier in the external system (e.g., Linear UUID, Jira issue ID) */
  external_id: string

  /** Human-readable key in the external system (e.g., "ENG-123", "PROJ-456") */
  external_key: string

  /** Issue title / summary */
  title: string

  /** Issue description (markdown or plain text) */
  description: string

  /** Labels / tags applied to the issue */
  labels: string[]

  /** Priority level (normalized to P0-P3 scale) */
  priority: string | null

  /** Current status name in the external system */
  status: string

  /** URL to view the issue in the external system */
  url: string

  /** Project key or identifier in the external system */
  project_key: string

  /** Assignee display name or identifier */
  assignee: string | null

  /**
   * Source-native work item kind when available (e.g., issue, ticket, task).
   * Optional to preserve compatibility with adapters that do not expose a
   * stable item kind.
   */
  item_type?: string | null

  /** Original source-specific payload (preserved for source-specific logic) */
  raw: Record<string, unknown>
}

// =============================================================================
// Spawn Context Mapping
// =============================================================================

/**
 * Metadata derived from an IssueEnvelope for spawn context.
 * Used to populate ExecutionContext fields when spawning agent work
 * from an external issue.
 */
export interface IssueSpawnContext {
  /** Prompt text generated from the issue for the agent */
  prompt: string

  /** Metadata key-value pairs to attach to the ticket */
  metadata: Record<string, string>
}

// =============================================================================
// Validation Error Types
// =============================================================================

/**
 * Error codes for issue envelope validation failures.
 */
export type IssueValidationErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_SOURCE'
  | 'INVALID_FIELD_TYPE'
  | 'EMPTY_FIELD'

/**
 * Structured validation error for issue envelope fields.
 */
export interface IssueValidationError {
  /** Machine-readable error code */
  code: IssueValidationErrorCode

  /** The field that failed validation */
  field: string

  /** Human-readable error message */
  message: string
}

/**
 * Result of validating an issue envelope.
 */
export type IssueValidationResult =
  | { valid: true; envelope: IssueEnvelope }
  | { valid: false; errors: IssueValidationError[] }

// =============================================================================
// External Issue Adapter Contract
// =============================================================================

/**
 * Contract for external issue source adapters.
 *
 * Both Linear and Jira adapters must implement this interface to normalize
 * their issues into the shared IssueEnvelope format.
 *
 * Adapters are responsible for:
 * 1. Fetching issues from their source API
 * 2. Normalizing source-specific data into IssueEnvelope format
 * 3. Preserving source-specific fields in the `raw` payload
 */
export interface ExternalIssueAdapter {
  /** Which source this adapter handles */
  readonly source: IssueSource

  /**
   * Normalize a raw API response into an IssueEnvelope.
   *
   * @param raw - Raw issue data from the source API
   * @returns Validated IssueEnvelope
   * @throws ExternalIssueError if the raw data cannot be normalized
   */
  normalize(raw: Record<string, unknown>): IssueEnvelope

  /**
   * Fetch and normalize a single issue by its external key.
   *
   * @param key - External issue key (e.g., "ENG-123" for Linear, "PROJ-456" for Jira)
   * @returns Normalized IssueEnvelope
   * @throws ExternalIssueError if the issue cannot be fetched or normalized
   */
  fetchByKey(key: string): Promise<IssueEnvelope>

  /**
   * Fetch and normalize multiple issues matching a query.
   *
   * @param query - Source-specific query parameters
   * @returns Array of normalized IssueEnvelopes
   * @throws ExternalIssueError if the query fails
   */
  fetchByQuery(query: Record<string, unknown>): Promise<IssueEnvelope[]>
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for external issue operations.
 */
export type ExternalIssueErrorCode =
  | 'VALIDATION_FAILED'
  | 'FETCH_FAILED'
  | 'NORMALIZE_FAILED'
  | 'SOURCE_NOT_SUPPORTED'

/**
 * Typed error for external issue operations.
 */
export class ExternalIssueError extends Error {
  constructor(
    public code: ExternalIssueErrorCode,
    message: string,
    public source?: IssueSource,
    public validationErrors?: IssueValidationError[]
  ) {
    super(message)
    this.name = 'ExternalIssueError'
  }
}
