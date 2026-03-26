import { expect } from 'chai'
import {
  reconcileTicket,
  type ReconcileContext,
  type ReconcileAction,
} from '../../src/lib/sync/reconciler.js'
import type { Ticket } from '../../src/lib/pmo/types.js'
import type { PRInfo, PRCheck } from '../../src/lib/pr/index.js'

/**
 * Sync Reconciler Unit Tests
 *
 * Tests the four reconciliation rules:
 * 1. Merged PR + ticket not Done → move to Done
 * 2. Green CI + ticket In Progress → move to Review
 * 3. Ticket In Progress + no active agent + no PR → flag as stale
 * 4. Ticket In Review + PR closed → move to Backlog
 */

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'TKT-001',
    title: 'Test ticket',
    statusId: 'status-in-progress',
    statusName: 'In Progress',
    statusCategory: 'started',
    subtasks: [],
    labels: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makePR(overrides: Partial<PRInfo> = {}): PRInfo {
  return {
    number: 42,
    url: 'https://github.com/test/repo/pull/42',
    title: 'Test PR',
    state: 'OPEN',
    headBranch: 'PRLT-123/feat/test',
    baseBranch: 'main',
    isDraft: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeChecks(conclusions: string[]): PRCheck[] {
  return conclusions.map((conclusion, i) => ({
    name: `check-${i}`,
    status: 'completed',
    conclusion,
    url: '',
  }))
}

describe('Sync Reconciler', () => {
  // =========================================================================
  // Rule 1: Merged PR → move to Done
  // =========================================================================
  describe('Rule 1: Merged PR + ticket not Done → move to Done', () => {
    it('should move ticket to Done when PR is merged and ticket is in progress', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'MERGED' }),
        checks: [],
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.not.be.null
      expect(action!.type).to.equal('move_to_done')
      expect(action!.targetStatus).to.equal('Done')
      expect(action!.reason).to.include('merged')
    })

    it('should move ticket to Done when PR is merged and ticket is in review', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Review' }),
        pr: makePR({ state: 'MERGED' }),
        checks: [],
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.not.be.null
      expect(action!.type).to.equal('move_to_done')
    })

    it('should NOT move ticket when PR is merged and ticket is already Done', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'completed', statusName: 'Done' }),
        pr: makePR({ state: 'MERGED' }),
        checks: [],
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.be.null
    })

    it('should NOT move ticket when PR is merged and ticket is canceled', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'canceled', statusName: 'Canceled' }),
        pr: makePR({ state: 'MERGED' }),
        checks: [],
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.be.null
    })

    it('should move backlog ticket to Done when PR is merged', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'backlog', statusName: 'Backlog' }),
        pr: makePR({ state: 'MERGED' }),
        checks: [],
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.not.be.null
      expect(action!.type).to.equal('move_to_done')
    })
  })

  // =========================================================================
  // Rule 2: Green CI → move to Review
  // =========================================================================
  describe('Rule 2: Green CI + ticket In Progress → move to Review', () => {
    it('should move ticket to Review when all checks pass', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'OPEN', isDraft: false }),
        checks: makeChecks(['SUCCESS', 'SUCCESS', 'NEUTRAL']),
        hasActiveExecution: true,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.not.be.null
      expect(action!.type).to.equal('move_to_review')
      expect(action!.targetStatus).to.equal('Review')
    })

    it('should NOT move to Review when checks are failing', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'OPEN' }),
        checks: makeChecks(['SUCCESS', 'FAILURE']),
        hasActiveExecution: true,
      }

      const action = reconcileTicket(ctx)
      // Should not produce a move_to_review action
      expect(action?.type).to.not.equal('move_to_review')
    })

    it('should NOT move to Review when PR is a draft', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'OPEN', isDraft: true }),
        checks: makeChecks(['SUCCESS']),
        hasActiveExecution: true,
      }

      const action = reconcileTicket(ctx)
      // Draft PRs should not trigger review movement
      expect(action?.type).to.not.equal('move_to_review')
    })

    it('should NOT move to Review when ticket is already in review', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Review' }),
        pr: makePR({ state: 'OPEN' }),
        checks: makeChecks(['SUCCESS']),
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      expect(action?.type).to.not.equal('move_to_review')
    })

    it('should NOT move to Review when there are no checks', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'OPEN' }),
        checks: [],
        hasActiveExecution: true,
      }

      const action = reconcileTicket(ctx)
      expect(action?.type).to.not.equal('move_to_review')
    })

    it('should treat SKIPPED checks as passing', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'OPEN', isDraft: false }),
        checks: makeChecks(['SUCCESS', 'SKIPPED']),
        hasActiveExecution: true,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.not.be.null
      expect(action!.type).to.equal('move_to_review')
    })
  })

  // =========================================================================
  // Rule 3: Stale ticket
  // =========================================================================
  describe('Rule 3: Ticket In Progress + no active agent → flag stale', () => {
    it('should flag ticket as stale when no agent and no PR', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: null,
        checks: [],
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.not.be.null
      expect(action!.type).to.equal('flag_stale')
    })

    it('should flag ticket as stale when no agent and PR is closed', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'CLOSED' }),
        checks: [],
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.not.be.null
      expect(action!.type).to.equal('flag_stale')
    })

    it('should NOT flag when agent is active', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: null,
        checks: [],
        hasActiveExecution: true,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.be.null
    })

    it('should NOT flag when PR is open', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'OPEN' }),
        checks: [],
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      // With open PR but no checks, no rule matches — null is fine
      expect(action?.type).to.not.equal('flag_stale')
    })
  })

  // =========================================================================
  // Rule 4: Closed PR → move to Backlog
  // =========================================================================
  describe('Rule 4: Ticket In Review + PR closed → move to Backlog', () => {
    it('should move to Backlog when PR is closed and ticket is in review', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Review' }),
        pr: makePR({ state: 'CLOSED' }),
        checks: [],
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.not.be.null
      expect(action!.type).to.equal('move_to_backlog')
      expect(action!.targetStatus).to.equal('Backlog')
    })

    it('should NOT move to Backlog when PR is open', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Review' }),
        pr: makePR({ state: 'OPEN' }),
        checks: [],
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      expect(action?.type).to.not.equal('move_to_backlog')
    })

    it('should NOT move to Backlog when ticket is not in review', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'CLOSED' }),
        checks: [],
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      // In Progress + closed PR + no agent → should be flagged stale, not moved to backlog
      expect(action?.type).to.not.equal('move_to_backlog')
    })
  })

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('Edge cases', () => {
    it('should return null when ticket is in backlog with no PR', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'backlog', statusName: 'Backlog' }),
        pr: null,
        checks: [],
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.be.null
    })

    it('should prioritize merged PR over other rules', () => {
      // Merged PR should move to Done even if ticket is in review
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Review' }),
        pr: makePR({ state: 'MERGED' }),
        checks: makeChecks(['SUCCESS']),
        hasActiveExecution: true,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.not.be.null
      expect(action!.type).to.equal('move_to_done')
    })

    it('should handle ticket with Review in custom status name', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'Code Review' }),
        pr: makePR({ state: 'CLOSED' }),
        checks: [],
        hasActiveExecution: false,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.not.be.null
      expect(action!.type).to.equal('move_to_backlog')
    })
  })
})
