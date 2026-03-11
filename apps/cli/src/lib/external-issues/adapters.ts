import { validateOrThrow } from './validation.js'
import { ExternalExecutionMappingStore } from './mapping-store.js'
import {
  ExternalIssueError,
  type ExternalIssueAdapter,
  type ExternalExecutionMapping,
  type IssueEnvelope,
  type IssueSource,
} from './types.js'

type FetchIssueByKey = (key: string) => Promise<unknown>
type FetchIssuesByQuery = (query: Record<string, unknown>) => Promise<unknown[]>

interface AdapterFetchers {
  fetchByKey?: FetchIssueByKey
  fetchByQuery?: FetchIssuesByQuery
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  return asString(value) ?? null
}

function deriveProjectKeyFromExternalKey(externalKey: string | undefined): string | undefined {
  if (!externalKey) {
    return undefined
  }
  const [prefix] = externalKey.split('-')
  return prefix && prefix.trim().length > 0 ? prefix : undefined
}

function ensureNormalized(source: IssueSource, candidate: unknown): IssueEnvelope {
  try {
    return validateOrThrow(candidate)
  } catch (error) {
    if (error instanceof ExternalIssueError && error.code === 'VALIDATION_FAILED') {
      throw new ExternalIssueError(
        'NORMALIZE_FAILED',
        `Failed to normalize ${source} issue: ${error.message}`,
        source,
        error.validationErrors
      )
    }
    throw error
  }
}

function getFetchByKeyOrThrow(source: IssueSource, fetchByKey?: FetchIssueByKey): FetchIssueByKey {
  if (fetchByKey) {
    return fetchByKey
  }
  throw new ExternalIssueError(
    'FETCH_FAILED',
    `No ${source} fetchByKey implementation configured`,
    source
  )
}

function getFetchByQueryOrThrow(source: IssueSource, fetchByQuery?: FetchIssuesByQuery): FetchIssuesByQuery {
  if (fetchByQuery) {
    return fetchByQuery
  }
  throw new ExternalIssueError(
    'FETCH_FAILED',
    `No ${source} fetchByQuery implementation configured`,
    source
  )
}

function normalizeLinearPriority(rawPriority: unknown): string | null {
  if (rawPriority === null || rawPriority === undefined) {
    return null
  }

  if (typeof rawPriority === 'number') {
    switch (rawPriority) {
      case 1:
        return 'P0'
      case 2:
        return 'P1'
      case 3:
        return 'P2'
      case 4:
        return 'P3'
      default:
        return null
    }
  }

  if (typeof rawPriority === 'string') {
    const normalized = rawPriority.trim().toUpperCase()
    return normalized.length > 0 ? normalized : null
  }

  return null
}

function normalizeJiraPriority(rawPriority: unknown): string | null {
  const name =
    typeof rawPriority === 'string'
      ? rawPriority
      : asString(asRecord(rawPriority).name)

  if (!name) {
    return null
  }

  const normalized = name.trim().toLowerCase()
  if (normalized === 'highest' || normalized === 'blocker') {
    return 'P0'
  }
  if (normalized === 'high' || normalized === 'critical') {
    return 'P1'
  }
  if (normalized === 'medium') {
    return 'P2'
  }
  if (normalized === 'low' || normalized === 'lowest') {
    return 'P3'
  }
  return name.trim()
}

function normalizeLinearLabels(rawLabels: unknown): string[] {
  if (!Array.isArray(rawLabels)) {
    return []
  }
  return rawLabels
    .map((label) => {
      if (typeof label === 'string') {
        return asString(label)
      }
      if (typeof label === 'object' && label !== null) {
        return asString((label as Record<string, unknown>).name)
      }
      return undefined
    })
    .filter((label): label is string => typeof label === 'string')
}

function normalizeJiraLabels(rawLabels: unknown): string[] {
  if (!Array.isArray(rawLabels)) {
    return []
  }
  return rawLabels.filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
}

