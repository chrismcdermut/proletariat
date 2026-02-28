export type ExternalIssueSource = 'linear'

export type ExternalIssueAdapterErrorCode =
  | 'MISSING_CONFIG'
  | 'AUTH_FAILED'
  | 'BAD_PAYLOAD'
  | 'REQUEST_FAILED'

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

export interface ExternalIssueSourceMetadata {
  source: ExternalIssueSource
  externalKey: string
  externalId: string
  url: string
  raw: unknown
}

export interface NormalizedIssueEnvelope {
  title: string
  description?: string
  priority?: string
  category?: string
  statusName?: string
  labels: string[]
  source: ExternalIssueSourceMetadata
}

export interface ExternalIssueAdapter<TRawIssue> {
  readonly source: ExternalIssueSource
  listIssues(limit?: number): Promise<TRawIssue[]>
  normalizeIssue(rawIssue: TRawIssue): NormalizedIssueEnvelope
}
