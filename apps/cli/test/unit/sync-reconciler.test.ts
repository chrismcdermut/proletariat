import { expect } from 'chai'
import {
  reconcileTicket,
  reconcileAgentSpawned,
  detectDuplicates,
  detectStaleTriage,
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

    it('should move to Review even when checks are failing (PR opened rule)', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'OPEN' }),
        checks: makeChecks(['SUCCESS', 'FAILURE']),
        hasActiveExecution: true,
      }

      const action = reconcileTicket(ctx)
      // Rule 2b: PR opened → Review fires even without green CI
      expect(action).to.not.be.null
      expect(action!.type).to.equal('move_to_review')
      expect(action!.reason).to.include('opened for review')
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

    it('should move to Review when there are no checks (PR opened rule)', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'OPEN' }),
        checks: [],
        hasActiveExecution: true,
      }

      const action = reconcileTicket(ctx)
      // Rule 2b: PR opened → Review fires even without CI checks
      expect(action).to.not.be.null
      expect(action!.type).to.equal('move_to_review')
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

  // =========================================================================
  // Rule 2b: PR opened (no CI checks) → move to Review
  // =========================================================================
  describe('Rule 2b: PR opened (no CI) + ticket In Progress → move to Review', () => {
    it('should move to Review when PR is open and not draft, even without CI checks', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'OPEN', isDraft: false }),
        checks: [],
        hasActiveExecution: true,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.not.be.null
      expect(action!.type).to.equal('move_to_review')
      expect(action!.reason).to.include('opened for review')
    })

    it('should NOT move to Review when PR is draft', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'OPEN', isDraft: true }),
        checks: [],
        hasActiveExecution: true,
      }

      const action = reconcileTicket(ctx)
      expect(action?.type).to.not.equal('move_to_review')
    })

    it('should prefer CI green reason over generic PR opened reason', () => {
      const ctx: ReconcileContext = {
        ticket: makeTicket({ statusCategory: 'started', statusName: 'In Progress' }),
        pr: makePR({ state: 'OPEN', isDraft: false }),
        checks: makeChecks(['SUCCESS']),
        hasActiveExecution: true,
      }

      const action = reconcileTicket(ctx)
      expect(action).to.not.be.null
      expect(action!.type).to.equal('move_to_review')
      expect(action!.reason).to.include('CI checks passing')
    })
  })
})

// =============================================================================
// Board-Level Reconciliation Tests
// =============================================================================