function extractAdfText(node: unknown): string {
  if (typeof node === 'string') {
    return node
  }

  if (!node || typeof node !== 'object') {
    return ''
  }

  const record = node as Record<string, unknown>
  const parts: string[] = []

  if (typeof record.text === 'string') {
    parts.push(record.text)
  }

  if (Array.isArray(record.content)) {
    for (const child of record.content) {
      const text = extractAdfText(child)
      if (text) {
        parts.push(text)
      }
    }
  }

  return parts.join(' ').trim()
}

function normalizeJiraDescription(rawDescription: unknown): string {
  if (typeof rawDescription === 'string') {
    return rawDescription
  }
  if (rawDescription === null || rawDescription === undefined) {
    return ''
  }
  return extractAdfText(rawDescription)
}

function deriveJiraUrl(raw: Record<string, unknown>, key: string | undefined): string | undefined {
  const directUrl = asString(raw.url)
  if (directUrl) {
    return directUrl
  }

  const selfUrl = asString(raw.self)
  if (!selfUrl || !key) {
    return undefined
  }

  try {
    const parsed = new URL(selfUrl)
    return `${parsed.origin}/browse/${key}`
  } catch {
    return undefined
  }
}

export class LinearIssueAdapter implements ExternalIssueAdapter {
  readonly source = 'linear' as const

  private readonly fetchByKeyImpl?: FetchIssueByKey
  private readonly fetchByQueryImpl?: FetchIssuesByQuery

  constructor(fetchers: AdapterFetchers = {}) {
    this.fetchByKeyImpl = fetchers.fetchByKey
    this.fetchByQueryImpl = fetchers.fetchByQuery
  }

  normalize(raw: unknown): IssueEnvelope {
    const data = asRecord(raw)
    const externalKey = asString(data.identifier)

    const envelope = {
      source: this.source,
      external_id: asString(data.id),
      external_key: externalKey,
      title: asString(data.title),
      description: typeof data.description === 'string' ? data.description : '',
      labels: normalizeLinearLabels(data.labels),
      priority: normalizeLinearPriority(data.priority),
      status: asString(asRecord(data.state).name) ?? asString(data.state),
      url: asString(data.url),
      project_key:
        asString(asRecord(data.team).key) ??
        asString(asRecord(data.project).key) ??
        deriveProjectKeyFromExternalKey(externalKey),
      assignee:
        asNullableString(asRecord(data.assignee).displayName) ??
        asNullableString(asRecord(data.assignee).name) ??
        asNullableString(asRecord(data.assignee).email),
      raw: data,
    }

    return ensureNormalized(this.source, envelope)
  }

  async fetchByKey(key: string): Promise<IssueEnvelope> {
    const fetchIssueByKey = getFetchByKeyOrThrow(this.source, this.fetchByKeyImpl)
    const raw = await fetchIssueByKey(key)
    return this.normalize(raw)
  }

  async fetchByQuery(query: Record<string, unknown>): Promise<IssueEnvelope[]> {
    const fetchIssuesByQuery = getFetchByQueryOrThrow(this.source, this.fetchByQueryImpl)
    const rawIssues = await fetchIssuesByQuery(query)
    return rawIssues.map((raw) => this.normalize(raw))
  }

  persistMapping(
    store: ExternalExecutionMappingStore,
    envelope: IssueEnvelope,
    params?: { executionId?: string; prUrl?: string; lastSyncedAt?: Date; lastSpawnedAt?: Date }
  ): ExternalExecutionMapping {
    return store.upsertMapping({
      provider: this.source,
      externalId: envelope.external_id,
      externalKey: envelope.external_key,
      canonicalUrl: envelope.url,
      latestStateSnapshot: {
        status: envelope.status,
        priority: envelope.priority,
        assignee: envelope.assignee,
        projectKey: envelope.project_key,
      },
      executionId: params?.executionId,
      prUrl: params?.prUrl,
      lastSyncedAt: params?.lastSyncedAt,
      lastSpawnedAt: params?.lastSpawnedAt,
    })
  }

