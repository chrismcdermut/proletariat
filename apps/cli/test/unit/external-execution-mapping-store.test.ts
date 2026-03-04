import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { ExternalExecutionMappingStore } from '../../src/lib/external-issues/mapping-store.js'

describe('ExternalExecutionMappingStore', () => {
  let testDir: string
  let db: Database.Database
  let store: ExternalExecutionMappingStore

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'external-mapping-test-'))
    db = new Database(path.join(testDir, 'test.db'))
    db.pragma('foreign_keys = ON')
    store = new ExternalExecutionMappingStore(db)
  })

  afterEach(() => {
    db.close()
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
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
})
