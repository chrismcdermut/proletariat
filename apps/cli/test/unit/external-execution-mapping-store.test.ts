import { expect } from 'chai'
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { ExternalExecutionMappingStore } from '../../src/lib/external-issues/mapping-store.js'
import { createFastTestDb, type FastTestDb } from '../e2e/test-helpers.js'

describe('ExternalExecutionMappingStore', () => {
  let fastDb: FastTestDb
  let db: SqliteDatabase
  let store: ExternalExecutionMappingStore

  before(() => {
    fastDb = createFastTestDb((db) => {
      // Initialize tables by creating a throwaway store instance
      // This ensures tables exist before any savepoints are created
      new ExternalExecutionMappingStore(db)
    })
    db = fastDb.db
  })

  beforeEach(() => {
    fastDb.savepoint()
    store = new ExternalExecutionMappingStore(db)
  })

  afterEach(() => {
    fastDb.rollback()
  })

  after(() => {
    fastDb.close()
  })

  it('enforces unique key on (provider, external_id) via idempotent upsert', () => {
    store.upsertMapping({
      provider: 'linear',
      externalId: 'lin-123',
      externalKey: 'ENG-123',
      canonicalUrl: 'https://linear.app/org/issue/ENG-123',
      latestStateSnapshot: { status: 'Backlog' },
      executionId: 'WORK-11111111',
    })

    store.upsertMapping({
      provider: 'linear',
      externalId: 'lin-123',
      externalKey: 'ENG-123',
      canonicalUrl: 'https://linear.app/org/issue/ENG-123',
      latestStateSnapshot: { status: 'In Progress' },
      executionId: 'WORK-22222222',
      prUrl: 'https://github.com/org/repo/pull/1',
    })

    const rowCount = db.prepare(`
      SELECT COUNT(*) AS count FROM pmo_external_execution_map
      WHERE provider = 'linear' AND external_id = 'lin-123'
    `).get() as { count: number }
    expect(rowCount.count).to.equal(1)

    const mapping = store.getByExternalId('linear', 'lin-123')
    expect(mapping).to.not.equal(null)
    expect(mapping!.executionIds).to.include('WORK-11111111')
    expect(mapping!.executionIds).to.include('WORK-22222222')
    expect(mapping!.prUrls).to.deep.equal(['https://github.com/org/repo/pull/1'])
    expect(mapping!.latestStateSnapshot?.status).to.equal('In Progress')
  })

  it('supports query by external ref and by execution ID', () => {
    store.upsertMapping({
      provider: 'jira',
      externalId: '10001',
      externalKey: 'PROJ-456',
      canonicalUrl: 'https://org.atlassian.net/browse/PROJ-456',
      latestStateSnapshot: { status: 'In Progress' },
      executionId: 'WORK-ABCDEF12',
    })

    const byRef = store.getByExternalId('jira', '10001')
    expect(byRef).to.not.equal(null)
    expect(byRef!.externalKey).to.equal('PROJ-456')

    const byExecution = store.findByExecutionId('WORK-ABCDEF12')
    expect(byExecution).to.have.length(1)
    expect(byExecution[0].provider).to.equal('jira')
    expect(byExecution[0].externalId).to.equal('10001')
  })

  it('creates a new mapping with all fields populated', () => {
    const now = new Date()
    const mapping = store.upsertMapping({
      provider: 'linear',
      externalId: 'new-id-1',
      externalKey: 'ENG-200',
      canonicalUrl: 'https://linear.app/org/issue/ENG-200',
      latestStateSnapshot: { status: 'Todo', priority: 'P1' },
      executionId: 'WORK-CREATE01',
      prUrl: 'https://github.com/org/repo/pull/5',
      lastSyncedAt: now,
      lastSpawnedAt: now,
    })

    expect(mapping.provider).to.equal('linear')
    expect(mapping.externalId).to.equal('new-id-1')
    expect(mapping.externalKey).to.equal('ENG-200')
    expect(mapping.canonicalUrl).to.equal('https://linear.app/org/issue/ENG-200')
    expect(mapping.latestStateSnapshot).to.deep.equal({ status: 'Todo', priority: 'P1' })
    expect(mapping.executionIds).to.deep.equal(['WORK-CREATE01'])
    expect(mapping.prUrls).to.deep.equal(['https://github.com/org/repo/pull/5'])
    expect(mapping.lastSyncedAt).to.be.instanceOf(Date)
    expect(mapping.lastSpawnedAt).to.be.instanceOf(Date)
    expect(mapping.createdAt).to.be.instanceOf(Date)
    expect(mapping.updatedAt).to.be.instanceOf(Date)
  })

  it('upsert updates snapshot and accumulates execution IDs and PR URLs', () => {
    store.upsertMapping({
      provider: 'jira',
      externalId: '20001',
      externalKey: 'PROJ-100',
      latestStateSnapshot: { status: 'Open' },
      executionId: 'WORK-EXEC01',
      prUrl: 'https://github.com/org/repo/pull/10',
    })

    store.upsertMapping({
      provider: 'jira',
      externalId: '20001',
      latestStateSnapshot: { status: 'In Review' },
      executionId: 'WORK-EXEC02',
      prUrl: 'https://github.com/org/repo/pull/11',
    })

    const mapping = store.getByExternalId('jira', '20001')!
    expect(mapping.latestStateSnapshot).to.deep.equal({ status: 'In Review' })
    expect(mapping.executionIds).to.include('WORK-EXEC01')
    expect(mapping.executionIds).to.include('WORK-EXEC02')
    expect(mapping.prUrls).to.include('https://github.com/org/repo/pull/10')
    expect(mapping.prUrls).to.include('https://github.com/org/repo/pull/11')
    expect(mapping.externalKey).to.equal('PROJ-100')
  })

  it('supports query by external key', () => {
    store.upsertMapping({
      provider: 'linear',
      externalId: 'lin-key-1',
      externalKey: 'ENG-300',
      canonicalUrl: 'https://linear.app/org/issue/ENG-300',
    })

    const byKey = store.getByExternalKey('linear', 'ENG-300')
    expect(byKey).to.not.equal(null)
    expect(byKey!.externalId).to.equal('lin-key-1')
    expect(byKey!.provider).to.equal('linear')
  })

  it('returns null for non-existent external ref', () => {
    const result = store.getByExternalId('linear', 'does-not-exist')
    expect(result).to.equal(null)
  })

  it('returns empty array for non-existent execution ID', () => {
    const result = store.findByExecutionId('WORK-NONEXIST')
    expect(result).to.deep.equal([])
  })

  it('keeps separate mappings for different providers with the same external_id', () => {
    store.upsertMapping({
      provider: 'linear',
      externalId: 'shared-id',
      externalKey: 'ENG-400',
      executionId: 'WORK-LIN01',
    })

    store.upsertMapping({
      provider: 'jira',
      externalId: 'shared-id',
      externalKey: 'PROJ-400',
      executionId: 'WORK-JIRA01',
    })

    const linear = store.getByExternalId('linear', 'shared-id')
    const jira = store.getByExternalId('jira', 'shared-id')
    expect(linear).to.not.equal(null)
    expect(jira).to.not.equal(null)
    expect(linear!.externalKey).to.equal('ENG-400')
    expect(jira!.externalKey).to.equal('PROJ-400')
    expect(linear!.executionIds).to.deep.equal(['WORK-LIN01'])
    expect(jira!.executionIds).to.deep.equal(['WORK-JIRA01'])
  })

  it('upsert without executionId or prUrl only updates the map row', () => {
    store.upsertMapping({
      provider: 'linear',
      externalId: 'lin-noexec',
      externalKey: 'ENG-500',
      latestStateSnapshot: { status: 'Backlog' },
    })

    const mapping = store.getByExternalId('linear', 'lin-noexec')!
    expect(mapping.executionIds).to.deep.equal([])
    expect(mapping.prUrls).to.deep.equal([])
    expect(mapping.externalKey).to.equal('ENG-500')
  })
})