  readMappingByExternalId(store: ExternalExecutionMappingStore, externalId: string): ExternalExecutionMapping | null {
    return store.getByExternalId(this.source, externalId)
  }

  readMappingsByExecutionId(store: ExternalExecutionMappingStore, executionId: string): ExternalExecutionMapping[] {
    return store.findByExecutionId(executionId).filter((mapping) => mapping.provider === this.source)
  }
}

export class JiraIssueAdapter implements ExternalIssueAdapter {
  readonly source = 'jira' as const

  private readonly fetchByKeyImpl?: FetchIssueByKey
  private readonly fetchByQueryImpl?: FetchIssuesByQuery

  constructor(fetchers: AdapterFetchers = {}) {
    this.fetchByKeyImpl = fetchers.fetchByKey
    this.fetchByQueryImpl = fetchers.fetchByQuery
  }

  normalize(raw: unknown): IssueEnvelope {
    const data = asRecord(raw)
    const fields = asRecord(data.fields)
    const key = asString(data.key)

    const envelope = {
      source: this.source,
      external_id: asString(data.id),
      external_key: key,
      title: asString(fields.summary),
      description: normalizeJiraDescription(fields.description),
      labels: normalizeJiraLabels(fields.labels),
      priority: normalizeJiraPriority(fields.priority),
      status: asString(asRecord(fields.status).name),
      url: deriveJiraUrl(data, key),
      project_key: asString(asRecord(fields.project).key) ?? deriveProjectKeyFromExternalKey(key),
      assignee:
        asNullableString(asRecord(fields.assignee).displayName) ??
        asNullableString(asRecord(fields.assignee).emailAddress) ??
        asNullableString(asRecord(fields.assignee).accountId),
      item_type: asNullableString(asRecord(fields.issuetype).name),
      raw: data,
    }

    return ensureNormalized(this.source, envelope)
  }

  async fetchByKey(key: string): Promise<IssueEnvelope> {
    const fetchIssueByKey = getFetchByKeyOrThrow(this.source, this.fetchByKeyImpl)
    const raw = await fetchIssueByKey(key)
    return this.normalize(raw)
  }

  async fetchByQuery(query: Record<string, unknown>): Promise<IssueEnvelope[]> {
    const fetchIssuesByQuery = getFetchByQueryOrThrow(this.source, this.fetchByQueryImpl)
    const rawIssues = await fetchIssuesByQuery(query)
    return rawIssues.map((raw) => this.normalize(raw))
  }

  persistMapping(
    store: ExternalExecutionMappingStore,
    envelope: IssueEnvelope,
    params?: { executionId?: string; prUrl?: string; lastSyncedAt?: Date; lastSpawnedAt?: Date }
  ): ExternalExecutionMapping {
    return store.upsertMapping({
      provider: this.source,
      externalId: envelope.external_id,
      externalKey: envelope.external_key,
      canonicalUrl: envelope.url,
      latestStateSnapshot: {
        status: envelope.status,
        priority: envelope.priority,
        assignee: envelope.assignee,
        projectKey: envelope.project_key,
      },
      executionId: params?.executionId,
      prUrl: params?.prUrl,
      lastSyncedAt: params?.lastSyncedAt,
      lastSpawnedAt: params?.lastSpawnedAt,
    })
  }

  readMappingByExternalId(store: ExternalExecutionMappingStore, externalId: string): ExternalExecutionMapping | null {
    return store.getByExternalId(this.source, externalId)
  }

  readMappingsByExecutionId(store: ExternalExecutionMappingStore, executionId: string): ExternalExecutionMapping[] {
    return store.findByExecutionId(executionId).filter((mapping) => mapping.provider === this.source)
  }
}

