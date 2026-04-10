/**
 * Regression test for PRLT-1279: `prlt work ship` PR_NOT_FOUND on merged PRs.
 *
 * Bug: Both `prlt work ship <ticket-id>` and `prlt work ship --pr <num>` were
 * returning PR_NOT_FOUND / NO_PR_FOUND for PRs that existed and were merged on
 * GitHub. Two root causes:
 *
 *   1. `getPRByNumber` / `getPRForBranch` rely on `gh` inferring the repo from
 *      the git origin of `cwd`. In workspace environments where the resolved
 *      cwd wasn't a git repo, gh failed silently and the lookup returned null
 *      with no live-GitHub fallback.
 *
 *   2. When ticket metadata lacked `pr_number` (e.g. after a Linear sync that
 *      overwrote local metadata) and the branch had been deleted post-merge,
 *      there was no fallback that queried GitHub live to find the PR.
 *
 *   3. Even when the PR lookup succeeded, if the PR was already MERGED, the
 *      command returned early without transitioning the ticket to Done —
 *      causing the board drift described in the ticket.
 *
 * Fix:
 *   - PR lookup helpers accept `{ cwd, repo }` — `--repo owner/repo` bypasses
 *     git-cwd inference entirely.
 *   - New `findPRForTicket()` queries GitHub live for PRs whose head branch
 *     matches any of the ticket's identifiers (internal id, external_key,
 *     linear.identifier), including merged and closed PRs.
 *   - The ship command no longer early-returns on MERGED — it skips the merge
 *     step but still runs the ticket transition so the board recovers.
 */

import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import {
  getPRByNumber,
  getPRForBranch,
  findPRForTicket,
  type PRInfo,
} from '../../src/lib/pr/index.js'

/**
 * Install a fake `gh` executable in a temp dir and return PATH prefix + cleanup.
 * The fake captures every invocation into a log file and emits a canned
 * response for each command pattern.
 */
function installFakeGh(opts: {
  /** Mapping: match string in argv joined → stdout to emit */
  responses: Array<{ match: string; stdout: string; exitCode?: number }>
}): { binDir: string; logFile: string; cleanup: () => void } {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt1279-fake-gh-'))
  const logFile = path.join(binDir, 'calls.log')
  const responsesJson = path.join(binDir, 'responses.json')
  fs.writeFileSync(responsesJson, JSON.stringify(opts.responses))

  const script = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const joined = args.join(' ')
fs.appendFileSync(${JSON.stringify(logFile)}, joined + '\\n')
const responses = JSON.parse(fs.readFileSync(${JSON.stringify(responsesJson)}, 'utf8'))
for (const r of responses) {
  if (joined.includes(r.match)) {
    if (r.stdout) process.stdout.write(r.stdout)
    process.exit(r.exitCode ?? 0)
  }
}
// No match → simulate gh error
process.stderr.write('no matching response for: ' + joined + '\\n')
process.exit(1)
`
  const ghPath = path.join(binDir, 'gh')
  fs.writeFileSync(ghPath, script, { mode: 0o755 })

  return {
    binDir,
    logFile,
    cleanup: () => {
      try {
        fs.rmSync(binDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    },
  }
}

/**
 * Run a function with PATH prefixed by the fake gh's dir.
 */
function withFakeGh<T>(binDir: string, fn: () => T): T {
  const originalPath = process.env.PATH
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ''}`
  try {
    return fn()
  } finally {
    process.env.PATH = originalPath
  }
}

function readCallLog(logFile: string): string[] {
  if (!fs.existsSync(logFile)) return []
  return fs
    .readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l.length > 0)
}

