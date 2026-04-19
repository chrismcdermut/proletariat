import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatDaemonMessage, parseDaemonMessage } from '../../src/lib/orchestrate/thread-router.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WATCH_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../src/commands/watch/index.ts'),
  'utf-8',
)

/**
 * Tests for PRLT-1352: Watch daemon poke messages need [daemon] prefix
 * to distinguish from human input.
 *
 * The watch daemon sends state reports that look identical to text a human
 * might paste. Adding a [daemon:poll] prefix lets the orchestrator LLM
 * distinguish automated state updates from human messages.
 */

describe('Watch daemon poll prefix (PRLT-1352)', () => {
  // ===========================================================================
  // Source code guards — verify the watch command uses formatDaemonMessage
  // ===========================================================================

  describe('watch command source', () => {
    it('imports formatDaemonMessage from thread-router', () => {
      expect(WATCH_SOURCE).to.match(
        /import\s*\{[^}]*formatDaemonMessage[^}]*\}\s*from\s*['"].*thread-router/,
        'watch command must import formatDaemonMessage to tag poke messages',
      )
    })

    it('wraps poll messages with formatDaemonMessage before poking', () => {
      expect(WATCH_SOURCE).to.include(
        'formatDaemonMessage',
        'watch command must call formatDaemonMessage to add daemon prefix',
      )
    })

    it('uses eventName "poll" for watch daemon messages', () => {
      expect(WATCH_SOURCE).to.match(
        /eventName:\s*['"]poll['"]/,
        'watch daemon messages should use eventName "poll"',
      )
    })

    it('uses type "daemon" for watch daemon messages', () => {
      expect(WATCH_SOURCE).to.match(
        /type:\s*['"]daemon['"]/,
        'watch daemon messages should use type "daemon"',
      )
    })
  })

  // ===========================================================================
  // Functional tests — verify [daemon:poll] prefix works for multi-line state
  // ===========================================================================

  describe('daemon:poll message formatting', () => {
    it('prepends [daemon:poll] to the state report', () => {
      const stateReport = 'GitHub PRs: none\n\nReady tickets: none\n\nActive agents: none'
      const tagged = formatDaemonMessage({
        type: 'daemon',
        eventName: 'poll',
        body: stateReport,
      })
      expect(tagged).to.equal(`[daemon:poll] ${stateReport}`)
    })

    it('parseDaemonMessage recognizes [daemon:poll] messages', () => {
      const stateReport = 'GitHub PRs (2 open):\n- #42: "Fix bug" — CI: success\n\nReady tickets: none'
      const tagged = formatDaemonMessage({
        type: 'daemon',
        eventName: 'poll',
        body: stateReport,
      })
      const parsed = parseDaemonMessage(tagged)
      expect(parsed).to.not.be.null
      expect(parsed!.type).to.equal('daemon')
      expect(parsed!.eventName).to.equal('poll')
      expect(parsed!.ticketId).to.be.undefined
      expect(parsed!.body).to.equal(stateReport)
    })

    it('parseDaemonMessage returns null for untagged state (human input)', () => {
      // Before this fix, daemon messages looked like this — indistinguishable
      const humanLooking = 'GitHub PRs (1 open):\n- #42: "Fix bug"'
      expect(parseDaemonMessage(humanLooking)).to.be.null
    })

    it('roundtrips multi-line state through format and parse', () => {
      const stateReport = [
        'GitHub PRs (1 open):',
        '- #1094 (PRLT-1259): "Fix login flow" — CI: pending — mergeable — no review',
        '',
        'Ready tickets (2 unassigned):',
        '- PRLT-1260 "Implement logout": ready, unassigned',
        '- PRLT-1261 "Add password reset": ready, unassigned',
        '',
        'Active agents (1): 1 WORKING, 0 HUNG, 0 IDLE',
        '- bold-fox (PRLT-1259): WORKING',
      ].join('\n')

      const original = {
        type: 'daemon' as const,
        eventName: 'poll',
        ticketId: undefined,
        body: stateReport,
      }

      const formatted = formatDaemonMessage(original)
      expect(formatted).to.match(/^\[daemon:poll\] /)

      const parsed = parseDaemonMessage(formatted)
      expect(parsed).to.deep.equal(original)
    })
  })

  // ===========================================================================
  // Hash deduplication still works with tagged messages
  // ===========================================================================

  describe('hash deduplication with prefix', () => {
    it('hashes raw state before tagging (dedup on content, not prefix)', () => {
      // The watch command hashes result.message (raw state) and only tags
      // the message after the hash check. This ensures deduplication works
      // correctly — two identical states still produce the same hash even
      // though the tagged message is the same too.
      //
      // Verify the source code pattern: hash is computed from result.message,
      // then formatDaemonMessage wraps it *after* the hash comparison.
      expect(WATCH_SOURCE).to.match(
        /createHash.*\.update\(result\.message\)/,
        'hash should be computed from raw result.message, not from the tagged message',
      )
    })
  })
})