function normalizeAsanaLabels(rawTags: unknown): string[] {
  if (!Array.isArray(rawTags)) {
    return []
  }
  return rawTags
    .map((tag) => {
      if (typeof tag === 'string') {
        return asString(tag)
      }
      if (typeof tag === 'object' && tag !== null) {
        return asString((tag as Record<string, unknown>).name)
      }
      return undefined
    })
    .filter((label): label is string => typeof label === 'string')
}

function normalizeShortcutLabels(rawLabels: unknown): string[] {
  if (!Array.isArray(rawLabels)) {
    return []
  }
  return rawLabels
    .map((label) => {
      if (typeof label === 'string') {
        return asString(label)
      }
      if (typeof label === 'object' && label !== null) {
        return asString((label as Record<string, unknown>).name)
      }
      return undefined
    })
    .filter((label): label is string => typeof label === 'string')
}

function deriveAsanaStatusFromRecord(data: Record<string, unknown>): string {
  if (data.completed === true) {
    return 'Completed'
  }
  const memberships = data.memberships as Array<{ section?: { name?: string } }> | undefined
  const sectionName = memberships?.[0]?.section?.name
  if (sectionName) {
    return sectionName
  }
  return 'Open'
}

function deriveAsanaUrlFromRecord(data: Record<string, unknown>): string | undefined {
  const permalink = asString(data.permalink_url)
  if (permalink) {
    return permalink
  }
  const gid = asString(data.gid)
  if (gid) {
    return `https://app.asana.com/0/0/${gid}`
  }
  return undefined
}

function deriveAsanaProjectKeyFromRecord(data: Record<string, unknown>): string {
  const memberships = data.memberships as Array<{ project?: { gid?: string; name?: string } }> | undefined
  const project = memberships?.[0]?.project
  return project?.name || project?.gid || 'ASANA'
}

export class AsanaIssueAdapter implements ExternalIssueAdapter {
  readonly source = 'asana' as const

  private readonly fetchByKeyImpl?: FetchIssueByKey
  private readonly fetchByQueryImpl?: FetchIssuesByQuery

  constructor(fetchers: AdapterFetchers = {}) {
    this.fetchByKeyImpl = fetchers.fetchByKey
    this.fetchByQueryImpl = fetchers.fetchByQuery
  }

  normalize(raw: unknown): IssueEnvelope {
    const data = asRecord(raw)
    const gid = asString(data.gid)

    const envelope = {
      source: this.source,
      external_id: gid,
      external_key: gid,
      title: asString(data.name),
      description: typeof data.notes === 'string' ? data.notes : '',
      labels: normalizeAsanaLabels(data.tags),
      priority: null,
      status: deriveAsanaStatusFromRecord(data),
      url: deriveAsanaUrlFromRecord(data),
      project_key: deriveAsanaProjectKeyFromRecord(data),
      assignee: asNullableString(asRecord(data.assignee).name),
      item_type: 'task',
      raw: data,
    }

    return ensureNormalized(this.source, envelope)
  }

  async fetchByKey(key: string): Promise<IssueEnvelope> {
    const fetchIssueByKey = getFetchByKeyOrThrow(this.source, this.fetchByKeyImpl)
    const raw = await fetchIssueByKey(key)
    return this.normalize(raw)
  }

  async fetchByQuery(query: Record<string, unknown>): Promise<IssueEnvelope[]> {
    const fetchIssuesByQuery = getFetchByQueryOrThrow(this.source, this.fetchByQueryImpl)
    const rawIssues = await fetchIssuesByQuery(query)
    return rawIssues.map((raw) => this.normalize(raw))
  }

  persistMapping(
    store: ExternalExecutionMappingStore,
    envelope: IssueEnvelope,
    params?: { executionId?: string; prUrl?: string; lastSyncedAt?: Date; lastSpawnedAt?: Date }
  ): ExternalExecutionMapping {
    return store.upsertMapping({
      provider: this.source,
      externalId: envelope.external_id,
      externalKey: envelope.external_key,
      canonicalUrl: envelope.url,
      latestStateSnapshot: {
        status: envelope.status,
        priority: envelope.priority,
        assignee: envelope.assignee,
        projectKey: envelope.project_key,
      },
      executionId: params?.executionId,
      prUrl: params?.prUrl,
      lastSyncedAt: params?.lastSyncedAt,
      lastSpawnedAt: params?.lastSpawnedAt,
    })
  }

