import { expect } from 'chai'
import {
  setInternalAction,
  resolveInternalAction,
  resolveActionId,
  __clearInternalActionForTests,
} from '../../src/services/action-context.js'

/**
 * Tests for the internal action-context channel introduced in PRLT-1316
 * when the user-facing `--action` flag was removed from `work start`.
 *
 * The channel has two carriers:
 *   1. In-process slot (set via setInternalAction, cleared on first read)
 *   2. PRLT_INTERNAL_ACTION env var (read as a fallback, NOT cleared —
 *      it survives subprocess boundaries and the parent decides its lifetime)
 *
 * All tests reset both carriers in beforeEach to prevent leakage between cases.
 */
describe('action-context (PRLT-1316)', () => {
  const ENV_VAR = 'PRLT_INTERNAL_ACTION'
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env[ENV_VAR]
    delete process.env[ENV_VAR]
    __clearInternalActionForTests()
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_VAR]
    } else {
      process.env[ENV_VAR] = originalEnv
    }
    __clearInternalActionForTests()
  })

  // ---------------------------------------------------------------------------
  // resolveInternalAction — raw channel
  // ---------------------------------------------------------------------------

  describe('resolveInternalAction', () => {
    it('returns null when nothing is set', () => {
      expect(resolveInternalAction()).to.equal(null)
    })

    it('returns value set via setInternalAction', () => {
      setInternalAction('review')
      expect(resolveInternalAction()).to.equal('review')
    })

    it('single-use: clears the in-process slot after reading', () => {
      setInternalAction('groom')
      expect(resolveInternalAction()).to.equal('groom')
      // Second call returns null — value was consumed
      expect(resolveInternalAction()).to.equal(null)
    })

    it('falls back to PRLT_INTERNAL_ACTION env var when in-process slot is empty', () => {
      process.env[ENV_VAR] = 'resolve'
      expect(resolveInternalAction()).to.equal('resolve')
    })

    it('env var is NOT cleared by a read (survives subprocess lifetime)', () => {
      process.env[ENV_VAR] = 'revise'
      resolveInternalAction()
      // env var remains — the subprocess parent owns its lifetime
      expect(process.env[ENV_VAR]).to.equal('revise')
    })

    it('in-process slot wins over env var when both are set', () => {
      process.env[ENV_VAR] = 'implement'
      setInternalAction('review')
      expect(resolveInternalAction()).to.equal('review')
    })

    it('after in-process read, falls through to env var on next call', () => {
      process.env[ENV_VAR] = 'revise'
      setInternalAction('review')
      // First call drains the in-process slot
      expect(resolveInternalAction()).to.equal('review')
      // Second call falls back to env var
      expect(resolveInternalAction()).to.equal('revise')
    })
  })

  // ---------------------------------------------------------------------------
  // resolveActionId — defaulting helper used by work start
  // ---------------------------------------------------------------------------

  describe('resolveActionId', () => {
    it('returns explicit when provided (used by service-layer callers)', () => {
      expect(resolveActionId('groom')).to.equal('groom')
    })

    it('explicit wins even when internal slot is set', () => {
      setInternalAction('review')
      expect(resolveActionId('groom')).to.equal('groom')
    })

    it('falls back to internal action when explicit is undefined', () => {
      setInternalAction('review')
      expect(resolveActionId(undefined)).to.equal('review')
    })

    it('defaults to "implement" when nothing is set', () => {
      expect(resolveActionId(undefined)).to.equal('implement')
    })

    it('honors a custom fallback', () => {
      expect(resolveActionId(undefined, 'custom-default')).to.equal('custom-default')
    })

    it('explicit overrides fallback', () => {
      expect(resolveActionId('review', 'implement')).to.equal('review')
    })

    it('falls back to env var before defaulting to "implement"', () => {
      process.env[ENV_VAR] = 'resolve'
      expect(resolveActionId(undefined)).to.equal('resolve')
    })
  })

  // ---------------------------------------------------------------------------
  // Regression — the scenario PRLT-1316 exists to prevent
  // ---------------------------------------------------------------------------

  describe('regression: state does not leak across unrelated work-start invocations', () => {
    it('a stale in-process value from a previous command cannot dirty the next run', () => {
      // Sibling verb sets then reads the action — typical flow
      setInternalAction('review')
      const first = resolveActionId(undefined)
      expect(first).to.equal('review')

      // A subsequent, unrelated `work start` call sees no leaked state
      const second = resolveActionId(undefined)
      expect(second).to.equal('implement')
    })
  })
})
