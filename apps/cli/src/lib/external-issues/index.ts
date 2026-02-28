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
  ISSUE_SOURCES,
  ExternalIssueError,
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