  readMappingByExternalId(store: ExternalExecutionMappingStore, externalId: string): ExternalExecutionMapping | null {
    return store.getByExternalId(this.source, externalId)
  }

  readMappingsByExecutionId(store: ExternalExecutionMappingStore, executionId: string): ExternalExecutionMapping[] {
    return store.findByExecutionId(executionId).filter((mapping) => mapping.provider === this.source)
  }
}

function normalizeShortcutPriority(labels: string[]): string | null {
  const priorityLabel = labels.find(l => /^P[0-3]$/i.test(l))
  return priorityLabel ? priorityLabel.toUpperCase() : null
}

export class ShortcutIssueAdapter implements ExternalIssueAdapter {
  readonly source = 'shortcut' as const

  private readonly fetchByKeyImpl?: FetchIssueByKey
  private readonly fetchByQueryImpl?: FetchIssuesByQuery

  constructor(fetchers: AdapterFetchers = {}) {
    this.fetchByKeyImpl = fetchers.fetchByKey
    this.fetchByQueryImpl = fetchers.fetchByQuery
  }

  normalize(raw: unknown): IssueEnvelope {
    const data = asRecord(raw)
    const storyId = data.id !== undefined ? String(data.id) : asString(data.id)
    const externalKey = `sc-${storyId}`
    const labels = normalizeShortcutLabels(data.labels)

    const envelope = {
      source: this.source,
      external_id: storyId,
      external_key: externalKey,
      title: asString(data.name),
      description: typeof data.description === 'string' ? data.description : '',
      labels,
      priority: normalizeShortcutPriority(labels),
      status: asString(data.workflow_state_name) ?? 'Unknown',
      url: asString(data.app_url),
      project_key: data.group_id ? String(data.group_id) : 'DEFAULT',
      assignee: null,
      item_type: asNullableString(data.story_type),
      raw: data,
    }

    return ensureNormalized(this.source, envelope)
  }

  async fetchByKey(key: string): Promise<IssueEnvelope> {
    const fetchIssueByKey = getFetchByKeyOrThrow(this.source, this.fetchByKeyImpl)
    const raw = await fetchIssueByKey(key)
    return this.normalize(raw)
  }

  async fetchByQuery(query: Record<string, unknown>): Promise<IssueEnvelope[]> {
    const fetchIssuesByQuery = getFetchByQueryOrThrow(this.source, this.fetchByQueryImpl)
    const rawIssues = await fetchIssuesByQuery(query)
    return rawIssues.map((raw) => this.normalize(raw))
  }

  persistMapping(
    store: ExternalExecutionMappingStore,
    envelope: IssueEnvelope,
    params?: { executionId?: string; prUrl?: string; lastSyncedAt?: Date; lastSpawnedAt?: Date }
  ): ExternalExecutionMapping {
    return store.upsertMapping({
      provider: this.source,
      externalId: envelope.external_id,
      externalKey: envelope.external_key,
      canonicalUrl: envelope.url,
      latestStateSnapshot: {
        status: envelope.status,
        priority: envelope.priority,
        assignee: envelope.assignee,
        projectKey: envelope.project_key,
      },
      executionId: params?.executionId,
      prUrl: params?.prUrl,
      lastSyncedAt: params?.lastSyncedAt,
      lastSpawnedAt: params?.lastSpawnedAt,
    })
  }

  readMappingByExternalId(store: ExternalExecutionMappingStore, externalId: string): ExternalExecutionMapping | null {
    return store.getByExternalId(this.source, externalId)
  }

  readMappingsByExecutionId(store: ExternalExecutionMappingStore, executionId: string): ExternalExecutionMapping[] {
    return store.findByExecutionId(executionId).filter((mapping) => mapping.provider === this.source)
  }
}