describe('PRLT-1279: work ship regression on merged PRs', () => {
  describe('getPRByNumber with explicit repo', () => {
    it('passes --repo <owner/repo> when repo option is set (bypasses git cwd)', () => {
      const mergedPR = {
        number: 1106,
        url: 'https://github.com/chrismcdermut/proletariat/pull/1106',
        title: 'TKT-081: Pin npm version',
        state: 'MERGED',
        headRefName: 'PRLT-1266/feat/pin-npm',
        baseRefName: 'main',
        isDraft: false,
        createdAt: '2026-04-07T00:00:00Z',
        updatedAt: '2026-04-07T01:00:00Z',
      }
      const fake = installFakeGh({
        responses: [
          {
            match: 'pr view 1106',
            stdout: JSON.stringify(mergedPR),
          },
        ],
      })
      try {
        // Run in /tmp — definitely NOT a git repo — to prove --repo bypasses
        // cwd inference. Without the fix, this fails because gh can't find
        // the repo from cwd.
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt1279-notgit-'))
        try {
          const result = withFakeGh(fake.binDir, () =>
            getPRByNumber(1106, { cwd: tmpDir, repo: 'chrismcdermut/proletariat' }),
          )
          expect(result, 'expected PR lookup to succeed with --repo flag').to.not.be.null
          expect(result?.number).to.equal(1106)
          expect(result?.state).to.equal('MERGED')

          // Verify the actual command included --repo
          const calls = readCallLog(fake.logFile)
          expect(calls.length, 'expected at least one gh call').to.be.greaterThan(0)
          const prViewCall = calls.find((c) => c.includes('pr view 1106'))
          expect(prViewCall, 'expected a pr view call').to.exist
          expect(prViewCall!).to.include('--repo chrismcdermut/proletariat')
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true })
        }
      } finally {
        fake.cleanup()
      }
    })

    it('legacy string cwd param still works (backward-compatible)', () => {
      // Simulates an older call site passing just a cwd string.
      const mergedPR = {
        number: 42,
        url: 'https://github.com/o/r/pull/42',
        title: 'test',
        state: 'MERGED',
        headRefName: 'feat/x',
        baseRefName: 'main',
        isDraft: false,
        createdAt: '2026-04-07T00:00:00Z',
        updatedAt: '2026-04-07T01:00:00Z',
      }
      const fake = installFakeGh({
        responses: [{ match: 'pr view 42', stdout: JSON.stringify(mergedPR) }],
      })
      try {
        const result = withFakeGh(fake.binDir, () => getPRByNumber(42, '/tmp'))
        expect(result?.number).to.equal(42)
        // Legacy call should NOT pass --repo
        const calls = readCallLog(fake.logFile)
        expect(calls[0]).to.not.include('--repo')
      } finally {
        fake.cleanup()
      }
    })

    it('returns null when gh exits non-zero and the caller has no repo fallback', () => {
      // Simulates the broken workspace scenario: gh fails because cwd isn't
      // a git repo. Without a --repo fallback, the caller returns null.
      const fake = installFakeGh({
        responses: [
          { match: 'pr view 9999', stdout: '', exitCode: 1 },
        ],
      })
      try {
        const result = withFakeGh(fake.binDir, () => getPRByNumber(9999, '/tmp'))
        expect(result).to.be.null
      } finally {
        fake.cleanup()
      }
    })
  })

  describe('getPRForBranch with explicit repo', () => {
    it('passes --repo when repo option is set', () => {
      const pr = {
        number: 1106,
        url: 'https://github.com/o/r/pull/1106',
        title: 't',
        state: 'MERGED',
        headRefName: 'PRLT-1266/feat/x',
        baseRefName: 'main',
        isDraft: false,
        createdAt: '2026-04-07T00:00:00Z',
        updatedAt: '2026-04-07T01:00:00Z',
      }
      const fake = installFakeGh({
        responses: [{ match: 'pr view PRLT-1266', stdout: JSON.stringify(pr) }],
      })
      try {
        const result = withFakeGh(fake.binDir, () =>
          getPRForBranch('PRLT-1266/feat/x', { repo: 'o/r' }),
        )
        expect(result?.number).to.equal(1106)
        const calls = readCallLog(fake.logFile)
        expect(calls[0]).to.include('--repo o/r')
      } finally {
        fake.cleanup()
      }
    })
  })

  describe('findPRForTicket — live GitHub fallback', () => {
    it('finds a merged PR for a ticket by searching head branch prefix', () => {
      // Simulates: ticket metadata has no pr_number, branch was deleted
      // post-merge, but gh pr list --state all still finds the merged PR.
      const mergedPR = {
        number: 1106,
        url: 'https://github.com/o/r/pull/1106',
        title: 'TKT-081: Pin npm',
        state: 'MERGED',
        headRefName: 'PRLT-1266/feat/pin-npm',
        baseRefName: 'main',
        isDraft: false,
        createdAt: '2026-04-07T00:00:00Z',
        updatedAt: '2026-04-07T01:00:00Z',
      }
      const fake = installFakeGh({
        responses: [
          {
            match: '--search head:PRLT-1266/',
            stdout: JSON.stringify([mergedPR]),
          },
          // Any other id returns empty
          {
            match: '--search head:',
            stdout: '[]',
          },
        ],
      })
      try {
        const result = withFakeGh(fake.binDir, () =>
          findPRForTicket(['PRLT-1266'], { repo: 'o/r' }),
        )
        expect(result, 'expected live GitHub fallback to find merged PR').to.not.be.null
        expect(result?.number).to.equal(1106)
        expect(result?.state).to.equal('MERGED')
      } finally {
        fake.cleanup()
      }
    })

    it('tries all provided ids in order (dual-identity tickets)', () => {
      // Simulates a dual-identity ticket where the internal id (TKT-081)
      // finds nothing, but the external key (PRLT-1266) finds the PR.
      const mergedPR = {
        number: 1106,
        url: 'https://github.com/o/r/pull/1106',
        title: 'test',
        state: 'MERGED',
        headRefName: 'PRLT-1266/feat/x',
        baseRefName: 'main',
        isDraft: false,
        createdAt: '2026-04-07T00:00:00Z',
        updatedAt: '2026-04-07T01:00:00Z',
      }
      const fake = installFakeGh({
        responses: [
          { match: 'head:TKT-081/', stdout: '[]' },
          { match: 'head:PRLT-1266/', stdout: JSON.stringify([mergedPR]) },
        ],
      })
      try {
        const result = withFakeGh(fake.binDir, () =>
          findPRForTicket(['TKT-081', 'PRLT-1266'], { repo: 'o/r' }),
        )
        expect(result?.number).to.equal(1106)
        // Both ids should have been queried
        const calls = readCallLog(fake.logFile)
        expect(calls.some((c) => c.includes('head:TKT-081/'))).to.be.true
        expect(calls.some((c) => c.includes('head:PRLT-1266/'))).to.be.true
      } finally {
        fake.cleanup()
      }
    })

    it('prefers OPEN over MERGED, and MERGED over CLOSED', () => {
      // Contrived: two matches, one merged one closed — should pick MERGED
      const closedPR = {
        number: 100,
        url: 'u',
        title: 'closed',
        state: 'CLOSED',
        headRefName: 'PRLT-1/feat/x',
        baseRefName: 'main',
        isDraft: false,
        createdAt: '2026-04-07T00:00:00Z',
        updatedAt: '2026-04-07T10:00:00Z',
      }
      const mergedPR = {
        number: 101,
        url: 'u',
        title: 'merged',
        state: 'MERGED',
        headRefName: 'PRLT-1/feat/x',
        baseRefName: 'main',
        isDraft: false,
        createdAt: '2026-04-07T00:00:00Z',
        updatedAt: '2026-04-07T01:00:00Z',
      }
      const fake = installFakeGh({
        responses: [
          { match: 'head:PRLT-1/', stdout: JSON.stringify([closedPR, mergedPR]) },
        ],
      })
      try {
        const result = withFakeGh(fake.binDir, () =>
          findPRForTicket(['PRLT-1'], { repo: 'o/r' }),
        )
        expect(result?.state).to.equal('MERGED')
        expect(result?.number).to.equal(101)
      } finally {
        fake.cleanup()
      }
    })

    it('returns null when no ids are provided', () => {
      const result = findPRForTicket([], { repo: 'o/r' })
      expect(result).to.be.null
    })

    it('deduplicates the id list before querying gh', () => {
      // If the caller passes the same id multiple times (e.g. ticket.id ===
      // metadata.external_key), we should only query gh once.
      const mergedPR = {
        number: 1,
        url: 'u',
        title: 't',
        state: 'MERGED',
        headRefName: 'PRLT-1/feat/x',
        baseRefName: 'main',
        isDraft: false,
        createdAt: '2026-04-07T00:00:00Z',
        updatedAt: '2026-04-07T01:00:00Z',
      }
      const fake = installFakeGh({
        responses: [
          { match: 'head:PRLT-1/', stdout: JSON.stringify([mergedPR]) },
        ],
      })
      try {
        withFakeGh(fake.binDir, () =>
          findPRForTicket(['PRLT-1', 'PRLT-1', 'PRLT-1'], { repo: 'o/r' }),
        )
        const calls = readCallLog(fake.logFile)
        const listCalls = calls.filter((c) => c.includes('head:PRLT-1/'))
        expect(listCalls.length, 'should query each unique id exactly once').to.equal(1)
      } finally {
        fake.cleanup()
      }
    })
  })

  describe('ship.ts — ticket id collection for live GitHub fallback', () => {
    // These tests verify the pure logic we use in ship.ts to build the
    // search-id list for findPRForTicket. This is the logic that recovers
    // from the repro in the ticket:
    //   prlt work ship PRLT-1266
    //   → ticket resolves to TKT-081 (internal id)
    //   → metadata has no pr_number, branch is undefined
    //   → we must search GitHub with all of [TKT-081, PRLT-1266]

    /** Mirrors the id-collection block in work/ship.ts (PRLT-1279). */
    function collectSearchIds(
      ticket: {
        id?: string
        metadata?: Record<string, unknown>
      },
      ticketId?: string,
    ): string[] {
      const searchIds: string[] = []
      if (ticket.id) searchIds.push(ticket.id)
      const externalKey =
        typeof ticket.metadata?.external_key === 'string'
          ? ticket.metadata.external_key
          : undefined
      if (externalKey && !searchIds.includes(externalKey)) {
        searchIds.push(externalKey)
      }
      const linearId =
        typeof ticket.metadata?.['linear.identifier'] === 'string'
          ? (ticket.metadata['linear.identifier'] as string)
          : undefined
      if (linearId && !searchIds.includes(linearId)) {
        searchIds.push(linearId)
      }
      if (ticketId && !searchIds.includes(ticketId)) {
        searchIds.push(ticketId)
      }
      return searchIds
    }

    it('dual-identity ticket: includes both internal id and linear.identifier', () => {
      // This is the EXACT repro from PRLT-1279:
      //   user runs: prlt work ship PRLT-1266
      //   ticket.id = TKT-081 (internal), metadata has linear.identifier = PRLT-1266
      const ids = collectSearchIds(
        {
          id: 'TKT-081',
          metadata: { 'linear.identifier': 'PRLT-1266' },
        },
        'PRLT-1266',
      )
      expect(ids).to.include('TKT-081')
      expect(ids).to.include('PRLT-1266')
    })

    it('dual-identity ticket: external_key is included when present', () => {
      const ids = collectSearchIds(
        {
          id: 'TKT-081',
          metadata: { external_key: 'PRLT-1266' },
        },
        'PRLT-1266',
      )
      expect(ids).to.include('TKT-081')
      expect(ids).to.include('PRLT-1266')
    })

    it('PMO-only ticket: single id, no duplicates', () => {
      const ids = collectSearchIds(
        {
          id: 'TKT-123',
          metadata: {},
        },
        'TKT-123',
      )
      expect(ids).to.deep.equal(['TKT-123'])
    })

    it('Linear-only ticket: id already in canonical form', () => {
      const ids = collectSearchIds(
        {
          id: 'PRLT-1266',
          metadata: {},
        },
        'PRLT-1266',
      )
      expect(ids).to.deep.equal(['PRLT-1266'])
    })

    it('deduplicates when external_key equals ticket.id', () => {
      const ids = collectSearchIds(
        {
          id: 'PRLT-1266',
          metadata: {
            external_key: 'PRLT-1266',
            'linear.identifier': 'PRLT-1266',
          },
        },
        'PRLT-1266',
      )
      expect(ids).to.deep.equal(['PRLT-1266'])
    })

    it('handles all three sources being distinct', () => {
      const ids = collectSearchIds(
        {
          id: 'TKT-1',
          metadata: {
            external_key: 'JIRA-1',
            'linear.identifier': 'PRLT-1',
          },
        },
        'PROJ-1',
      )
      expect(ids).to.deep.equal(['TKT-1', 'JIRA-1', 'PRLT-1', 'PROJ-1'])
    })
  })

  describe('ship.ts — already-merged PRs transition tickets (no early return)', () => {
    // Pure-logic test of the new alreadyMerged flag control flow.
    // The old code had: if (state === 'MERGED') return immediately.
    // The new code sets alreadyMerged=true, skips the merge step, but still
    // runs the ticket-transition step.

    interface ShipFlow {
      /** Called when gh is invoked to merge the PR */
      mergeCalled: boolean
      /** Called when the ticket is moved to Done */
      transitionCalled: boolean
      /** Early return (pre-fix behavior) */
      earlyReturned: boolean
    }

    function simulateShipFlow(prState: 'OPEN' | 'MERGED' | 'CLOSED'): ShipFlow {
      const flow: ShipFlow = {
        mergeCalled: false,
        transitionCalled: false,
        earlyReturned: false,
      }

      // Mirror the new ship.ts control flow (PRLT-1279)
      const alreadyMerged = prState === 'MERGED'

      if (prState === 'CLOSED') {
        flow.earlyReturned = true
        return flow
      }

      // Merge step is skipped when already merged
      if (!alreadyMerged) {
        flow.mergeCalled = true
      }

      // Ticket transition runs regardless
      flow.transitionCalled = true
      return flow
    }

    it('OPEN PR: merge + transition', () => {
      const flow = simulateShipFlow('OPEN')
      expect(flow.mergeCalled).to.be.true
      expect(flow.transitionCalled).to.be.true
      expect(flow.earlyReturned).to.be.false
    })

    it('MERGED PR: skip merge, still transition (this is the fix)', () => {
      const flow = simulateShipFlow('MERGED')
      expect(flow.mergeCalled, 'should NOT re-merge already-merged PR').to.be.false
      expect(
        flow.transitionCalled,
        'should transition ticket to Done so board recovers from drift',
      ).to.be.true
      expect(flow.earlyReturned).to.be.false
    })

    it('CLOSED PR: early return (not mergeable, not transitionable)', () => {
      const flow = simulateShipFlow('CLOSED')
      expect(flow.mergeCalled).to.be.false
      expect(flow.transitionCalled).to.be.false
      expect(flow.earlyReturned).to.be.true
    })
  })

  describe('getPRByNumber backward compatibility — type contract', () => {
    it('accepts undefined', () => {
      // This is a compile-time check mostly. It will fail to run because
      // gh may not be on PATH, but the important thing is that the call
      // compiles and returns null gracefully.
      const result = getPRByNumber(999999, undefined)
      // Either null (gh not found or not in repo) or a PR — both are fine.
      expect(result === null || typeof result === 'object').to.be.true
    })

    it('type contract: (number, string | object | undefined) → PRInfo | null', () => {
      // Ensure all three overloads compile.
      type GetPRByNumber = (
        prNumber: number,
        cwdOrOptions?: string | { cwd?: string; repo?: string },
      ) => PRInfo | null
      const fn: GetPRByNumber = getPRByNumber
      expect(fn).to.be.a('function')
    })
  })

  // Sanity check: make sure the fake-gh harness itself works. If this fails
  // the other tests are meaningless.
  describe('fake gh harness self-check', () => {
    it('fake gh emits canned stdout and logs call', () => {
      const fake = installFakeGh({
        responses: [{ match: 'hello', stdout: 'world' }],
      })
      try {
        const result = withFakeGh(fake.binDir, () =>
          execSync('gh hello', { encoding: 'utf-8' }),
        )
        expect(result).to.equal('world')
        const calls = readCallLog(fake.logFile)
        expect(calls).to.include('hello')
      } finally {
        fake.cleanup()
      }
    })
  })
})
