/**
 * External Issue Adapter Types
 *
 * Canonical types for normalizing issues from external sources
 * (Linear and Jira) into a shared IssueEnvelope format
 * that can be mapped to spawn context.
 */

// =============================================================================
// Source Types
// =============================================================================

/**
 * Supported external issue sources.
 *
 */
export type IssueSource = 'linear' | 'jira' | 'asana' | 'shortcut' | 'trello' | 'clickup'

/**
 * All valid issue sources as a const array.
 */
export const ISSUE_SOURCES = ['linear', 'jira', 'asana', 'shortcut', 'trello', 'clickup'] as const

/**
 * Providers supported by the external execution mapping store.
 */
export type ExternalMappingProvider = 'linear' | 'jira' | 'shortcut' | 'asana' | 'trello' | 'monday' | 'clickup' | 'pmo'

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
  normalize(raw: unknown): IssueEnvelope

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

/**
 * Provider-agnostic external issue ↔ execution mapping record.
 */
export interface ExternalExecutionMapping {
  provider: ExternalMappingProvider
  externalId: string
  externalKey: string | null
  canonicalUrl: string | null
  latestStateSnapshot: Record<string, unknown> | null
  executionIds: string[]
  prUrls: string[]
  lastSyncedAt: Date | null
  lastSpawnedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Upsert payload for provider-agnostic external issue mapping.
 */
export interface UpsertExternalExecutionMappingInput {
  provider: ExternalMappingProvider
  externalId: string
  externalKey?: string | null
  canonicalUrl?: string | null
  latestStateSnapshot?: Record<string, unknown> | null
  executionId?: string
  prUrl?: string
  lastSyncedAt?: Date
  lastSpawnedAt?: Date
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

// =============================================================================
// Adapter-level Error
// =============================================================================

/**
 * Error codes for adapter-level operations (config, auth, payload, request).
 */
export type ExternalIssueAdapterErrorCode =
  | 'MISSING_CONFIG'
  | 'AUTH_FAILED'
  | 'BAD_PAYLOAD'
  | 'REQUEST_FAILED'
  | 'RATE_LIMITED'

/**
 * Typed error for external issue adapter operations.
 *
 * Covers config, auth, payload, and request failures that occur
 * when interacting with a specific external issue source.
 */
export class ExternalIssueAdapterError extends Error {
  constructor(
    public readonly code: ExternalIssueAdapterErrorCode,
    message: string,
    public readonly causeDetail?: unknown,
  ) {
    super(message)
    this.name = 'ExternalIssueAdapterError'
  }
}

// =============================================================================
// Normalized Issue Envelope (PMO-ready)
// =============================================================================

/**
 * Source metadata nested object for traceability.
 */
export interface IssueSourceMetadata {
  /** Which external system the issue came from */
  name: IssueSource

  /** Unique identifier in the external system (e.g., Linear UUID) */
  externalId: string

  /** Human-readable key in the external system (e.g., "ENG-123") */
  externalKey: string

  /** URL to view the issue in the external system */
  url: string

  /** Original raw payload from the external system */
  raw: Record<string, unknown>
}

/**
 * PMO-ready normalized issue envelope.
 *
 * Wraps a canonical IssueEnvelope with PMO-oriented fields (e.g., category)
 * and a nested source metadata object for ergonomic access in commands.
 *
 * Produced by normalizing an IssueEnvelope into the shape expected by
 * PMO ticket creation and the spawn context pipeline.
 */
export interface NormalizedIssueEnvelope {
  /** Nested source metadata for traceability */
  source: IssueSourceMetadata

  /** Issue title / summary */
  title: string

  /** Issue description (markdown or plain text) */
  description: string

  /** Labels / tags applied to the issue */
  labels: string[]

  /** Priority level (normalized to P0-P3 scale, or null) */
  priority: string | null

  /** Current status name in the external system */
  status: string

  /** Project key in the external system */
  projectKey: string

  /** Assignee display name or identifier */
  assignee: string | null

  /** PMO ticket category derived from source metadata (e.g., "feature") */
  category: string | null

  /** Source-native work item kind when available */
  itemType?: string | null
}

/**
 * Convert a canonical IssueEnvelope to a NormalizedIssueEnvelope.
 *
 * Deterministic: same input always produces same output.
 */
export function toNormalizedEnvelope(
  envelope: IssueEnvelope,
  category?: string | null,
): NormalizedIssueEnvelope {
  return {
    source: {
      name: envelope.source,
      externalId: envelope.external_id,
      externalKey: envelope.external_key,
      url: envelope.url,
      raw: envelope.raw,
    },
    title: envelope.title,
    description: envelope.description,
    labels: envelope.labels,
    priority: envelope.priority,
    status: envelope.status,
    projectKey: envelope.project_key,
    assignee: envelope.assignee,
    category: category ?? null,
    itemType: envelope.item_type ?? null,
  }
}
