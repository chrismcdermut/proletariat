import { expect } from 'chai'
import {
  deriveExpectedState,
  buildTransition,
  formatTransitionLogLine,
} from '../../src/lib/reconcile/core.js'
import type { LinkedPR, ReconcileTicket } from '../../src/lib/reconcile/types.js'
import type { PRInfo } from '../../src/lib/pr/index.js'

/**
 * Tier 2 Reconciler — Core Rule Tests (PRLT-1280)
 *
 * These tests only exercise the pure rule engine. No database, no gh CLI,
 * no provider adapters. The runner-level integration tests live in
 * reconcile-runner.test.ts.
 */

function makeTicket(overrides: Partial<ReconcileTicket> = {}): ReconcileTicket {
  return {
    id: 'TKT-001',
    title: 'Test ticket',
    projectId: 'proj-001',
    statusName: 'In Review',
    statusCategory: 'started',
    branch: 'PRLT-1/feat/test',
    metadata: {},
    ...overrides,
  }
}

function makePR(overrides: Partial<PRInfo> = {}): PRInfo {
  return {
    number: 42,
    url: 'https://github.com/test/repo/pull/42',
    title: 'Test PR',
    state: 'MERGED',
    headBranch: 'PRLT-1/feat/test',
    baseBranch: 'main',
    isDraft: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function wrap(pr: PRInfo, source: LinkedPR['source'] = 'ticket_branch'): LinkedPR {
  return { pr, source }
}

describe('Reconcile Core — deriveExpectedState', () => {
  describe('Rule 1: merged PR → Done', () => {
    it('moves an In Review ticket to Done when its PR is merged', () => {
      const decision = deriveExpectedState(
        makeTicket({ statusName: 'In Review', statusCategory: 'started' }),
        [wrap(makePR({ state: 'MERGED' }))],
      )
      expect(decision).to.not.be.null
      expect(decision!.targetState).to.equal('Done')
      expect(decision!.driver.pr.state).to.equal('MERGED')
      expect(decision!.reason).to.include('MERGED')
    })

    it('moves an In Progress ticket to Done when its PR is merged', () => {
      const decision = deriveExpectedState(
        makeTicket({ statusName: 'In Progress', statusCategory: 'started' }),
        [wrap(makePR({ state: 'MERGED' }))],
      )
      expect(decision).to.not.be.null
      expect(decision!.targetState).to.equal('Done')
    })

    it('moves a backlog ticket to Done when its PR is merged', () => {
      // This is the exact drift pattern described in PRLT-1280:
      // a PR was merged but the ticket never left its pre-work state.
      const decision = deriveExpectedState(
        makeTicket({ statusName: 'Backlog', statusCategory: 'backlog' }),
        [wrap(makePR({ state: 'MERGED', number: 321 }))],
      )
      expect(decision).to.not.be.null
      expect(decision!.targetState).to.equal('Done')
      expect(decision!.reason).to.include('#321')
    })

    it('is idempotent: a ticket already in Done produces no decision', () => {
      const decision = deriveExpectedState(
        makeTicket({ statusName: 'Done', statusCategory: 'completed' }),
        [wrap(makePR({ state: 'MERGED' }))],
      )
      expect(decision).to.be.null
    })

    it('never resurrects a canceled ticket even if its PR later merges', () => {
      const decision = deriveExpectedState(
        makeTicket({ statusName: 'Canceled', statusCategory: 'canceled' }),
        [wrap(makePR({ state: 'MERGED' }))],
      )
      expect(decision).to.be.null
    })

    it('prefers a merged PR over other linked PRs', () => {
      const decision = deriveExpectedState(
        makeTicket(),
        [
          wrap(makePR({ number: 1, state: 'OPEN' })),
          wrap(makePR({ number: 2, state: 'MERGED' })),
          wrap(makePR({ number: 3, state: 'CLOSED' })),
        ],
      )
      expect(decision).to.not.be.null
      expect(decision!.driver.pr.number).to.equal(2)
      expect(decision!.targetState).to.equal('Done')
    })

    it('respects a custom Done column name from the workflow config', () => {
      const decision = deriveExpectedState(
        makeTicket({ statusName: 'QA', statusCategory: 'started' }),
        [wrap(makePR({ state: 'MERGED' }))],
        {
          planned: 'Planned',
          in_progress: 'In Progress',
          review: 'QA',
          done: 'Shipped',
          backlog: 'Backlog',
        },
      )
      expect(decision).to.not.be.null
      expect(decision!.targetState).to.equal('Shipped')
    })

    it('is idempotent against a custom Done column name', () => {
      const decision = deriveExpectedState(
        makeTicket({ statusName: 'Shipped', statusCategory: 'started' }),
        [wrap(makePR({ state: 'MERGED' }))],
        {
          planned: 'Planned',
          in_progress: 'In Progress',
          review: 'QA',
          done: 'Shipped',
          backlog: 'Backlog',
        },
      )
      expect(decision).to.be.null
    })
  })

  describe('Rule 2: review ticket + all PRs closed-not-merged → In Progress', () => {
    it('moves a review ticket back to In Progress when the only PR was closed', () => {
      const decision = deriveExpectedState(
        makeTicket({ statusName: 'In Review', statusCategory: 'started' }),
        [wrap(makePR({ state: 'CLOSED', number: 99 }))],
      )
      expect(decision).to.not.be.null
      expect(decision!.targetState).to.equal('In Progress')
      expect(decision!.reason).to.include('CLOSED')
    })

    it('does nothing when the ticket is already in In Progress', () => {
      const decision = deriveExpectedState(
        makeTicket({ statusName: 'In Progress', statusCategory: 'started' }),
        [wrap(makePR({ state: 'CLOSED' }))],
      )
      expect(decision).to.be.null
    })

    it('does nothing when at least one linked PR is still open', () => {
      const decision = deriveExpectedState(
        makeTicket({ statusName: 'In Review', statusCategory: 'started' }),
        [
          wrap(makePR({ number: 1, state: 'CLOSED' })),
          wrap(makePR({ number: 2, state: 'OPEN' })),
        ],
      )
      expect(decision).to.be.null
    })
  })

  describe('no action', () => {
    it('produces no decision when no PRs are linked', () => {
      const decision = deriveExpectedState(makeTicket(), [])
      expect(decision).to.be.null
    })

    it('produces no decision for an open PR on an in-progress ticket', () => {
      const decision = deriveExpectedState(
        makeTicket({ statusName: 'In Progress', statusCategory: 'started' }),
        [wrap(makePR({ state: 'OPEN' }))],
      )
      expect(decision).to.be.null
    })
  })

  describe('idempotency invariant', () => {
    it('running twice against an already-correct ticket is a no-op', () => {
      const ticket = makeTicket({ statusName: 'Done', statusCategory: 'completed' })
      const prs = [wrap(makePR({ state: 'MERGED' }))]
      expect(deriveExpectedState(ticket, prs)).to.be.null
      expect(deriveExpectedState(ticket, prs)).to.be.null
    })
  })
})

describe('Reconcile Core — buildTransition', () => {
  it('builds a transition record with every required field', () => {
    const ticket = makeTicket({ statusName: 'In Review', id: 'TKT-142' })
    const driver = wrap(makePR({ state: 'MERGED', number: 321 }))
    const now = new Date('2026-04-08T12:00:00Z')

    const t = buildTransition({
      ticket,
      provider: 'linear',
      targetState: 'Done',
      reason: 'PR merged',
      driver,
      now,
    })

    expect(t.ticketId).to.equal('TKT-142')
    expect(t.provider).to.equal('linear')
    expect(t.fromState).to.equal('In Review')
    expect(t.toState).to.equal('Done')
    expect(t.prNumber).to.equal(321)
    expect(t.prState).to.equal('MERGED')
    expect(t.reason).to.equal('PR merged')
    expect(t.decidedAt).to.equal('2026-04-08T12:00:00.000Z')
  })

  it('tolerates a missing driver PR', () => {
    const t = buildTransition({
      ticket: makeTicket(),
      provider: 'pmo',
      targetState: 'Done',
      reason: 'nothing',
    })
    expect(t.prNumber).to.be.undefined
    expect(t.prState).to.be.undefined
  })
})

describe('Reconcile Core — formatTransitionLogLine', () => {
  it('includes ticket id, old/new state, PR number and reason per AC', () => {
    const line = formatTransitionLogLine({
      ticketId: 'TKT-142',
      ticketTitle: 'Fix thing',
      projectId: 'proj-001',
      provider: 'linear',
      fromState: 'In Review',
      toState: 'Done',
      prNumber: 321,
      prState: 'MERGED',
      reason: 'GitHub PR #321 is MERGED',
      decidedAt: '2026-04-08T12:00:00.000Z',
    })
    expect(line).to.include('TKT-142')
    expect(line).to.include('In Review')
    expect(line).to.include('Done')
    expect(line).to.include('PR #321')
    expect(line).to.include('MERGED')
    expect(line).to.include('2026-04-08T12:00:00.000Z')
    expect(line).to.include('reason:')
  })
})
