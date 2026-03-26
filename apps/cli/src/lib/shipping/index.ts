/**
 * Shipping Module — Public API
 *
 * Provider-agnostic shipping operations: sibling PR rebase,
 * conflict labeling, and git provider abstraction.
 */

export type {
  GitProvider,
  GitProviderName,
  UpdateBranchResult,
  SiblingRebaseResult,
  RebaseSiblingOptions,
} from './types.js'

export { GitHubProvider } from './github.js'
export { rebaseSiblingPRs, detectGitProvider } from './rebase.js'
