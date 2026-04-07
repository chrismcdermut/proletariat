import { expect } from 'chai'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  groupSessionsByHQ,
  bucketElsewhereByHq,
  formatRelativeAge,
  tildifyPath,
  type UnifiedSession,
} from '../../src/lib/session/renderer.js'

/**
 * Tests for the unified session renderer (PRLT-1272).
 *
 * The renderer's pure helpers (grouping, bucketing, formatting) are exercised
 * here without touching tmux, Docker, or SQLite. The full
 * `collectAllSessions()` integration path is covered by e2e tests against a
 * real workspace + machine.db; here we just verify the building blocks.
 */
describe('Session Renderer (PRLT-1272)', () => {
  const fakeSession = (overrides: Partial<UnifiedSession>): UnifiedSession => ({
    id: overrides.id ?? 'WORK-1',
    sessionId: overrides.sessionId ?? 'sess-1',
    ticketId: overrides.ticketId ?? 'PRLT-1',
    agentName: overrides.agentName ?? 'fair-knight',
    status: overrides.status ?? 'running',
    role: overrides.role ?? 'worker',
    environment: overrides.environment ?? 'host',
    exists: overrides.exists ?? true,
    hqPath: overrides.hqPath,
    hqName: overrides.hqName,
    repoPath: overrides.repoPath,
    startedAt: overrides.startedAt,
    containerId: overrides.containerId,
    lastHeartbeat: overrides.lastHeartbeat,
    lifecycleState: overrides.lifecycleState,
  })

  // ===========================================================================
  // groupSessionsByHQ
  // ===========================================================================
  describe('groupSessionsByHQ', () => {
    it('puts sessions in the current HQ into "here"', () => {
      const tmpHq = path.join(os.tmpdir(), 'fake-hq-current')
      const sessions = [
        fakeSession({ id: 'a', sessionId: 'a', hqPath: tmpHq, hqName: 'fake-hq-current' }),
        fakeSession({ id: 'b', sessionId: 'b', hqPath: tmpHq, hqName: 'fake-hq-current' }),
      ]

      const grouped = groupSessionsByHQ(sessions, tmpHq)
      expect(grouped.here).to.have.length(2)
      expect(grouped.elsewhere).to.have.length(0)
      expect(grouped.currentHq).to.equal(tmpHq)
    })

    it('puts sessions in other HQs into "elsewhere"', () => {
      const currentHq = path.join(os.tmpdir(), 'fake-hq-current')
      const otherHq = path.join(os.tmpdir(), 'fake-hq-other')
      const sessions = [
        fakeSession({ id: 'a', sessionId: 'a', hqPath: currentHq, hqName: 'current' }),
        fakeSession({ id: 'b', sessionId: 'b', hqPath: otherHq, hqName: 'other' }),
      ]

      const grouped = groupSessionsByHQ(sessions, currentHq)
      expect(grouped.here).to.have.length(1)
      expect(grouped.here[0].id).to.equal('a')
      expect(grouped.elsewhere).to.have.length(1)
      expect(grouped.elsewhere[0].id).to.equal('b')
    })

    it('puts headless sessions (no hqPath) into "elsewhere"', () => {
      const currentHq = path.join(os.tmpdir(), 'fake-hq-current')
      const sessions = [
        fakeSession({ id: 'a', sessionId: 'a', hqPath: currentHq, hqName: 'current' }),
        fakeSession({ id: 'b', sessionId: 'b', hqPath: undefined, role: 'headless' }),
      ]

      const grouped = groupSessionsByHQ(sessions, currentHq)
      expect(grouped.here).to.have.length(1)
      expect(grouped.elsewhere).to.have.length(1)
      expect(grouped.elsewhere[0].role).to.equal('headless')
    })

    it('puts everything into "elsewhere" when not in any HQ (currentHqOverride=null)', () => {
      const someHq = path.join(os.tmpdir(), 'fake-hq')
      const sessions = [
        fakeSession({ id: 'a', sessionId: 'a', hqPath: someHq, hqName: 'fake-hq' }),
        fakeSession({ id: 'b', sessionId: 'b', hqPath: undefined }),
      ]

      const grouped = groupSessionsByHQ(sessions, null)
      expect(grouped.here).to.have.length(0)
      expect(grouped.elsewhere).to.have.length(2)
      expect(grouped.currentHq).to.be.undefined
    })

    it('handles an empty session list', () => {
      const grouped = groupSessionsByHQ([], null)
      expect(grouped.here).to.have.length(0)
      expect(grouped.elsewhere).to.have.length(0)
    })
  })

  // ===========================================================================
  // bucketElsewhereByHq
  // ===========================================================================
  describe('bucketElsewhereByHq', () => {
    it('groups elsewhere sessions by hqPath', () => {
      const hqA = path.join(os.tmpdir(), 'hq-a')
      const hqB = path.join(os.tmpdir(), 'hq-b')
      const sessions = [
        fakeSession({ id: '1', sessionId: '1', hqPath: hqA, hqName: 'hq-a' }),
        fakeSession({ id: '2', sessionId: '2', hqPath: hqA, hqName: 'hq-a' }),
        fakeSession({ id: '3', sessionId: '3', hqPath: hqB, hqName: 'hq-b' }),
        fakeSession({ id: '4', sessionId: '4', hqPath: undefined, hqName: undefined }),
      ]

      const buckets = bucketElsewhereByHq(sessions)
      expect(buckets).to.have.length(3)

      const bucketA = buckets.find(b => b.hqPath === hqA)
      const bucketB = buckets.find(b => b.hqPath === hqB)
      const bucketNone = buckets.find(b => b.hqPath === null)

      expect(bucketA?.sessions).to.have.length(2)
      expect(bucketB?.sessions).to.have.length(1)
      expect(bucketNone?.sessions).to.have.length(1)
      expect(bucketNone?.hqName).to.equal('(no HQ)')
    })

    it('returns an empty array for no sessions', () => {
      expect(bucketElsewhereByHq([])).to.deep.equal([])
    })
  })

  // ===========================================================================
  // formatRelativeAge
  // ===========================================================================
  describe('formatRelativeAge', () => {
    const now = new Date('2026-04-07T12:00:00Z')

    it('returns empty string for undefined', () => {
      expect(formatRelativeAge(undefined, now)).to.equal('')
    })

    it('formats seconds when under 60s', () => {
      const start = new Date(now.getTime() - 30 * 1000)
      expect(formatRelativeAge(start, now)).to.equal('~30s')
    })

    it('formats minutes when under 60m', () => {
      const start = new Date(now.getTime() - 15 * 60 * 1000)
      expect(formatRelativeAge(start, now)).to.equal('~15m')
    })

    it('formats hours when under 48h', () => {
      const start = new Date(now.getTime() - 3 * 60 * 60 * 1000)
      expect(formatRelativeAge(start, now)).to.equal('~3h')
    })

    it('formats days when over 48h', () => {
      const start = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
      expect(formatRelativeAge(start, now)).to.equal('~5d')
    })

    it('clamps negative durations to ~0s (future startedAt)', () => {
      const start = new Date(now.getTime() + 10 * 1000)
      expect(formatRelativeAge(start, now)).to.equal('~0s')
    })
  })

  // ===========================================================================
  // tildifyPath
  // ===========================================================================
  describe('tildifyPath', () => {
    it('replaces home directory with ~', () => {
      const home = process.env.HOME || os.homedir()
      const p = path.join(home, 'Projects', 'thing')
      expect(tildifyPath(p)).to.equal('~/Projects/thing'.replace(/\//g, path.sep))
    })

    it('returns ~ for the home directory itself', () => {
      const home = process.env.HOME || os.homedir()
      expect(tildifyPath(home)).to.equal('~')
    })

    it('leaves non-home paths unchanged', () => {
      const p = '/var/tmp/foo'
      expect(tildifyPath(p)).to.equal(p)
    })

    it('returns empty string unchanged', () => {
      expect(tildifyPath('')).to.equal('')
    })
  })
})
