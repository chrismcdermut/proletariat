import { expect } from 'chai'
import {
  detectWeirdStates,
  formatAlert,
  EscalationTracker,
} from '../../src/lib/reconcile/escalation.js'
import type {
  EscalationContext,
  EscalationIssue,
  EscalationThresholds,
} from '../../src/lib/reconcile/escalation.js'
import type { LinkedPR, ReconcileTicket } from '../../src/lib/reconcile/types.js'
import type { PRInfo } from '../../src/lib/pr/index.js'

/**
 * Tier 2→3 Escalation Tests (PRLT-1282)
 *
 * These tests exercise the pure escalation logic: weird state detection,
 * alert formatting, and cooldown tracking. No database, no gh CLI,
 * no shell-out to `prlt session poke`.
 */

// =============================================================================
// Helpers
// =============================================================================

const NOW = new Date('2026-04-18T12:00:00Z')

function makeTicket(overrides: Partial<ReconcileTicket> = {}): ReconcileTicket {
  return {
    id: 'TKT-001',
    title: 'Test ticket',
    projectId: 'proj-001',
    statusName: 'In Progress',
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
    state: 'OPEN',
    headBranch: 'PRLT-1/feat/test',
    baseBranch: 'main',
    isDraft: false,
    createdAt: '2026-04-10T12:00:00Z',
    updatedAt: '2026-04-10T12:00:00Z',
    ...overrides,
  }
}

function wrap(pr: PRInfo, source: LinkedPR['source'] = 'ticket_branch'): LinkedPR {
  return { pr, source }
}

const DEFAULT_THRESHOLDS: EscalationThresholds = {
  conflictDays: 3,
  noPrDays: 2,
  idleSessionMinutes: 30,
}

// =============================================================================
// detectWeirdStates
// =============================================================================

