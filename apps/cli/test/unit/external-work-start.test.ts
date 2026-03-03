import { expect } from 'chai'
import { resolveMirrorToPmo } from '../../src/lib/external-issues/work-start.js'

describe('resolveMirrorToPmo', () => {
  it('uses explicit flag when provided', () => {
    expect(resolveMirrorToPmo({ flagValue: false, envValue: true, configValue: true })).to.deep.equal({
      enabled: false,
      source: 'flag',
    })
  })

  it('falls back to environment default', () => {
    expect(resolveMirrorToPmo({ envValue: false, configValue: true })).to.deep.equal({
      enabled: false,
      source: 'env',
    })
  })

  it('falls back to config default', () => {
    expect(resolveMirrorToPmo({ envValue: null, configValue: true })).to.deep.equal({
      enabled: true,
      source: 'config',
    })
  })

  it('defaults to enabled when nothing is set', () => {
    expect(resolveMirrorToPmo({})).to.deep.equal({
      enabled: true,
      source: 'default',
    })
  })
})
