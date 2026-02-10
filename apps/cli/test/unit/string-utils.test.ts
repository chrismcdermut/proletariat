import { expect } from 'chai'
import { visualPadEnd } from '../../src/lib/string-utils.js'

describe('string-utils', () => {
  describe('visualPadEnd', () => {
    it('pads plain ASCII strings like normal padEnd', () => {
      expect(visualPadEnd('hello', 10)).to.equal('hello     ')
      expect(visualPadEnd('abc', 5)).to.equal('abc  ')
    })

    it('returns the string unchanged when already at target width', () => {
      expect(visualPadEnd('hello', 5)).to.equal('hello')
    })

    it('returns the string unchanged when longer than target width', () => {
      expect(visualPadEnd('hello world', 5)).to.equal('hello world')
    })

    it('pads correctly with emoji characters (2 visual columns)', () => {
      // Whale emoji takes 2 visual columns but is 1 JS character (surrogate pair)
      const whale = '🐳 docker'
      const padded = visualPadEnd(whale, 13)
      // '🐳 docker' = 2 (emoji) + 1 (space) + 6 (docker) = 9 visual columns
      // Need 13 - 9 = 4 spaces of padding
      expect(padded).to.equal('🐳 docker    ')
    })

    it('pads correctly with multiple emoji', () => {
      const str = '🐳💻📦'
      const padded = visualPadEnd(str, 10)
      // 3 emoji * 2 visual cols = 6 visual columns, need 4 spaces
      expect(padded).to.equal('🐳💻📦    ')
    })

    it('handles empty string', () => {
      expect(visualPadEnd('', 5)).to.equal('     ')
    })

    it('handles environment strings with emoji prefix (the actual bug case)', () => {
      // These are the exact strings from execution/list.ts
      const devcontainer = '🐳 devcontainer'
      const host = '💻 host'
      const docker = '📦 docker'

      // All should pad to consistent visual width of 13
      const paddedDev = visualPadEnd(devcontainer, 13)
      const paddedHost = visualPadEnd(host, 13)
      const paddedDocker = visualPadEnd(docker, 13)

      // devcontainer: 2 + 1 + 12 = 15 visual cols (already >= 13)
      expect(paddedDev).to.equal(devcontainer)

      // host: 2 + 1 + 4 = 7 visual cols, need 6 spaces
      expect(paddedHost).to.equal('💻 host      ')

      // docker: 2 + 1 + 6 = 9 visual cols, need 4 spaces
      expect(paddedDocker).to.equal('📦 docker    ')
    })
  })
})