describe('Reconcile Escalation — detectWeirdStates', () => {
  describe('Case 1: PR closed but not merged', () => {
    it('detects a closed PR on a non-review ticket', () => {
      const issues = detectWeirdStates(
        makeTicket({ statusName: 'In Progress', statusCategory: 'started' }),
        [wrap(makePR({ state: 'CLOSED' }))],
        {},
        DEFAULT_THRESHOLDS,
        NOW,
      )
      expect(issues).to.have.lengthOf(1)
      expect(issues[0].issueType).to.equal('pr_closed_not_merged')
      expect(issues[0].summary).to.include('closed without merging')
    })

    it('does NOT flag a closed PR on a review ticket (handled deterministically)', () => {
      // Rule 2 handles In Review + closed PR → In Progress deterministically.
      // The escalation module should not fire for this case.
      const issues = detectWeirdStates(
        makeTicket({ statusName: 'In Review', statusCategory: 'started' }),
        [wrap(makePR({ state: 'CLOSED' }))],
        {},
        DEFAULT_THRESHOLDS,
        NOW,
      )
      // Should have no pr_closed_not_merged issue
      const closedIssues = issues.filter(i => i.issueType === 'pr_closed_not_merged')
      expect(closedIssues).to.have.lengthOf(0)
    })

    it('does not flag when an open PR also exists', () => {
      const issues = detectWeirdStates(
        makeTicket({ statusName: 'In Progress', statusCategory: 'started' }),
        [
          wrap(makePR({ number: 1, state: 'CLOSED' })),
          wrap(makePR({ number: 2, state: 'OPEN', updatedAt: NOW.toISOString() })),
        ],
        {},
        DEFAULT_THRESHOLDS,
        NOW,
      )
      const closedIssues = issues.filter(i => i.issueType === 'pr_closed_not_merged')
      expect(closedIssues).to.have.lengthOf(0)
    })
  })

  describe('Case 2: PR stale/conflicting for >N days', () => {
    it('detects a stale open PR beyond threshold', () => {
      // PR updated 5 days ago, threshold is 3 days
      const stalePR = makePR({
        state: 'OPEN',
        updatedAt: '2026-04-13T12:00:00Z', // 5 days before NOW
      })
      const issues = detectWeirdStates(
        makeTicket(),
        [wrap(stalePR)],
        {},
        DEFAULT_THRESHOLDS,
        NOW,
      )
      const staleIssues = issues.filter(i => i.issueType === 'pr_stale_conflict')
      expect(staleIssues).to.have.lengthOf(1)
      expect(staleIssues[0].summary).to.include('no activity for 5 days')
    })

    it('does NOT flag a recently updated open PR', () => {
      // PR updated today
      const freshPR = makePR({
        state: 'OPEN',
        updatedAt: '2026-04-18T10:00:00Z',
      })
      const issues = detectWeirdStates(
        makeTicket(),
        [wrap(freshPR)],
        {},
        DEFAULT_THRESHOLDS,
        NOW,
      )
      const staleIssues = issues.filter(i => i.issueType === 'pr_stale_conflict')
      expect(staleIssues).to.have.lengthOf(0)
    })

    it('respects custom conflict-days threshold', () => {
      // PR updated 2 days ago, custom threshold is 1 day
      const pr = makePR({
        state: 'OPEN',
        updatedAt: '2026-04-16T12:00:00Z', // 2 days before NOW
      })
      const issues = detectWeirdStates(
        makeTicket(),
        [wrap(pr)],
        {},
        { ...DEFAULT_THRESHOLDS, conflictDays: 1 },
        NOW,
      )
      const staleIssues = issues.filter(i => i.issueType === 'pr_stale_conflict')
      expect(staleIssues).to.have.lengthOf(1)
    })
  })

  describe('Case 3: Ticket in progress with no PR for >N days', () => {
    it('detects a stalled ticket with no PR', () => {
      const issues = detectWeirdStates(
        makeTicket({ statusName: 'In Progress', statusCategory: 'started' }),
        [], // no linked PRs
        { ticketUpdatedAt: '2026-04-15T12:00:00Z' }, // 3 days ago
        DEFAULT_THRESHOLDS,
        NOW,
      )
      expect(issues).to.have.lengthOf(1)
      expect(issues[0].issueType).to.equal('no_pr_stalled')
      expect(issues[0].summary).to.include('no linked PR')
    })

    it('does NOT flag a recently started ticket with no PR', () => {
      const issues = detectWeirdStates(
        makeTicket({ statusName: 'In Progress', statusCategory: 'started' }),
        [],
        { ticketUpdatedAt: '2026-04-17T12:00:00Z' }, // 1 day ago
        DEFAULT_THRESHOLDS,
        NOW,
      )
      const stalledIssues = issues.filter(i => i.issueType === 'no_pr_stalled')
      expect(stalledIssues).to.have.lengthOf(0)
    })

    it('does NOT flag a backlog ticket with no PR (not started)', () => {
      const issues = detectWeirdStates(
        makeTicket({ statusName: 'Backlog', statusCategory: 'backlog' }),
        [],
        { ticketUpdatedAt: '2026-04-10T12:00:00Z' },
        DEFAULT_THRESHOLDS,
        NOW,
      )
      const stalledIssues = issues.filter(i => i.issueType === 'no_pr_stalled')
      expect(stalledIssues).to.have.lengthOf(0)
    })

    it('does NOT fire without ticketUpdatedAt context', () => {
      const issues = detectWeirdStates(
        makeTicket({ statusName: 'In Progress', statusCategory: 'started' }),
        [],
        {}, // no ticketUpdatedAt
        DEFAULT_THRESHOLDS,
        NOW,
      )
      const stalledIssues = issues.filter(i => i.issueType === 'no_pr_stalled')
      expect(stalledIssues).to.have.lengthOf(0)
    })
  })

  describe('Case 4: Multiple open PRs', () => {
    it('detects multiple open PRs for the same ticket', () => {
      const issues = detectWeirdStates(
        makeTicket(),
        [
          wrap(makePR({ number: 1, state: 'OPEN', updatedAt: NOW.toISOString() })),
          wrap(makePR({ number: 2, state: 'OPEN', updatedAt: NOW.toISOString() })),
        ],
        {},
        DEFAULT_THRESHOLDS,
        NOW,
      )
      const multiIssues = issues.filter(i => i.issueType === 'multiple_open_prs')
      expect(multiIssues).to.have.lengthOf(1)
      expect(multiIssues[0].summary).to.include('2 open PRs')
      expect(multiIssues[0].summary).to.include('#1')
      expect(multiIssues[0].summary).to.include('#2')
    })

    it('does NOT flag a single open PR', () => {
      const issues = detectWeirdStates(
        makeTicket(),
        [wrap(makePR({ state: 'OPEN', updatedAt: NOW.toISOString() }))],
        {},
        DEFAULT_THRESHOLDS,
        NOW,
      )
      const multiIssues = issues.filter(i => i.issueType === 'multiple_open_prs')
      expect(multiIssues).to.have.lengthOf(0)
    })
  })

  describe('Case 5: Agent session idle', () => {
    it('detects an idle agent session beyond threshold', () => {
      const issues = detectWeirdStates(
        makeTicket(),
        [],
        {
          ticketUpdatedAt: NOW.toISOString(), // recently updated, so no_pr_stalled won't fire
          activeExecutions: [
            {
              agentName: 'agent-1',
              startedAt: new Date('2026-04-18T10:00:00Z'), // 2 hours ago
              sessionId: 'session-123',
            },
          ],
        },
        DEFAULT_THRESHOLDS,
        NOW,
      )
      const idleIssues = issues.filter(i => i.issueType === 'session_idle')
      expect(idleIssues).to.have.lengthOf(1)
      expect(idleIssues[0].summary).to.include('agent-1')
      expect(idleIssues[0].summary).to.include('120 minutes')
    })

    it('does NOT flag a recently started session', () => {
      const issues = detectWeirdStates(
        makeTicket(),
        [],
        {
          ticketUpdatedAt: NOW.toISOString(),
          activeExecutions: [
            {
              agentName: 'agent-1',
              startedAt: new Date('2026-04-18T11:50:00Z'), // 10 min ago
              sessionId: 'session-123',
            },
          ],
        },
        DEFAULT_THRESHOLDS,
        NOW,
      )
      const idleIssues = issues.filter(i => i.issueType === 'session_idle')
      expect(idleIssues).to.have.lengthOf(0)
    })
  })

  describe('Case 6: Ticket moved backward', () => {
    it('detects backward movement when ticket has PR metadata but no linked merged PR', () => {
      const issues = detectWeirdStates(
        makeTicket({
          statusName: 'In Progress',
          statusCategory: 'started',
          metadata: { pr_number: '42', pr_url: 'https://github.com/test/repo/pull/42' },
        }),
        [], // no linked PRs found anymore
        {},
        DEFAULT_THRESHOLDS,
        NOW,
      )
      const backwardIssues = issues.filter(i => i.issueType === 'ticket_backward')
      expect(backwardIssues).to.have.lengthOf(1)
      expect(backwardIssues[0].summary).to.include('backward movement')
    })

    it('does NOT flag backward if a merged PR is still linked', () => {
      const issues = detectWeirdStates(
        makeTicket({
          metadata: { pr_number: '42', pr_url: 'https://github.com/test/repo/pull/42' },
        }),
        [wrap(makePR({ state: 'MERGED' }))],
        {},
        DEFAULT_THRESHOLDS,
        NOW,
      )
      // This ticket has a merged PR → deterministic rule 1 fires, so
      // detectWeirdStates wouldn't be called in practice.
      // But even if called, it should not flag backward movement.
      const backwardIssues = issues.filter(i => i.issueType === 'ticket_backward')
      expect(backwardIssues).to.have.lengthOf(0)
    })

    it('does NOT flag completed tickets', () => {
      const issues = detectWeirdStates(
        makeTicket({
          statusName: 'Done',
          statusCategory: 'completed',
          metadata: { pr_number: '42', pr_url: 'https://github.com/test/repo/pull/42' },
        }),
        [],
        {},
        DEFAULT_THRESHOLDS,
        NOW,
      )
      const backwardIssues = issues.filter(i => i.issueType === 'ticket_backward')
      expect(backwardIssues).to.have.lengthOf(0)
    })
  })

  describe('No issues for clean state', () => {
    it('returns empty array when nothing is weird', () => {
      // A ticket with a fresh open PR — nothing weird
      const issues = detectWeirdStates(
        makeTicket(),
        [wrap(makePR({ state: 'OPEN', updatedAt: NOW.toISOString() }))],
        {},
        DEFAULT_THRESHOLDS,
        NOW,
      )
      expect(issues).to.have.lengthOf(0)
    })

    it('returns empty for no PRs and no started category', () => {
      const issues = detectWeirdStates(
        makeTicket({ statusName: 'Backlog', statusCategory: 'backlog' }),
        [],
        {},
        DEFAULT_THRESHOLDS,
        NOW,
      )
      expect(issues).to.have.lengthOf(0)
    })
  })

  describe('uses external key in alert when available', () => {
    it('uses externalKey for ticketId in issues', () => {
      const issues = detectWeirdStates(
        makeTicket({ statusName: 'In Progress', statusCategory: 'started' }),
        [],
        { ticketUpdatedAt: '2026-04-10T12:00:00Z', externalKey: 'PRLT-1191' },
        DEFAULT_THRESHOLDS,
        NOW,
      )
      expect(issues.length).to.be.greaterThan(0)
      expect(issues[0].ticketId).to.equal('PRLT-1191')
    })
  })
})

