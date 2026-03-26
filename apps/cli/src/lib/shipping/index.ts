/**
 * Shipping Module — Public API
 *
 * Provider-agnostic shipping operations: sibling PR rebase,
 * conflict labeling, git provider abstraction, and auto-merge orchestration.
 */

// Sibling Rebase (PRLT-1143)
export type {
  GitProvider,
  GitProviderName,
  UpdateBranchResult,
  SiblingRebaseResult,
  RebaseSiblingOptions,
} from './types.js'

export { GitHubProvider } from './github.js'
export { rebaseSiblingPRs, detectGitProvider } from './rebase.js'

// Auto-Merge (PRLT-1144)
export type {
  AutoMergeResult,
  AutoMergeProvider,
  WhenGreenOptions,
  WhenGreenResult,
} from './types.js'

export { GitHubAutoMergeProvider } from './github.js'
export { watchAndShip } from './auto-merge.js'
export type { WatchAndShipDeps } from './auto-merge.js'
