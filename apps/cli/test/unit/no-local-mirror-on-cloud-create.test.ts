import { expect } from 'chai'
import { resolveMirrorToPmo } from '../../src/lib/external-issues/work-start.js'

/**
 * Regression test for PRLT-1167: mirror-to-pmo defaults to disabled for work start.
 */
describe('mirror-to-pmo defaults (PRLT-1167)', () => {
  describe('mirror-to-pmo defaults to disabled for work start', () => {
    it('defaults to disabled when no flag, env, or config is set', () => {
      const result = resolveMirrorToPmo({})
      expect(result.enabled).to.be.false
      expect(result.source).to.equal('default')
    })

    it('respects explicit flag override to disable', () => {
      const result = resolveMirrorToPmo({ flagValue: false })
      expect(result.enabled).to.be.false
      expect(result.source).to.equal('flag')
    })

    it('respects explicit flag override to enable', () => {
      const result = resolveMirrorToPmo({ flagValue: true })
      expect(result.enabled).to.be.true
      expect(result.source).to.equal('flag')
    })

    it('respects env override', () => {
      const result = resolveMirrorToPmo({ envValue: false })
      expect(result.enabled).to.be.false
      expect(result.source).to.equal('env')
    })

    it('respects config override', () => {
      const result = resolveMirrorToPmo({ configValue: false })
      expect(result.enabled).to.be.false
      expect(result.source).to.equal('config')
    })
  })
})
