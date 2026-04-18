import { expect } from 'chai'
import {
  validateActionState,
  resolveTicketIntent,
} from '../../src/lib/work-lifecycle/action-guardrails.js'
import type { WorkAction } from '../../src/lib/pmo/types.js'
import type { StateCategory } from '../../src/lib/pmo/types.js'

/**
 * Build a minimal WorkAction for testing guardrails.
 */
function makeAction(overrides: Partial<WorkAction> = {}): WorkAction {
  return {
    id: 'test-action',
    name: 'Test Action',
    prompt: 'do something',
    modifiesCode: true,
    isBuiltin: false,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('action-guardrails (PRLT-1317)', () => {
  // ---------------------------------------------------------------------------
  // resolveTicketIntent
  // ---------------------------------------------------------------------------

  describe('resolveTicketIntent', () => {
    it('resolves "In Progress" to "started"', () => {
      expect(resolveTicketIntent('In Progress', undefined)).to.equal('started')
    })

    it('resolves "Review" to "needs_review"', () => {
      expect(resolveTicketIntent('Review', undefined)).to.equal('needs_review')
    })

    it('resolves "Done" to "completed"', () => {
      expect(resolveTicketIntent('Done', undefined)).to.equal('completed')
    })

    it('resolves "Backlog" to "backlog"', () => {
      expect(resolveTicketIntent('Backlog', undefined)).to.equal('backlog')
    })

    it('resolves "To Do" to "ready"', () => {
      expect(resolveTicketIntent('To Do', undefined)).to.equal('ready')
    })

    it('resolves "Blocked" to "paused"', () => {
      expect(resolveTicketIntent('Blocked', undefined)).to.equal('paused')
    })

    it('resolves "Canceled" to "dropped"', () => {
      expect(resolveTicketIntent('Canceled', undefined)).to.equal('dropped')
    })

    it('is case-insensitive', () => {
      expect(resolveTicketIntent('in progress', undefined)).to.equal('started')
      expect(resolveTicketIntent('IN PROGRESS', undefined)).to.equal('started')
    })

    it('falls back to category when statusName is unrecognized', () => {
      expect(resolveTicketIntent('Custom Column', 'started' as StateCategory)).to.equal('started')
    })

    it('falls back to category when statusName is undefined', () => {
      expect(resolveTicketIntent(undefined, 'backlog' as StateCategory)).to.equal('backlog')
    })

    it('maps "unstarted" category to "ready" intent', () => {
      expect(resolveTicketIntent(undefined, 'unstarted' as StateCategory)).to.equal('ready')
    })

    it('maps "canceled" category to "dropped" intent', () => {
      expect(resolveTicketIntent(undefined, 'canceled' as StateCategory)).to.equal('dropped')
    })

    it('maps "triage" category to "backlog" intent', () => {
      expect(resolveTicketIntent(undefined, 'triage' as StateCategory)).to.equal('backlog')
    })

    it('returns null when both statusName and category are undefined', () => {
      expect(resolveTicketIntent(undefined, undefined)).to.equal(null)
    })
  })

  // ---------------------------------------------------------------------------
  // validateActionState — allowed cases
  // ---------------------------------------------------------------------------

  describe('validateActionState — allowed', () => {
    it('allows when valid_from is undefined (any state)', () => {
      const action = makeAction({ validFrom: undefined })
      const result = validateActionState(action, 'In Progress', 'started')
      expect(result.allowed).to.equal(true)
    })

    it('allows when valid_from is empty array (any state)', () => {
      const action = makeAction({ validFrom: [] })
      const result = validateActionState(action, 'In Progress', 'started')
      expect(result.allowed).to.equal(true)
    })

    it('allows when ticket state matches one of valid_from intents', () => {
      const action = makeAction({ validFrom: ['ready', 'backlog', 'started'] })
      const result = validateActionState(action, 'In Progress', 'started')
      expect(result.allowed).to.equal(true)
    })

    it('allows when ticket state matches via statusName alias', () => {
      const action = makeAction({ validFrom: ['ready'] })
      const result = validateActionState(action, 'To Do', 'unstarted')
      expect(result.allowed).to.equal(true)
    })

    it('allows when --force is true even if state is invalid', () => {
      const action = makeAction({ validFrom: ['ready'] })
      const result = validateActionState(action, 'Done', 'completed', true)
      expect(result.allowed).to.equal(true)
    })

    it('allows when intent cannot be resolved (unknown state)', () => {
      const action = makeAction({ validFrom: ['ready'] })
      const result = validateActionState(action, undefined, undefined)
      expect(result.allowed).to.equal(true)
    })
  })

  // ---------------------------------------------------------------------------
  // validateActionState — blocked cases
  // ---------------------------------------------------------------------------

  describe('validateActionState — blocked', () => {
    it('blocks when ticket state does not match valid_from', () => {
      const action = makeAction({ name: 'Implement', validFrom: ['ready', 'backlog'] })
      const result = validateActionState(action, 'Done', 'completed')
      expect(result.allowed).to.equal(false)
      expect(result.message).to.include('Implement')
      expect(result.message).to.include('completed')
      expect(result.message).to.include('ready, backlog')
      expect(result.message).to.include('--force')
    })

    it('blocks review action when ticket is in backlog', () => {
      const action = makeAction({ name: 'Code Review', validFrom: ['needs_review'] })
      const result = validateActionState(action, 'Backlog', 'backlog')
      expect(result.allowed).to.equal(false)
      expect(result.resolvedIntent).to.equal('backlog')
    })

    it('blocks merge action when ticket is in started state', () => {
      const action = makeAction({ name: 'Merge', validFrom: ['needs_review'] })
      const result = validateActionState(action, 'In Progress', 'started')
      expect(result.allowed).to.equal(false)
      expect(result.resolvedIntent).to.equal('started')
    })

    it('includes current state name in error message', () => {
      const action = makeAction({ name: 'Merge', validFrom: ['needs_review'] })
      const result = validateActionState(action, 'In Progress', 'started')
      expect(result.message).to.include('"In Progress"')
    })
  })

  // ---------------------------------------------------------------------------
  // Default action guardrails
  // ---------------------------------------------------------------------------

  describe('default action guardrail values', () => {
    it('implement allows ready, backlog, started', () => {
      const action = makeAction({
        name: 'Implement',
        validFrom: ['ready', 'backlog', 'started'],
      })

      // Allowed from ready
      expect(validateActionState(action, 'To Do', 'unstarted').allowed).to.equal(true)
      // Allowed from backlog
      expect(validateActionState(action, 'Backlog', 'backlog').allowed).to.equal(true)
      // Allowed from started (continue)
      expect(validateActionState(action, 'In Progress', 'started').allowed).to.equal(true)
      // Blocked from completed
      expect(validateActionState(action, 'Done', 'completed').allowed).to.equal(false)
      // Blocked from needs_review
      expect(validateActionState(action, 'Review', 'started').allowed).to.equal(false)
    })

    it('review only allows needs_review', () => {
      const action = makeAction({
        name: 'Code Review',
        validFrom: ['needs_review'],
      })

      // Allowed from review
      expect(validateActionState(action, 'Review', 'started').allowed).to.equal(true)
      // Blocked from ready
      expect(validateActionState(action, 'To Do', 'unstarted').allowed).to.equal(false)
      // Blocked from backlog
      expect(validateActionState(action, 'Backlog', 'backlog').allowed).to.equal(false)
    })

    it('merge only allows needs_review', () => {
      const action = makeAction({
        name: 'Merge',
        validFrom: ['needs_review'],
      })

      // Allowed from review
      expect(validateActionState(action, 'In Review', 'started').allowed).to.equal(true)
      // Blocked from started
      expect(validateActionState(action, 'In Progress', 'started').allowed).to.equal(false)
    })

    it('groom allows any state (null valid_from)', () => {
      const action = makeAction({
        name: 'Groom',
        validFrom: undefined,
      })

      expect(validateActionState(action, 'Backlog', 'backlog').allowed).to.equal(true)
      expect(validateActionState(action, 'In Progress', 'started').allowed).to.equal(true)
      expect(validateActionState(action, 'Done', 'completed').allowed).to.equal(true)
    })

    it('resolve allows any state (null valid_from)', () => {
      const action = makeAction({
        name: 'Resolve',
        validFrom: undefined,
      })

      expect(validateActionState(action, 'Backlog', 'backlog').allowed).to.equal(true)
      expect(validateActionState(action, 'Review', 'started').allowed).to.equal(true)
    })
  })

  // ---------------------------------------------------------------------------
  // --force bypass
  // ---------------------------------------------------------------------------

  describe('--force bypass', () => {
    it('bypasses all guardrails when force is true', () => {
      const action = makeAction({ validFrom: ['needs_review'] })
      // Would normally be blocked
      const result = validateActionState(action, 'Backlog', 'backlog', true)
      expect(result.allowed).to.equal(true)
      expect(result.message).to.equal(undefined)
    })

    it('force has no effect when guardrails would allow anyway', () => {
      const action = makeAction({ validFrom: ['started'] })
      const result = validateActionState(action, 'In Progress', 'started', true)
      expect(result.allowed).to.equal(true)
    })
  })
})