describe('Board-Level Reconciliation', () => {
  // =========================================================================
  // Agent Spawned → In Progress
  // =========================================================================
  describe('reconcileAgentSpawned', () => {
    it('should move backlog ticket to In Progress when agent is running', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', statusCategory: 'backlog', statusName: 'Backlog' }),
      ]
      const activeAgentTicketIds = new Set(['TKT-001'])

      const actions = reconcileAgentSpawned(tickets, activeAgentTicketIds)
      expect(actions).to.have.length(1)
      expect(actions[0].type).to.equal('move_to_in_progress')
      expect(actions[0].ticketId).to.equal('TKT-001')
      expect(actions[0].targetStatus).to.equal('In Progress')
    })

    it('should move unstarted ticket to In Progress when agent is running', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', statusCategory: 'unstarted', statusName: 'Ready' }),
      ]
      const activeAgentTicketIds = new Set(['TKT-001'])

      const actions = reconcileAgentSpawned(tickets, activeAgentTicketIds)
      expect(actions).to.have.length(1)
      expect(actions[0].type).to.equal('move_to_in_progress')
    })

    it('should move triage ticket to In Progress when agent is running', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', statusCategory: 'triage', statusName: 'Triage' }),
      ]
      const activeAgentTicketIds = new Set(['TKT-001'])

      const actions = reconcileAgentSpawned(tickets, activeAgentTicketIds)
      expect(actions).to.have.length(1)
      expect(actions[0].type).to.equal('move_to_in_progress')
    })

    it('should NOT move already started ticket', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', statusCategory: 'started', statusName: 'In Progress' }),
      ]
      const activeAgentTicketIds = new Set(['TKT-001'])

      const actions = reconcileAgentSpawned(tickets, activeAgentTicketIds)
      expect(actions).to.have.length(0)
    })

    it('should NOT move ticket when no agent is running', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', statusCategory: 'backlog', statusName: 'Backlog' }),
      ]
      const activeAgentTicketIds = new Set<string>()

      const actions = reconcileAgentSpawned(tickets, activeAgentTicketIds)
      expect(actions).to.have.length(0)
    })

    it('should handle multiple tickets with agents', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', statusCategory: 'backlog', statusName: 'Backlog' }),
        makeTicket({ id: 'TKT-002', statusCategory: 'unstarted', statusName: 'Ready' }),
        makeTicket({ id: 'TKT-003', statusCategory: 'started', statusName: 'In Progress' }),
      ]
      const activeAgentTicketIds = new Set(['TKT-001', 'TKT-002', 'TKT-003'])

      const actions = reconcileAgentSpawned(tickets, activeAgentTicketIds)
      expect(actions).to.have.length(2) // Only TKT-001 and TKT-002
    })
  })

  // =========================================================================
  // Duplicate Detection
  // =========================================================================
  describe('detectDuplicates', () => {
    it('should detect tickets with identical titles', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', title: 'Fix login bug', createdAt: new Date('2024-01-01') }),
        makeTicket({ id: 'TKT-002', title: 'Fix login bug', createdAt: new Date('2024-01-02') }),
      ]

      const actions = detectDuplicates(tickets)
      expect(actions).to.have.length(1)
      expect(actions[0].type).to.equal('flag_duplicate')
      expect(actions[0].ticketId).to.equal('TKT-002') // Newer ticket flagged
      expect(actions[0].reason).to.include('TKT-001')
    })

    it('should detect duplicates after normalizing prefixes', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', title: 'PRLT-123: Fix login bug', createdAt: new Date('2024-01-01') }),
        makeTicket({ id: 'TKT-002', title: 'Fix login bug', createdAt: new Date('2024-01-02') }),
      ]

      const actions = detectDuplicates(tickets)
      expect(actions).to.have.length(1)
      expect(actions[0].type).to.equal('flag_duplicate')
    })

    it('should NOT flag completed/canceled tickets as duplicates', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', title: 'Fix login bug', statusCategory: 'completed', createdAt: new Date('2024-01-01') }),
        makeTicket({ id: 'TKT-002', title: 'Fix login bug', statusCategory: 'started', createdAt: new Date('2024-01-02') }),
      ]

      const actions = detectDuplicates(tickets)
      expect(actions).to.have.length(0)
    })

    it('should NOT flag tickets with different titles', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', title: 'Fix login bug', createdAt: new Date('2024-01-01') }),
        makeTicket({ id: 'TKT-002', title: 'Add signup feature', createdAt: new Date('2024-01-02') }),
      ]

      const actions = detectDuplicates(tickets)
      expect(actions).to.have.length(0)
    })

    it('should flag the newer duplicate, not the older one', () => {
      const tickets = [
        makeTicket({ id: 'TKT-002', title: 'Fix login bug', createdAt: new Date('2024-01-02') }),
        makeTicket({ id: 'TKT-001', title: 'Fix login bug', createdAt: new Date('2024-01-01') }),
      ]

      const actions = detectDuplicates(tickets)
      expect(actions).to.have.length(1)
      expect(actions[0].ticketId).to.equal('TKT-002') // Newer flagged regardless of order
    })
  })

  // =========================================================================
  // Stale Triage Detection
  // =========================================================================
  describe('detectStaleTriage', () => {
    it('should flag backlog ticket whose branch has a merged PR', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', statusCategory: 'backlog', statusName: 'Backlog', branch: 'PRLT-100/feat/test' }),
      ]
      const mergedBranches = new Set(['PRLT-100/feat/test'])

      const actions = detectStaleTriage(tickets, mergedBranches)
      expect(actions).to.have.length(1)
      expect(actions[0].type).to.equal('flag_stale_triage')
      expect(actions[0].ticketId).to.equal('TKT-001')
      expect(actions[0].reason).to.include('merged PR')
    })

    it('should flag triage ticket whose branch has a merged PR', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', statusCategory: 'triage', statusName: 'Triage', branch: 'PRLT-100/feat/test' }),
      ]
      const mergedBranches = new Set(['PRLT-100/feat/test'])

      const actions = detectStaleTriage(tickets, mergedBranches)
      expect(actions).to.have.length(1)
      expect(actions[0].type).to.equal('flag_stale_triage')
    })

    it('should flag unstarted ticket whose branch has a merged PR', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', statusCategory: 'unstarted', statusName: 'Ready', branch: 'PRLT-100/feat/test' }),
      ]
      const mergedBranches = new Set(['PRLT-100/feat/test'])

      const actions = detectStaleTriage(tickets, mergedBranches)
      expect(actions).to.have.length(1)
    })

    it('should NOT flag started ticket', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', statusCategory: 'started', statusName: 'In Progress', branch: 'PRLT-100/feat/test' }),
      ]
      const mergedBranches = new Set(['PRLT-100/feat/test'])

      const actions = detectStaleTriage(tickets, mergedBranches)
      expect(actions).to.have.length(0)
    })

    it('should NOT flag ticket without a branch', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', statusCategory: 'backlog', statusName: 'Backlog' }),
      ]
      const mergedBranches = new Set(['PRLT-100/feat/test'])

      const actions = detectStaleTriage(tickets, mergedBranches)
      expect(actions).to.have.length(0)
    })

    it('should NOT flag ticket whose branch has no merged PR', () => {
      const tickets = [
        makeTicket({ id: 'TKT-001', statusCategory: 'backlog', statusName: 'Backlog', branch: 'PRLT-200/feat/other' }),
      ]
      const mergedBranches = new Set(['PRLT-100/feat/test'])

      const actions = detectStaleTriage(tickets, mergedBranches)
      expect(actions).to.have.length(0)
    })
  })
})
