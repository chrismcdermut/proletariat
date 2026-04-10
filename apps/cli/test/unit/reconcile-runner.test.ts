import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js'
import { runReconcile } from '../../src/lib/reconcile/index.js'
import type { PRLookupFn, PRLookupRef } from '../../src/lib/reconcile/types.js'
import type { PMOStorage } from '../../src/lib/pmo/types.js'
import type { ProviderStorage } from '../../src/lib/providers/types.js'
import type { PRInfo } from '../../src/lib/pr/index.js'
import { ExternalExecutionMappingStore } from '../../src/lib/external-issues/mapping-store.js'

/**
 * Tier 2 Reconciler — Runner Tests (PRLT-1280)
 *
 * Drives runReconcile() against a real SQLite workspace with a stub
 * GitHub lookup. Verifies:
 *
 *   - The regression pattern: 6 review tickets with merged PRs land in Done
 *   - Idempotency: a second run makes zero additional changes
 *   - Dry-run: no state mutation, skipped transitions reported
 *   - `gh pr merge` drift: tickets with no prlt involvement still reconcile
 *   - Live lookup: reconciler does not depend on any local PR cache
 *   - Linked PR URLs from pmo_external_execution_prs work for tickets
 *     that don't have a ticket.branch
 */

const PROJECT_ID = 'proj-reconcile-test'

function makePR(overrides: Partial<PRInfo>): PRInfo {
  return {
    number: 1,
    url: 'https://github.com/test/repo/pull/1',
    title: 'Test PR',
    state: 'OPEN',
    headBranch: 'PRLT-1/feat/test',
    baseBranch: 'main',
    isDraft: false,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-08T00:00:00Z',
    ...overrides,
  }
}

/**
 * Create a ticket and then stamp its branch via updateTicket, since
 * CreateTicketInput does not accept branch directly.
 */
async function createTicketWithBranch(
  storage: SQLiteStorage,
  projectId: string,
  params: { title: string; statusName: string; branch?: string },
): Promise<{ id: string }> {
  const t = await storage.createTicket(projectId, {
    title: params.title,
    statusName: params.statusName,
  })
  if (params.branch) {
    await storage.updateTicket(t.id, { branch: params.branch })
  }
  return { id: t.id }
}

/**
 * Build a PR lookup stub that resolves by branch and by URL. We also
 * record every call so tests can assert the reconciler is hitting the
 * live lookup (and not some stale cache) on every cycle.
 */
function makeStubLookup(prs: PRInfo[]): { lookup: PRLookupFn; calls: PRLookupRef[] } {
  const byBranch = new Map(prs.map(pr => [pr.headBranch, pr]))
  const byNumber = new Map(prs.map(pr => [pr.number, pr]))
  const calls: PRLookupRef[] = []
  const lookup: PRLookupFn = ref => {
    calls.push(ref)
    if (ref.kind === 'branch') return byBranch.get(ref.branch) ?? null
    if (ref.kind === 'number') return byNumber.get(ref.number) ?? null
    if (ref.kind === 'url') {
      const m = ref.url.match(/\/pull\/(\d+)/)
      if (!m) return null
      return byNumber.get(Number.parseInt(m[1], 10)) ?? null
    }
    return null
  }
  return { lookup, calls }
}

