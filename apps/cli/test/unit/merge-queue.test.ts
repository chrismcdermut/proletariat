import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { PRInfo, PRCheck, MergePRResult } from '../../src/lib/pr/index.js'
import type { UpdateBranchResult, SiblingRebaseResult } from '../../src/lib/shipping/types.js'
import {
  buildMergeQueue,
  runMergeQueueCycle,
  getMergeQueueState,
  saveMergeQueueState,
  getDefaultState,
  pauseMergeQueue,
  resumeMergeQueue,
  isMergeQueuePaused,
  type MergeQueueDeps,
  type MergeQueueState,
  type MergeQueueOptions,
} from '../../src/lib/sync/merge-queue.js'

/**
 * Merge Queue Unit Tests
 *
 * Tests the sequential rebase-test-merge pipeline:
 * - Queue building & priority ordering
 * - Cycle state machine (rebase, wait CI, merge, eject)
 * - Pause/resume
 * - Edge cases (external merge, closed PR, conflicts)
 */

// =============================================================================
// Test Helpers
// =============================================================================

function makePR(overrides: Partial<PRInfo> = {}): PRInfo {
  return {
    number: 42,
    url: 'https://github.com/test/repo/pull/42',
    title: 'Test PR',
    state: 'OPEN',
    headBranch: 'PRLT-123/feat/test',
    baseBranch: 'main',
    isDraft: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeChecks(conclusions: string[]): PRCheck[] {
  return conclusions.map((conclusion, i) => ({
    name: `check-${i}`,
    status: 'completed',
    conclusion,
    url: '',
  }))
}

function makePendingChecks(count: number): PRCheck[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `check-${i}`,
    status: 'IN_PROGRESS',
    conclusion: '',
    url: '',
  }))
}

function createTempHQ(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-queue-test-'))
  const proletariatDir = path.join(tmpDir, '.proletariat')
  fs.mkdirSync(proletariatDir, { recursive: true })
  return tmpDir
}

function cleanupTempHQ(hqPath: string): void {
  fs.rmSync(hqPath, { recursive: true, force: true })
}

function makeDeps(overrides: Partial<MergeQueueDeps> = {}): MergeQueueDeps {
  return {
    listOpenPRs: () => [],
    getPRChecks: () => [],
    getPRByNumber: () => null,
    mergePR: () => ({ success: true }),
    rebaseSiblingPRs: () => ({ succeeded: [], failed: [], skipped: [], totalChecked: 0 }),
    updatePRBranch: (prNumber) => ({ success: true, prNumber, headBranch: '' }),
    addLabel: () => true,
    addComment: () => true,
    ...overrides,
  }
}

// =============================================================================
// State Management
// =============================================================================