// =============================================================================
// formatAlert
// =============================================================================

describe('Reconcile Escalation — formatAlert', () => {
  it('formats a PR-related issue with all required fields', () => {
    const issue: EscalationIssue = {
      ticketId: 'PRLT-1191',
      ticketTitle: 'Fix auth middleware',
      issueType: 'pr_stale_conflict',
      summary: 'PR #1066 has had no activity for 9 days (possible merge conflicts)',
      currentState: 'In Progress',
      pr: {
        number: 1066,
        state: 'OPEN',
        url: 'https://github.com/chrismcdermut/proletariat/pull/1066',
      },
      age: '9 days since last activity',
      suggestedActions: [
        'Spawn rebase agent: prlt work start PRLT-1191 --action implement',
        'Close PR and move ticket to Backlog: gh pr close 1066 && prlt ticket move PRLT-1191 Backlog',
        'Escalate to human (reply in conversation)',
      ],
    }

    const alert = formatAlert(issue)

    expect(alert).to.include('Reconciler alert: PRLT-1191')
    expect(alert).to.include('State: In Progress')
    expect(alert).to.include('PR: #1066 (OPEN)')
    expect(alert).to.include('https://github.com/chrismcdermut/proletariat/pull/1066')
    expect(alert).to.include('Age: 9 days since last activity')
    expect(alert).to.include('Issue: PR #1066 has had no activity')
    expect(alert).to.include('Suggested actions:')
    expect(alert).to.include('  1. Spawn rebase agent')
    expect(alert).to.include('  2. Close PR')
    expect(alert).to.include('  3. Escalate to human')
  })

  it('formats a no-PR issue', () => {
    const issue: EscalationIssue = {
      ticketId: 'PRLT-1282',
      ticketTitle: 'Stalled ticket',
      issueType: 'no_pr_stalled',
      summary: 'Ticket has been in In Progress for 5 days with no linked PR',
      currentState: 'In Progress',
      age: '5 days in In Progress',
      suggestedActions: [
        'Check for stuck agent',
        'Move to Backlog',
      ],
    }

    const alert = formatAlert(issue)

    expect(alert).to.include('Reconciler alert: PRLT-1282')
    expect(alert).to.include('PR: none')
    expect(alert).to.include('Age: 5 days')
  })
})