function normalizeTrelloLabels(rawLabels: unknown): string[] {
  if (!Array.isArray(rawLabels)) {
    return []
  }
  return rawLabels
    .map((label) => {
      if (typeof label === 'string') {
        return asString(label)
      }
      if (typeof label === 'object' && label !== null) {
        return asString((label as Record<string, unknown>).name)
      }
      return undefined
    })
    .filter((label): label is string => typeof label === 'string')
}

function normalizeTrelloPriority(labels: string[]): string | null {
  const priorityLabel = labels.find(l => /^P[0-3]$/i.test(l))
  return priorityLabel ? priorityLabel.toUpperCase() : null
}

export class TrelloIssueAdapter implements ExternalIssueAdapter {
  readonly source = 'trello' as const

  private readonly fetchByKeyImpl?: FetchIssueByKey
  private readonly fetchByQueryImpl?: FetchIssuesByQuery

  constructor(fetchers: AdapterFetchers = {}) {
    this.fetchByKeyImpl = fetchers.fetchByKey
    this.fetchByQueryImpl = fetchers.fetchByQuery
  }

  normalize(raw: unknown): IssueEnvelope {
    const data = asRecord(raw)
    const cardId = data.id !== undefined ? String(data.id) : asString(data.id)
    const labels = normalizeTrelloLabels(data.labels)

    const members = Array.isArray(data.members) ? data.members : []
    const firstMember = asRecord(members[0])
    const assignee = asNullableString(firstMember.fullName) ?? asNullableString(firstMember.username)

    const envelope = {
      source: this.source,
      external_id: cardId,
      external_key: cardId,
      title: asString(data.name),
      description: typeof data.desc === 'string' ? data.desc : '',
      labels,
      priority: normalizeTrelloPriority(labels),
      status: data.closed === true ? 'Closed' : 'Open',
      url: asString(data.url),
      project_key: data.idBoard ? String(data.idBoard) : 'DEFAULT',
      assignee,
      item_type: 'card',
      raw: data,
    }

    return ensureNormalized(this.source, envelope)
  }

  async fetchByKey(key: string): Promise<IssueEnvelope> {
    const fetchIssueByKey = getFetchByKeyOrThrow(this.source, this.fetchByKeyImpl)
    const raw = await fetchIssueByKey(key)
    return this.normalize(raw)
  }

  async fetchByQuery(query: Record<string, unknown>): Promise<IssueEnvelope[]> {
    const fetchIssuesByQuery = getFetchByQueryOrThrow(this.source, this.fetchByQueryImpl)
    const rawIssues = await fetchIssuesByQuery(query)
    return rawIssues.map((raw) => this.normalize(raw))
  }

  persistMapping(
    store: ExternalExecutionMappingStore,
    envelope: IssueEnvelope,
    params?: { executionId?: string; prUrl?: string; lastSyncedAt?: Date; lastSpawnedAt?: Date }
  ): ExternalExecutionMapping {
    return store.upsertMapping({
      provider: this.source,
      externalId: envelope.external_id,
      externalKey: envelope.external_key,
      canonicalUrl: envelope.url,
      latestStateSnapshot: {
        status: envelope.status,
        priority: envelope.priority,
        assignee: envelope.assignee,
        projectKey: envelope.project_key,
      },
      executionId: params?.executionId,
      prUrl: params?.prUrl,
      lastSyncedAt: params?.lastSyncedAt,
      lastSpawnedAt: params?.lastSpawnedAt,
    })
  }

  readMappingByExternalId(store: ExternalExecutionMappingStore, externalId: string): ExternalExecutionMapping | null {
    return store.getByExternalId(this.source, externalId)
  }

  readMappingsByExecutionId(store: ExternalExecutionMappingStore, executionId: string): ExternalExecutionMapping[] {
    return store.findByExecutionId(executionId).filter((mapping) => mapping.provider === this.source)
  }
}
