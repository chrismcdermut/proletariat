/**
 * External Issue Adapter Module
 *
 * Shared contract for normalizing external issues (Linear, Jira) into
 * a canonical IssueEnvelope format with deterministic spawn context mapping.
 */

// Types and interfaces
export {
  type IssueSource,
  type IssueEnvelope,
  type IssueSpawnContext,
  type IssueValidationError,
  type IssueValidationErrorCode,
  type IssueValidationResult,
  type ExternalIssueAdapter,
  type ExternalIssueErrorCode,
  type ExternalIssueAdapterErrorCode,
  type NormalizedIssueEnvelope,
  type IssueSourceMetadata,
  ISSUE_SOURCES,
  ExternalIssueError,
  ExternalIssueAdapterError,
  toNormalizedEnvelope,
} from './types.js'

// Validation
export {
  validateIssueEnvelope,
  validateOrThrow,
} from './validation.js'

// Mapper
export {
  mapToSpawnContext,
} from './mapper.js'

// Adapters
export {
  LinearIssueAdapter,
  JiraIssueAdapter,
} from './adapters.js'

// Source helpers
export {
  normalizeJiraIssue,
  normalizeJiraIssueToEnvelope,
  buildJiraTicketDescription,
  buildJiraMetadata,
  buildJiraSpawnContextMessage,
  getJiraIssueByKey,
} from './jira.js'

export {
  resolveMirrorToPmo,
  type MirrorResolution,
  type MirrorResolutionInput,
} from './work-start.js'