// =============================================================================
// EscalationTracker (cooldown/dedup)
// =============================================================================

describe('Reconcile Escalation — EscalationTracker', () => {
  it('is not in cooldown for a fresh issue', () => {
    const tracker = new EscalationTracker(30)
    expect(tracker.isInCooldown('TKT-001', 'pr_stale_conflict', NOW)).to.be.false
  })

  it('enters cooldown after a poke is recorded', () => {
    const tracker = new EscalationTracker(30)
    tracker.recordPoke('TKT-001', 'pr_stale_conflict', NOW)
    expect(tracker.isInCooldown('TKT-001', 'pr_stale_conflict', NOW)).to.be.true
  })

  it('cooldown expires after the configured period', () => {
    const tracker = new EscalationTracker(30)
    tracker.recordPoke('TKT-001', 'pr_stale_conflict', NOW)

    // 29 minutes later — still in cooldown
    const almostExpired = new Date(NOW.getTime() + 29 * 60 * 1000)
    expect(tracker.isInCooldown('TKT-001', 'pr_stale_conflict', almostExpired)).to.be.true

    // 31 minutes later — cooldown expired
    const expired = new Date(NOW.getTime() + 31 * 60 * 1000)
    expect(tracker.isInCooldown('TKT-001', 'pr_stale_conflict', expired)).to.be.false
  })

  it('tracks different issue types independently', () => {
    const tracker = new EscalationTracker(30)
    tracker.recordPoke('TKT-001', 'pr_stale_conflict', NOW)

    // Same ticket, different issue type — not in cooldown
    expect(tracker.isInCooldown('TKT-001', 'no_pr_stalled', NOW)).to.be.false

    // Same issue type, different ticket — not in cooldown
    expect(tracker.isInCooldown('TKT-002', 'pr_stale_conflict', NOW)).to.be.false
  })

  it('clear() resets all cooldown state', () => {
    const tracker = new EscalationTracker(30)
    tracker.recordPoke('TKT-001', 'pr_stale_conflict', NOW)
    expect(tracker.isInCooldown('TKT-001', 'pr_stale_conflict', NOW)).to.be.true

    tracker.clear()
    expect(tracker.isInCooldown('TKT-001', 'pr_stale_conflict', NOW)).to.be.false
  })
})

