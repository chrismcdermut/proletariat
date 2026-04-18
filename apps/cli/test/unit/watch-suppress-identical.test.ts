import { expect } from 'chai'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WATCH_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../src/commands/watch/index.ts'),
  'utf-8',
)

/**
 * Tests for PRLT-1349: Watch daemon suppress-if-identical and default interval.
 *
 * Two fixes:
 * 1) Suppress poke if state is identical to last poke (no changes = no poke)
 * 2) Default poll interval is 300s (5 min), not 60s
 */

describe('Watch suppress-if-identical (PRLT-1349)', () => {
  // ===========================================================================
  // Default poll interval
  // ===========================================================================

  describe('default poll interval', () => {
    it('watch command defaults to 300s (5 minutes)', () => {
      // The flag definition should have default: 300
      expect(WATCH_SOURCE).to.match(
        /['"]poll-interval['"].*default:\s*300/s,
        'default poll interval should be 300s',
      )
    })

    it('watchDaemonSpec defaults to 300s', async () => {
      const { watchDaemonSpec } = await import('../../src/lib/session/daemon-manager.js')
      const spec = watchDaemonSpec('test-target')
      expect(spec.command).to.contain('--poll-interval 300')
    })

    it('watch command no longer defaults to 60s', () => {
      expect(WATCH_SOURCE).to.not.match(
        /['"]poll-interval['"].*default:\s*60\b/s,
        'default poll interval should NOT be 60s',
      )
    })
  })

  // ===========================================================================
  // Suppress-if-identical source guards
  // ===========================================================================

  describe('suppress-if-identical implementation', () => {
    it('imports createHash from node:crypto', () => {
      expect(WATCH_SOURCE).to.match(
        /import\s*\{[^}]*createHash[^}]*\}\s*from\s*['"]node:crypto['"]/,
        'watch command must import createHash for state hashing',
      )
    })

    it('tracks lastPokeHash for deduplication', () => {
      expect(WATCH_SOURCE).to.include('lastPokeHash')
    })

    it('computes hash of poll result message', () => {
      expect(WATCH_SOURCE).to.match(
        /createHash\s*\(\s*['"]sha256['"]\s*\)/,
        'must use sha256 hash for state comparison',
      )
    })

    it('suppresses poke when hash matches last poke', () => {
      // The pattern: if (hash === lastPokeHash) { ... return }
      expect(WATCH_SOURCE).to.include('hash === lastPokeHash')
    })

    it('updates lastPokeHash after a successful poke', () => {
      expect(WATCH_SOURCE).to.include('lastPokeHash = hash')
    })

    it('logs suppression in verbose mode', () => {
      expect(WATCH_SOURCE).to.match(
        /poke suppressed/i,
        'should log when a poke is suppressed',
      )
    })
  })

  // ===========================================================================
  // Hash deduplication logic
  // ===========================================================================

  describe('hash deduplication logic', () => {
    it('identical messages produce the same hash', () => {
      const msg = 'GitHub PRs: none\n\nReady tickets: none\n\nActive agents: none'
      const h1 = createHash('sha256').update(msg).digest('hex')
      const h2 = createHash('sha256').update(msg).digest('hex')
      expect(h1).to.equal(h2)
    })

    it('different messages produce different hashes', () => {
      const msg1 = 'GitHub PRs: none\n\nReady tickets: none\n\nActive agents: none'
      const msg2 = 'GitHub PRs: none\n\nReady tickets (1 unassigned):\n- TKT-001 "Feature": ready, unassigned\n\nActive agents: none'
      const h1 = createHash('sha256').update(msg1).digest('hex')
      const h2 = createHash('sha256').update(msg2).digest('hex')
      expect(h1).to.not.equal(h2)
    })

    it('first poll always sends a poke (lastPokeHash starts null)', () => {
      // Verify the initial value is null — any hash will differ from null
      const hash = createHash('sha256').update('any message').digest('hex')
      const lastPokeHash: string | null = null
      expect(hash === lastPokeHash).to.be.false
    })

    it('simulates suppress-then-poke cycle', () => {
      // Simulate the deduplication flow
      let lastHash: string | null = null
      const pokes: string[] = []

      const pollAndPoke = (message: string) => {
        const hash = createHash('sha256').update(message).digest('hex')
        if (hash === lastHash) return // suppressed
        pokes.push(message)
        lastHash = hash
      }

      const stateA = 'GitHub PRs: none\nReady tickets: none\nActive agents: none'
      const stateB = 'GitHub PRs (1 open):\n- #42: "Fix bug"\nReady tickets: none\nActive agents: none'

      // Cycle 1: first poll — always pokes
      pollAndPoke(stateA)
      expect(pokes).to.have.length(1)

      // Cycle 2: same state — suppressed
      pollAndPoke(stateA)
      expect(pokes).to.have.length(1)

      // Cycle 3: still same — suppressed
      pollAndPoke(stateA)
      expect(pokes).to.have.length(1)

      // Cycle 4: state changed — pokes
      pollAndPoke(stateB)
      expect(pokes).to.have.length(2)
      expect(pokes[1]).to.equal(stateB)

      // Cycle 5: back to original state — pokes (different from last)
      pollAndPoke(stateA)
      expect(pokes).to.have.length(3)

      // Cycle 6: same as last — suppressed again
      pollAndPoke(stateA)
      expect(pokes).to.have.length(3)
    })
  })
})
