import { expect } from 'chai'
import {
  runWithInternalAction,
  INTERNAL_ACTION_ENV,
} from '../../src/lib/orchestrate/actions.js'

/**
 * Tests for runWithInternalAction — the orchestrator-side helper introduced in
 * PRLT-1316 to propagate the action selection to a subprocess via the
 * PRLT_INTERNAL_ACTION env var (since `--action` is no longer a CLI flag).
 *
 * The helper must:
 *   - set the env var for the duration of the callback,
 *   - restore whatever was there (including undefined) afterward,
 *   - not swallow exceptions from the callback.
 */
describe('runWithInternalAction (PRLT-1316)', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env[INTERNAL_ACTION_ENV]
    delete process.env[INTERNAL_ACTION_ENV]
  })

  afterEach(() => {
    if (original === undefined) {
      delete process.env[INTERNAL_ACTION_ENV]
    } else {
      process.env[INTERNAL_ACTION_ENV] = original
    }
  })

  it('exposes PRLT_INTERNAL_ACTION inside the callback', () => {
    let captured: string | undefined
    runWithInternalAction('review', () => {
      captured = process.env[INTERNAL_ACTION_ENV]
    })
    expect(captured).to.equal('review')
  })

  it('clears the env var after the callback when it was unset before', () => {
    runWithInternalAction('groom', () => {
      // nothing
    })
    expect(process.env[INTERNAL_ACTION_ENV]).to.be.undefined
  })

  it('restores the prior env value instead of blanking it', () => {
    process.env[INTERNAL_ACTION_ENV] = 'original-value'
    runWithInternalAction('revise', () => {
      expect(process.env[INTERNAL_ACTION_ENV]).to.equal('revise')
    })
    expect(process.env[INTERNAL_ACTION_ENV]).to.equal('original-value')
  })

  it('still restores the env var when the callback throws', () => {
    expect(() =>
      runWithInternalAction('resolve', () => {
        throw new Error('boom')
      })
    ).to.throw('boom')
    // env var must be cleaned up even on exception path
    expect(process.env[INTERNAL_ACTION_ENV]).to.be.undefined
  })

  it('returns the callback result', () => {
    const result = runWithInternalAction('review', () => 42)
    expect(result).to.equal(42)
  })

  it('isolates nested invocations: inner overrides and restores outer', () => {
    const trace: Array<string | undefined> = []
    runWithInternalAction('review', () => {
      trace.push(process.env[INTERNAL_ACTION_ENV])
      runWithInternalAction('revise', () => {
        trace.push(process.env[INTERNAL_ACTION_ENV])
      })
      trace.push(process.env[INTERNAL_ACTION_ENV])
    })
    expect(trace).to.deep.equal(['review', 'revise', 'review'])
    expect(process.env[INTERNAL_ACTION_ENV]).to.be.undefined
  })
})