describe('Merge Queue', () => {
  let hqPath: string

  beforeEach(() => {
    hqPath = createTempHQ()
  })

  afterEach(() => {
    cleanupTempHQ(hqPath)
  })

  describe('State Management', () => {
    it('should return default state when no state file exists', () => {
      const state = getMergeQueueState(hqPath)
      expect(state.paused).to.be.false
      expect(state.pausedAt).to.be.null
      expect(state.currentPR).to.be.null
      expect(state.lastMergedPR).to.be.null
      expect(state.lastCycleAt).to.be.null
      expect(state.ejectedPRs).to.deep.equal([])
    })

    it('should persist and load state', () => {
      const state = getDefaultState()
      state.paused = true
      state.pausedAt = '2026-01-01T00:00:00Z'
      saveMergeQueueState(hqPath, state)

      const loaded = getMergeQueueState(hqPath)
      expect(loaded.paused).to.be.true
      expect(loaded.pausedAt).to.equal('2026-01-01T00:00:00Z')
    })
  })

  // ===========================================================================
  // Pause / Resume
  // ===========================================================================

  describe('Pause / Resume', () => {
    it('should pause the merge queue', () => {
      expect(isMergeQueuePaused(hqPath)).to.be.false

      const state = pauseMergeQueue(hqPath)
      expect(state.paused).to.be.true
      expect(state.pausedAt).to.not.be.null
      expect(isMergeQueuePaused(hqPath)).to.be.true
    })

    it('should resume the merge queue', () => {
      pauseMergeQueue(hqPath)
      expect(isMergeQueuePaused(hqPath)).to.be.true

      const state = resumeMergeQueue(hqPath)
      expect(state.paused).to.be.false
      expect(state.pausedAt).to.be.null
      expect(isMergeQueuePaused(hqPath)).to.be.false
    })
  })

  // ===========================================================================
  // Queue Building
  // ===========================================================================

  describe('buildMergeQueue', () => {
    it('should return empty queue when no open PRs', () => {
      const deps = makeDeps({ listOpenPRs: () => [] })
      const queue = buildMergeQueue({}, deps)
      expect(queue).to.deep.equal([])
    })

    it('should exclude draft PRs', () => {
      const deps = makeDeps({
        listOpenPRs: () => [makePR({ number: 1, isDraft: true })],
        getPRChecks: () => makeChecks(['SUCCESS']),
      })
      const queue = buildMergeQueue({}, deps)
      expect(queue).to.have.length(0)
    })

    it('should exclude PRs without CI checks', () => {
      const deps = makeDeps({
        listOpenPRs: () => [makePR({ number: 1 })],
        getPRChecks: () => [],
      })
      const queue = buildMergeQueue({}, deps)
      expect(queue).to.have.length(0)
    })

    it('should exclude PRs with failing CI', () => {
      const deps = makeDeps({
        listOpenPRs: () => [makePR({ number: 1 })],
        getPRChecks: () => makeChecks(['SUCCESS', 'FAILURE']),
      })
      const queue = buildMergeQueue({}, deps)
      expect(queue).to.have.length(0)
    })

    it('should include PRs with all green CI', () => {
      const pr = makePR({ number: 1 })
      const deps = makeDeps({
        listOpenPRs: () => [pr],
        getPRChecks: () => makeChecks(['SUCCESS', 'NEUTRAL', 'SKIPPED']),
      })
      const queue = buildMergeQueue({}, deps)
      expect(queue).to.have.length(1)
      expect(queue[0].pr.number).to.equal(1)
    })

    it('should order by priority (P0 before P3)', () => {
      const pr1 = makePR({ number: 1, headBranch: 'PRLT-100/feat/low-pri', createdAt: '2026-01-01T00:00:00Z' })
      const pr2 = makePR({ number: 2, headBranch: 'PRLT-200/feat/high-pri', createdAt: '2026-01-02T00:00:00Z' })
      const deps = makeDeps({
        listOpenPRs: () => [pr1, pr2],
        getPRChecks: () => makeChecks(['SUCCESS']),
      })
      const branchPriorities = new Map([
        ['PRLT-100/feat/low-pri', 3],   // P3
        ['PRLT-200/feat/high-pri', 0],  // P0
      ])
      const queue = buildMergeQueue({ branchPriorities }, deps)

      expect(queue).to.have.length(2)
      expect(queue[0].pr.number).to.equal(2) // P0 first
      expect(queue[1].pr.number).to.equal(1) // P3 second
    })

    it('should order by age when priorities are equal', () => {
      const pr1 = makePR({ number: 1, headBranch: 'a', createdAt: '2026-01-02T00:00:00Z' })
      const pr2 = makePR({ number: 2, headBranch: 'b', createdAt: '2026-01-01T00:00:00Z' })
      const deps = makeDeps({
        listOpenPRs: () => [pr1, pr2],
        getPRChecks: () => makeChecks(['SUCCESS']),
      })
      const queue = buildMergeQueue({}, deps)

      expect(queue).to.have.length(2)
      expect(queue[0].pr.number).to.equal(2) // Older first
      expect(queue[1].pr.number).to.equal(1)
    })

    it('should extract ticket ID from branch name', () => {
      const pr = makePR({ number: 1, headBranch: 'PRLT-456/feat/thing' })
      const deps = makeDeps({
        listOpenPRs: () => [pr],
        getPRChecks: () => makeChecks(['SUCCESS']),
      })
      const queue = buildMergeQueue({}, deps)
      expect(queue[0].ticketId).to.equal('PRLT-456')
    })
  })

  // ===========================================================================
  // Cycle: Paused
  // ===========================================================================

  describe('runMergeQueueCycle — paused', () => {
    it('should return paused action when queue is paused', () => {
      pauseMergeQueue(hqPath)
      const result = runMergeQueueCycle({ hqPath }, makeDeps())
      expect(result.action).to.equal('paused')
    })
  })

  // ===========================================================================
  // Cycle: No current PR — pick and rebase
  // ===========================================================================

  describe('runMergeQueueCycle — no current PR', () => {
    it('should return none when queue is empty', () => {
      const result = runMergeQueueCycle({ hqPath }, makeDeps())
      expect(result.action).to.equal('none')
      expect(result.queueSize).to.equal(0)
    })

    it('should rebase the top PR and set it as current', () => {
      const pr = makePR({ number: 10, headBranch: 'PRLT-100/feat/test', baseBranch: 'main' })
      const deps = makeDeps({
        listOpenPRs: () => [pr],
        getPRChecks: () => makeChecks(['SUCCESS']),
        updatePRBranch: (prNumber) => ({ success: true, prNumber, headBranch: pr.headBranch }),
      })

      const result = runMergeQueueCycle({ hqPath }, deps)
      expect(result.action).to.equal('rebase_started')
      expect(result.prNumber).to.equal(10)

      const state = getMergeQueueState(hqPath)
      expect(state.currentPR).to.not.be.null
      expect(state.currentPR!.prNumber).to.equal(10)
      expect(state.currentPR!.headBranch).to.equal('PRLT-100/feat/test')
    })

    it('should eject PR with conflicts and try next', () => {
      const pr1 = makePR({ number: 1, headBranch: 'a', createdAt: '2026-01-01T00:00:00Z' })
      const pr2 = makePR({ number: 2, headBranch: 'b', createdAt: '2026-01-02T00:00:00Z' })
      const deps = makeDeps({
        listOpenPRs: () => [pr1, pr2],
        getPRChecks: () => makeChecks(['SUCCESS']),
        updatePRBranch: (prNumber) => {
          if (prNumber === 1) {
            return { success: false, prNumber, headBranch: 'a', hasConflicts: true, error: 'conflict' }
          }
          return { success: true, prNumber, headBranch: 'b' }
        },
      })

      const result = runMergeQueueCycle({ hqPath }, deps)
      expect(result.action).to.equal('rebase_started')
      expect(result.prNumber).to.equal(2)

      const state = getMergeQueueState(hqPath)
      expect(state.currentPR!.prNumber).to.equal(2)
      expect(state.ejectedPRs).to.have.length(1)
      expect(state.ejectedPRs[0].prNumber).to.equal(1)
      expect(state.ejectedPRs[0].reason).to.include('conflict')
    })

    it('should return none when all PRs have conflicts', () => {
      const pr = makePR({ number: 1, headBranch: 'a' })
      const deps = makeDeps({
        listOpenPRs: () => [pr],
        getPRChecks: () => makeChecks(['SUCCESS']),
        updatePRBranch: () => ({ success: false, prNumber: 1, headBranch: 'a', hasConflicts: true }),
      })

      const result = runMergeQueueCycle({ hqPath }, deps)
      expect(result.action).to.equal('none')
      expect(result.reason).to.include('conflicts')
    })
  })

  // ===========================================================================
  // Cycle: Current PR — waiting for CI
  // ===========================================================================

  describe('runMergeQueueCycle — current PR waiting for CI', () => {
    beforeEach(() => {
      // Set up state with a current PR
      const state = getDefaultState()
      state.currentPR = {
        prNumber: 10,
        headBranch: 'PRLT-100/feat/test',
        baseBranch: 'main',
        ticketId: 'PRLT-100',
        priority: 1,
        rebasedAt: new Date().toISOString(),
      }
      saveMergeQueueState(hqPath, state)
    })

    it('should wait when CI is pending', () => {
      const deps = makeDeps({
        getPRByNumber: () => makePR({ number: 10, state: 'OPEN' }),
        getPRChecks: () => makePendingChecks(2),
      })

      const result = runMergeQueueCycle({ hqPath }, deps)
      expect(result.action).to.equal('waiting_ci')
      expect(result.prNumber).to.equal(10)

      // Current PR should still be set
      const state = getMergeQueueState(hqPath)
      expect(state.currentPR).to.not.be.null
    })

    it('should wait when no checks are present yet', () => {
      const deps = makeDeps({
        getPRByNumber: () => makePR({ number: 10, state: 'OPEN' }),
        getPRChecks: () => [],
      })

      const result = runMergeQueueCycle({ hqPath }, deps)
      expect(result.action).to.equal('waiting_ci')
    })

    it('should merge when CI is green', () => {
      let merged = false
      const deps = makeDeps({
        getPRByNumber: () => makePR({ number: 10, state: 'OPEN' }),
        getPRChecks: () => makeChecks(['SUCCESS', 'SUCCESS']),
        mergePR: () => { merged = true; return { success: true } },
        rebaseSiblingPRs: () => ({ succeeded: [], failed: [], skipped: [], totalChecked: 0 }),
      })

      const result = runMergeQueueCycle({ hqPath }, deps)
      expect(result.action).to.equal('merged')
      expect(result.prNumber).to.equal(10)
      expect(merged).to.be.true

      // Current PR should be cleared
      const state = getMergeQueueState(hqPath)
      expect(state.currentPR).to.be.null
      expect(state.lastMergedPR).to.not.be.null
      expect(state.lastMergedPR!.prNumber).to.equal(10)
    })

    it('should eject when CI fails', () => {
      const deps = makeDeps({
        getPRByNumber: () => makePR({ number: 10, state: 'OPEN' }),
        getPRChecks: () => makeChecks(['SUCCESS', 'FAILURE']),
      })

      const result = runMergeQueueCycle({ hqPath }, deps)
      expect(result.action).to.equal('ejected')
      expect(result.prNumber).to.equal(10)
      expect(result.reason).to.include('CI failed')

      const state = getMergeQueueState(hqPath)
      expect(state.currentPR).to.be.null
      expect(state.ejectedPRs).to.have.length(1)
    })

    it('should clear current PR if it was merged externally', () => {
      const deps = makeDeps({
        getPRByNumber: () => makePR({ number: 10, state: 'MERGED' }),
      })

      const result = runMergeQueueCycle({ hqPath }, deps)
      expect(result.action).to.equal('none')

      const state = getMergeQueueState(hqPath)
      expect(state.currentPR).to.be.null
      expect(state.lastMergedPR!.prNumber).to.equal(10)
    })

    it('should clear current PR if it was closed', () => {
      const deps = makeDeps({
        getPRByNumber: () => makePR({ number: 10, state: 'CLOSED' }),
      })

      const result = runMergeQueueCycle({ hqPath }, deps)
      expect(result.action).to.equal('none')

      const state = getMergeQueueState(hqPath)
      expect(state.currentPR).to.be.null
    })

    it('should clear current PR if it no longer exists', () => {
      const deps = makeDeps({
        getPRByNumber: () => null,
      })

      const result = runMergeQueueCycle({ hqPath }, deps)
      expect(result.action).to.equal('none')

      const state = getMergeQueueState(hqPath)
      expect(state.currentPR).to.be.null
    })
  })

  // ===========================================================================
  // Cycle: Merge failure handling
  // ===========================================================================

  describe('runMergeQueueCycle — merge failure handling', () => {
    beforeEach(() => {
      const state = getDefaultState()
      state.currentPR = {
        prNumber: 10,
        headBranch: 'PRLT-100/feat/test',
        baseBranch: 'main',
        ticketId: 'PRLT-100',
        priority: 1,
        rebasedAt: new Date().toISOString(),
      }
      saveMergeQueueState(hqPath, state)
    })

    it('should detect external merge when our merge fails', () => {
      let mergeAttempts = 0
      const deps = makeDeps({
        getPRByNumber: (prNumber) => {
          // First call returns OPEN, second (after merge fail) returns MERGED
          if (mergeAttempts > 0) return makePR({ number: 10, state: 'MERGED' })
          return makePR({ number: 10, state: 'OPEN' })
        },
        getPRChecks: () => makeChecks(['SUCCESS']),
        mergePR: () => { mergeAttempts++; return { success: false, error: 'race condition' } },
      })

      const result = runMergeQueueCycle({ hqPath }, deps)
      expect(result.action).to.equal('merged')
      expect(result.reason).to.include('externally')
    })

    it('should eject when merge fails and PR is still open', () => {
      const deps = makeDeps({
        getPRByNumber: () => makePR({ number: 10, state: 'OPEN' }),
        getPRChecks: () => makeChecks(['SUCCESS']),
        mergePR: () => ({ success: false, error: 'branch protection' }),
      })

      const result = runMergeQueueCycle({ hqPath }, deps)
      expect(result.action).to.equal('ejected')
      expect(result.reason).to.include('Merge failed')
    })
  })

  // ===========================================================================
  // Cycle: Sibling rebase after merge
  // ===========================================================================

  describe('runMergeQueueCycle — sibling rebase after merge', () => {
    beforeEach(() => {
      const state = getDefaultState()
      state.currentPR = {
        prNumber: 10,
        headBranch: 'PRLT-100/feat/test',
        baseBranch: 'main',
        ticketId: 'PRLT-100',
        priority: 1,
        rebasedAt: new Date().toISOString(),
      }
      saveMergeQueueState(hqPath, state)
    })

    it('should rebase siblings after successful merge', () => {
      let rebaseCalled = false
      let excludedPR: number | null = null
      const deps = makeDeps({
        getPRByNumber: () => makePR({ number: 10, state: 'OPEN' }),
        getPRChecks: () => makeChecks(['SUCCESS']),
        mergePR: () => ({ success: true }),
        rebaseSiblingPRs: (options) => {
          rebaseCalled = true
          excludedPR = options.excludePRNumber
          return { succeeded: [{ success: true, prNumber: 20, headBranch: 'b' }], failed: [], skipped: [], totalChecked: 1 }
        },
      })

      const result = runMergeQueueCycle({ hqPath }, deps)
      expect(result.action).to.equal('merged')
      expect(rebaseCalled).to.be.true
      expect(excludedPR).to.equal(10)
    })
  })

  // ===========================================================================
  // Ejection history
  // ===========================================================================

  describe('Ejection history', () => {
    it('should limit ejected PRs to 10', () => {
      const state = getDefaultState()
      // Pre-fill with 10 ejected PRs
      for (let i = 0; i < 10; i++) {
        state.ejectedPRs.push({
          prNumber: i,
          headBranch: `branch-${i}`,
          reason: 'test',
          ejectedAt: new Date().toISOString(),
        })
      }
      saveMergeQueueState(hqPath, state)

      // Run a cycle that ejects another PR
      const pr = makePR({ number: 99, headBranch: 'conflict-branch' })
      const deps = makeDeps({
        listOpenPRs: () => [pr],
        getPRChecks: () => makeChecks(['SUCCESS']),
        updatePRBranch: () => ({ success: false, prNumber: 99, headBranch: 'conflict-branch', hasConflicts: true }),
      })

      runMergeQueueCycle({ hqPath }, deps)

      const updated = getMergeQueueState(hqPath)
      expect(updated.ejectedPRs).to.have.length(10) // Still max 10
      expect(updated.ejectedPRs[0].prNumber).to.equal(99) // Newest first
    })
  })

  // ===========================================================================
  // Merge method configuration
  // ===========================================================================

  describe('Merge method configuration', () => {
    beforeEach(() => {
      const state = getDefaultState()
      state.currentPR = {
        prNumber: 10,
        headBranch: 'PRLT-100/feat/test',
        baseBranch: 'main',
        ticketId: null,
        priority: 3,
        rebasedAt: new Date().toISOString(),
      }
      saveMergeQueueState(hqPath, state)
    })

    it('should default to squash merge', () => {
      let usedMethod: string | undefined
      const deps = makeDeps({
        getPRByNumber: () => makePR({ number: 10, state: 'OPEN' }),
        getPRChecks: () => makeChecks(['SUCCESS']),
        mergePR: (_prNumber, options) => { usedMethod = options?.method; return { success: true } },
        rebaseSiblingPRs: () => ({ succeeded: [], failed: [], skipped: [], totalChecked: 0 }),
      })

      runMergeQueueCycle({ hqPath }, deps)
      expect(usedMethod).to.equal('squash')
    })

    it('should use configured merge method', () => {
      let usedMethod: string | undefined
      const deps = makeDeps({
        getPRByNumber: () => makePR({ number: 10, state: 'OPEN' }),
        getPRChecks: () => makeChecks(['SUCCESS']),
        mergePR: (_prNumber, options) => { usedMethod = options?.method; return { success: true } },
        rebaseSiblingPRs: () => ({ succeeded: [], failed: [], skipped: [], totalChecked: 0 }),
      })

      runMergeQueueCycle({ hqPath, mergeMethod: 'rebase' }, deps)
      expect(usedMethod).to.equal('rebase')
    })
  })

  // ===========================================================================
  // Last cycle timestamp
  // ===========================================================================

  describe('Cycle timestamp', () => {
    it('should update lastCycleAt on every cycle', () => {
      const before = new Date().toISOString()
      runMergeQueueCycle({ hqPath }, makeDeps())
      const state = getMergeQueueState(hqPath)
      expect(state.lastCycleAt).to.not.be.null
      expect(state.lastCycleAt! >= before).to.be.true
    })
  })
})
