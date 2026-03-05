import { expect } from 'chai'
import { parseWorkSourceRef } from '../../src/lib/work-source/config.js'
import { resolveMirrorToPmo } from '../../src/lib/external-issues/work-start.js'

describe('--from flag parsing', () => {
  describe('parseWorkSourceRef for issue keys', () => {
    it('parses linear:ENG-123 as provider=linear context=ENG-123', () => {
      const ref = parseWorkSourceRef('linear:ENG-123')
      expect(ref.provider).to.equal('linear')
      expect(ref.context).to.equal('ENG-123')
    })

    it('parses jira:PROJ-456 as provider=jira context=PROJ-456', () => {
      const ref = parseWorkSourceRef('jira:PROJ-456')
      expect(ref.provider).to.equal('jira')
      expect(ref.context).to.equal('PROJ-456')
    })

    it('parses linear without key as provider=linear no context', () => {
      const ref = parseWorkSourceRef('linear')
      expect(ref.provider).to.equal('linear')
      expect(ref.context).to.be.undefined
    })

    it('parses jira without key as provider=jira no context', () => {
      const ref = parseWorkSourceRef('jira')
      expect(ref.provider).to.equal('jira')
      expect(ref.context).to.be.undefined
    })
  })

  describe('--from flag to source/key extraction', () => {
    /**
     * This tests the logic that work start uses to split --from into source and key.
     * The actual command uses: flags.source = before colon, flags.key = after colon
     */
    function splitFromFlag(from: string): { source: string; key?: string } {
      const colonIndex = from.indexOf(':')
      if (colonIndex !== -1) {
        return {
          source: from.slice(0, colonIndex).toLowerCase(),
          key: from.slice(colonIndex + 1).trim(),
        }
      }
      return { source: from.toLowerCase() }
    }

    it('splits linear:ENG-123 correctly', () => {
      const result = splitFromFlag('linear:ENG-123')
      expect(result.source).to.equal('linear')
      expect(result.key).to.equal('ENG-123')
    })

    it('splits jira:PROJ-456 correctly', () => {
      const result = splitFromFlag('jira:PROJ-456')
      expect(result.source).to.equal('jira')
      expect(result.key).to.equal('PROJ-456')
    })

    it('handles provider-only input', () => {
      const result = splitFromFlag('linear')
      expect(result.source).to.equal('linear')
      expect(result.key).to.be.undefined
    })

    it('handles case-insensitive provider', () => {
      const result = splitFromFlag('JIRA:PROJ-123')
      expect(result.source).to.equal('jira')
      expect(result.key).to.equal('PROJ-123')
    })
  })
})

describe('mirror-to-pmo with from-issue flow', () => {
  it('defaults to enabled (mirroring on)', () => {
    const result = resolveMirrorToPmo({})
    expect(result.enabled).to.equal(true)
    expect(result.source).to.equal('default')
  })

  it('respects explicit flag=false', () => {
    const result = resolveMirrorToPmo({ flagValue: false })
    expect(result.enabled).to.equal(false)
    expect(result.source).to.equal('flag')
  })

  it('respects env override', () => {
    const result = resolveMirrorToPmo({ envValue: false })
    expect(result.enabled).to.equal(false)
    expect(result.source).to.equal('env')
  })

  it('respects config override', () => {
    const result = resolveMirrorToPmo({ configValue: false })
    expect(result.enabled).to.equal(false)
    expect(result.source).to.equal('config')
  })

  it('flag takes precedence over env', () => {
    const result = resolveMirrorToPmo({ flagValue: true, envValue: false })
    expect(result.enabled).to.equal(true)
    expect(result.source).to.equal('flag')
  })

  it('env takes precedence over config', () => {
    const result = resolveMirrorToPmo({ envValue: true, configValue: false })
    expect(result.enabled).to.equal(true)
    expect(result.source).to.equal('env')
  })
})