describe('Tier 2 Reconciler — runner (PRLT-1280)', () => {
  let testDir: string
  let storage: SQLiteStorage
  let db: Database.Database

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-runner-'))
    const dbPath = path.join(testDir, 'pmo.db')

    // Create the db file first; SQLiteStorage requires it to exist.
    const bootstrap = new Database(dbPath)
    bootstrap.close()

    storage = new SQLiteStorage(dbPath)
    db = storage.getDatabase()

    // Make sure the external execution mapping tables exist (they are
    // created lazily by ExternalExecutionMappingStore).
    // eslint-disable-next-line no-new
    new ExternalExecutionMappingStore(db)

    // The "default" template ships a Backlog → Ready → In Progress →
    // Review → Done workflow, which matches the column names the
    // reconciler expects.
    await storage.createProject({
      id: PROJECT_ID,
      name: 'Reconcile Test Project',
      template: 'default',
    })
  })

  afterEach(async () => {
    await storage.close()
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  // ---------------------------------------------------------------------------
  // Regression: the exact drift pattern from PRLT-1280 — 6 tickets stuck in
  // Review, each tied to a merged PR on GitHub.
  // ---------------------------------------------------------------------------
  it('moves all 6 stuck-in-Review tickets to Done in a single pass', async () => {
    const prs: PRInfo[] = []
    for (let i = 1; i <= 6; i++) {
      // eslint-disable-next-line no-await-in-loop
      await createTicketWithBranch(storage, PROJECT_ID, {
        title: `Stuck ticket ${i}`,
        statusName: 'Review',
        branch: `PRLT-100${i}/feat/fix-${i}`,
      })
      prs.push(
        makePR({
          number: 1000 + i,
          state: 'MERGED',
          headBranch: `PRLT-100${i}/feat/fix-${i}`,
        }),
      )
    }

    const { lookup } = makeStubLookup(prs)
    const report = await runReconcile(
      db,
      storage as unknown as PMOStorage & ProviderStorage,
      { prLookup: lookup, projectId: PROJECT_ID },
    )

    expect(report.applied.length).to.equal(6)
    expect(report.failed.length).to.equal(0)
    expect(report.applied.every(t => t.toState === 'Done')).to.equal(true)
    expect(report.applied.every(t => t.prState === 'MERGED')).to.equal(true)

    // Every ticket is now in Done.
    const after = await storage.listTickets(PROJECT_ID)
    expect(after).to.have.lengthOf(6)
    for (const t of after) {
      expect(t.statusName).to.equal('Done')
      expect(t.statusCategory).to.equal('completed')
    }
  })

  // ---------------------------------------------------------------------------
  // Idempotency — second run must be a no-op.
  // ---------------------------------------------------------------------------
  it('is idempotent: a second run makes zero additional changes', async () => {
    await createTicketWithBranch(storage, PROJECT_ID, {
      title: 'Already shipped',
      statusName: 'Review',
      branch: 'PRLT-42/feat/ship',
    })
    const { lookup } = makeStubLookup([
      makePR({ number: 42, state: 'MERGED', headBranch: 'PRLT-42/feat/ship' }),
    ])

    const first = await runReconcile(
      db,
      storage as unknown as PMOStorage & ProviderStorage,
      { prLookup: lookup, projectId: PROJECT_ID },
    )
    expect(first.applied.length).to.equal(1)
    expect(first.applied[0].toState).to.equal('Done')

    const second = await runReconcile(
      db,
      storage as unknown as PMOStorage & ProviderStorage,
      { prLookup: lookup, projectId: PROJECT_ID },
    )
    expect(second.applied.length).to.equal(0)
    expect(second.failed.length).to.equal(0)
  })

  // ---------------------------------------------------------------------------
  // Dry-run — no mutations, transitions reported in `skipped`.
  // ---------------------------------------------------------------------------
  it('--dry-run reports transitions without mutating state', async () => {
    await createTicketWithBranch(storage, PROJECT_ID, {
      title: 'Would move',
      statusName: 'Review',
      branch: 'PRLT-7/feat/drift',
    })
    const { lookup } = makeStubLookup([
      makePR({ number: 7, state: 'MERGED', headBranch: 'PRLT-7/feat/drift' }),
    ])

    const report = await runReconcile(
      db,
      storage as unknown as PMOStorage & ProviderStorage,
      { prLookup: lookup, projectId: PROJECT_ID, dryRun: true },
    )

    expect(report.applied.length).to.equal(0)
    expect(report.skipped.length).to.equal(1)
    expect(report.skipped[0].toState).to.equal('Done')

    // State must be unchanged.
    const tickets = await storage.listTickets(PROJECT_ID)
    expect(tickets[0].statusName).to.equal('Review')
  })

  // ---------------------------------------------------------------------------
  // `gh pr merge` drift: merge outside prlt, no state change, reconcile fixes
  // ---------------------------------------------------------------------------
  it('catches drift from `gh pr merge` outside prlt', async () => {
    // Simulate: someone merged via `gh pr merge` without prlt knowing.
    // The ticket never left In Progress.
    await createTicketWithBranch(storage, PROJECT_ID, {
      title: 'Raw gh merge',
      statusName: 'In Progress',
      branch: 'PRLT-909/feat/raw',
    })
    const { lookup } = makeStubLookup([
      makePR({ number: 909, state: 'MERGED', headBranch: 'PRLT-909/feat/raw' }),
    ])

    const report = await runReconcile(
      db,
      storage as unknown as PMOStorage & ProviderStorage,
      { prLookup: lookup, projectId: PROJECT_ID },
    )

    expect(report.applied.length).to.equal(1)
    const [t] = await storage.listTickets(PROJECT_ID)
    expect(t.statusName).to.equal('Done')
  })

  // ---------------------------------------------------------------------------
  // Closed-without-merging → back to In Progress
  // ---------------------------------------------------------------------------
  it('moves a Review ticket back to In Progress when its PR is closed unmerged', async () => {
    await createTicketWithBranch(storage, PROJECT_ID, {
      title: 'Closed, not merged',
      statusName: 'Review',
      branch: 'PRLT-55/feat/rejected',
    })
    const { lookup } = makeStubLookup([
      makePR({ number: 55, state: 'CLOSED', headBranch: 'PRLT-55/feat/rejected' }),
    ])

    const report = await runReconcile(
      db,
      storage as unknown as PMOStorage & ProviderStorage,
      { prLookup: lookup, projectId: PROJECT_ID },
    )

    expect(report.applied.length).to.equal(1)
    expect(report.applied[0].toState).to.equal('In Progress')

    const [t] = await storage.listTickets(PROJECT_ID)
    expect(t.statusName).to.equal('In Progress')
  })

  // ---------------------------------------------------------------------------
  // Non-terminal scan: triage/backlog/unstarted tickets are also scanned
  // ---------------------------------------------------------------------------
  it('scans triage/backlog/unstarted tickets too', async () => {
    // A ticket that never advanced past Backlog but has a merged PR
    // (e.g. an agent ran out of band, or someone force-pushed a fix).
    await createTicketWithBranch(storage, PROJECT_ID, {
      title: 'Backlog with merged PR',
      statusName: 'Backlog',
      branch: 'PRLT-77/feat/early',
    })
    const { lookup } = makeStubLookup([
      makePR({ number: 77, state: 'MERGED', headBranch: 'PRLT-77/feat/early' }),
    ])

    const report = await runReconcile(
      db,
      storage as unknown as PMOStorage & ProviderStorage,
      { prLookup: lookup, projectId: PROJECT_ID },
    )
    expect(report.applied.length).to.equal(1)
    expect(report.applied[0].toState).to.equal('Done')
  })

  // ---------------------------------------------------------------------------
  // Live lookup: every cycle must actually call the PR lookup
  // ---------------------------------------------------------------------------
  it('hits the live PR lookup on every cycle (no local cache)', async () => {
    await createTicketWithBranch(storage, PROJECT_ID, {
      title: 'Live lookup check',
      statusName: 'In Progress',
      branch: 'PRLT-1/feat/x',
    })

    const { lookup, calls } = makeStubLookup([
      makePR({ number: 1, state: 'OPEN', headBranch: 'PRLT-1/feat/x' }),
    ])

    await runReconcile(
      db,
      storage as unknown as PMOStorage & ProviderStorage,
      { prLookup: lookup, projectId: PROJECT_ID },
    )
    const firstCallCount = calls.length
    expect(firstCallCount).to.be.greaterThan(0)

    await runReconcile(
      db,
      storage as unknown as PMOStorage & ProviderStorage,
      { prLookup: lookup, projectId: PROJECT_ID },
    )
    // Second cycle must issue new lookups — the reconciler is not
    // allowed to short-circuit on a local cache.
    expect(calls.length).to.be.greaterThan(firstCallCount)
  })

  // ---------------------------------------------------------------------------
  // PR URLs stored in pmo_external_execution_prs are resolved even when
  // the ticket has no linked branch.
  // ---------------------------------------------------------------------------
  it('resolves PR URLs stored in pmo_external_execution_prs', async () => {
    const ticket = await storage.createTicket(PROJECT_ID, {
      title: 'No branch, stored PR URL',
      statusName: 'In Progress',
    })
    // Simulate a ticket whose PR was recorded via the external execution
    // mapping (e.g. spawned from Linear without a local branch).
    const mapStore = new ExternalExecutionMappingStore(db)
    mapStore.upsertMapping({
      provider: 'pmo',
      externalId: ticket.id,
      externalKey: ticket.id,
      prUrl: 'https://github.com/test/repo/pull/2024',
    })

    const { lookup } = makeStubLookup([
      makePR({ number: 2024, state: 'MERGED', url: 'https://github.com/test/repo/pull/2024' }),
    ])

    const report = await runReconcile(
      db,
      storage as unknown as PMOStorage & ProviderStorage,
      { prLookup: lookup, projectId: PROJECT_ID },
    )

    expect(report.applied.length).to.equal(1)
    expect(report.applied[0].toState).to.equal('Done')
  })

  // ---------------------------------------------------------------------------
  // Tickets with no PR info are ignored (not flagged, not moved).
  // ---------------------------------------------------------------------------
  it('ignores tickets with no linked PR', async () => {
    await storage.createTicket(PROJECT_ID, {
      title: 'No PR, no problem',
      statusName: 'In Progress',
    })
    const { lookup } = makeStubLookup([])

    const report = await runReconcile(
      db,
      storage as unknown as PMOStorage & ProviderStorage,
      { prLookup: lookup, projectId: PROJECT_ID },
    )
    expect(report.applied.length).to.equal(0)
    expect(report.checked).to.be.greaterThan(0)
  })
})