// =============================================================================
// Integration: deterministic cases should NOT produce escalation issues
// =============================================================================

describe('Reconcile Escalation — deterministic cases produce no issues', () => {
  it('merged PR ticket produces no escalation issues', () => {
    // A merged PR is handled by rule 1 (→ Done). detectWeirdStates
    // should produce no issues for this state.
    const issues = detectWeirdStates(
      makeTicket({ statusName: 'In Review', statusCategory: 'started' }),
      [wrap(makePR({ state: 'MERGED' }))],
      {},
      DEFAULT_THRESHOLDS,
      NOW,
    )
    // Merged PR → no weird state (deterministic rule handles it)
    expect(issues).to.have.lengthOf(0)
  })

  it('closed PR on a review ticket produces no escalation issues', () => {
    // Rule 2 handles: review + all closed → In Progress.
    // The escalation module should not flag this.
    const issues = detectWeirdStates(
      makeTicket({ statusName: 'In Review', statusCategory: 'started' }),
      [wrap(makePR({ state: 'CLOSED' }))],
      {},
      DEFAULT_THRESHOLDS,
      NOW,
    )
    const closedIssues = issues.filter(i => i.issueType === 'pr_closed_not_merged')
    expect(closedIssues).to.have.lengthOf(0)
  })

  it('ticket already in expected state produces no issues', () => {
    const issues = detectWeirdStates(
      makeTicket({ statusName: 'Done', statusCategory: 'completed' }),
      [wrap(makePR({ state: 'MERGED' }))],
      {},
      DEFAULT_THRESHOLDS,
      NOW,
    )
    expect(issues).to.have.lengthOf(0)
  })
})
