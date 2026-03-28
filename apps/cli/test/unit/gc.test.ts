import { expect } from 'chai'
import type { PRInfo } from '../../src/lib/pr/index.js'
import type { ContainerInfo } from '../../src/lib/execution/container-cleanup.js'
import {
  GCScheduler,
  classifyArtifact,
  parseWorktreeList,
  extractAgentName,
} from '../../src/lib/gc/index.js'

/**
 * GC Module Unit Tests
 *
 * Tests the garbage collection logic:
 * - classifyArtifact: PR status → GC status mapping
 * - parseWorktreeList: git worktree list parsing
 * - extractAgentName: worktree path → agent name extraction
 * - GCScheduler: grace period scheduling
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

// =============================================================================
// classifyArtifact Tests
// =============================================================================

describe('@smoke GC classifyArtifact', () => {
  it('should classify merged PR as merged', () => {
    const pr = makePR({ state: 'MERGED' })
    expect(classifyArtifact(pr, 7)).to.equal('merged')
  })

  it('should classify closed PR as closed', () => {
    const pr = makePR({ state: 'CLOSED' })
    expect(classifyArtifact(pr, 7)).to.equal('closed')
  })

  it('should classify null PR (no PR found) as closed', () => {
    expect(classifyArtifact(null, 7)).to.equal('closed')
  })

  it('should classify recently active open PR as active', () => {
    const pr = makePR({
      state: 'OPEN',
      updatedAt: new Date().toISOString(),
    })
    expect(classifyArtifact(pr, 7)).to.equal('active')
  })

  it('should classify old open PR as stale', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const pr = makePR({
      state: 'OPEN',
      updatedAt: eightDaysAgo,
    })
    expect(classifyArtifact(pr, 7)).to.equal('stale')
  })

  it('should respect custom staleDays threshold', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const pr = makePR({
      state: 'OPEN',
      updatedAt: threeDaysAgo,
    })
    // 2-day threshold → stale
    expect(classifyArtifact(pr, 2)).to.equal('stale')
    // 7-day threshold → active
    expect(classifyArtifact(pr, 7)).to.equal('active')
  })

  it('should classify PR updated exactly at threshold as stale', () => {
    // Exactly 7 days ago should be at the boundary
    const exactlySevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const pr = makePR({
      state: 'OPEN',
      updatedAt: exactlySevenDaysAgo,
    })
    // At exactly the threshold, daysSinceUpdate >= staleDays, so it's stale
    expect(classifyArtifact(pr, 7)).to.equal('stale')
  })
})

// =============================================================================
// parseWorktreeList Tests
// =============================================================================

describe('@smoke GC parseWorktreeList', () => {
  it('should parse a single worktree entry', () => {
    const output = `worktree /workspace/repos/proletariat
branch refs/heads/main
`
    const entries = parseWorktreeList(output)
    expect(entries).to.have.length(1)
    expect(entries[0].worktreePath).to.equal('/workspace/repos/proletariat')
    expect(entries[0].branch).to.equal('main')
    expect(entries[0].isPrunable).to.be.false
  })

  it('should parse multiple worktree entries', () => {
    const output = `worktree /workspace/repos/proletariat
branch refs/heads/main

worktree /workspace/agents/temp/bold-turing/proletariat
branch refs/heads/PRLT-100/feat/test

worktree /workspace/agents/temp/clever-ada/proletariat
branch refs/heads/PRLT-101/feat/other
`
    const entries = parseWorktreeList(output)
    expect(entries).to.have.length(3)
    expect(entries[1].branch).to.equal('PRLT-100/feat/test')
    expect(entries[2].branch).to.equal('PRLT-101/feat/other')
  })

  it('should detect prunable worktrees', () => {
    const output = `worktree /workspace/agents/temp/stale-agent/proletariat
branch refs/heads/PRLT-50/feat/old
prunable gitdir file points to non-existent location
`
    const entries = parseWorktreeList(output)
    expect(entries).to.have.length(1)
    expect(entries[0].isPrunable).to.be.true
  })

  it('should handle worktrees without branch (detached HEAD)', () => {
    const output = `worktree /workspace/agents/temp/detached/proletariat
HEAD abc1234567890

`
    const entries = parseWorktreeList(output)
    expect(entries).to.have.length(1)
    expect(entries[0].branch).to.equal('')
  })

  it('should return empty array for empty output', () => {
    expect(parseWorktreeList('')).to.have.length(0)
  })
})

// =============================================================================
// extractAgentName Tests
// =============================================================================

describe('@smoke GC extractAgentName', () => {
  it('should extract agent name from standard worktree path', () => {
    const name = extractAgentName(
      '/workspace/agents/temp/bold-turing/proletariat',
      '/workspace',
    )
    expect(name).to.equal('bold-turing')
  })

  it('should extract agent name from staff worktree path', () => {
    const name = extractAgentName(
      '/hq/agents/staff/alice/proletariat',
      '/hq',
    )
    expect(name).to.equal('alice')
  })

  it('should return null for non-agent worktrees', () => {
    const name = extractAgentName(
      '/workspace/repos/proletariat',
      '/workspace',
    )
    expect(name).to.be.null
  })

  it('should return null for paths without enough segments', () => {
    const name = extractAgentName(
      '/workspace/agents/temp',
      '/workspace',
    )
    expect(name).to.be.null
  })

  it('should handle theme-based directory names', () => {
    const name = extractAgentName(
      '/hq/agents/pit/swift-racer/myrepo',
      '/hq',
    )
    expect(name).to.equal('swift-racer')
  })
})

// =============================================================================
// GCScheduler Tests
// =============================================================================

describe('@smoke GC Scheduler', () => {
  describe('schedule', () => {
    it('should schedule a branch for cleanup', () => {
      const scheduler = new GCScheduler(1000)
      scheduler.schedule('PRLT-100/feat/test')
      expect(scheduler.size).to.equal(1)
    })

    it('should not duplicate scheduled branches', () => {
      const scheduler = new GCScheduler(1000)
      scheduler.schedule('PRLT-100/feat/test')
      scheduler.schedule('PRLT-100/feat/test')
      expect(scheduler.size).to.equal(1)
    })

    it('should schedule multiple branches', () => {
      const scheduler = new GCScheduler(1000)
      scheduler.schedule('PRLT-100/feat/test')
      scheduler.schedule('PRLT-101/feat/other')
      expect(scheduler.size).to.equal(2)
    })
  })

  describe('getReady', () => {
    it('should not return branches before grace period expires', () => {
      const scheduler = new GCScheduler(60000) // 1 minute
      scheduler.schedule('PRLT-100/feat/test')
      expect(scheduler.getReady()).to.have.length(0)
    })

    it('should return branches after grace period expires', () => {
      const scheduler = new GCScheduler(0)
      scheduler.schedule('PRLT-100/feat/test')
      const ready = scheduler.getReady()
      expect(ready).to.have.length(1)
      expect(ready[0]).to.equal('PRLT-100/feat/test')
    })

    it('should return only expired branches in a mixed set', () => {
      const scheduler = new GCScheduler(0)
      scheduler.schedule('PRLT-100/feat/ready')
      scheduler.schedule('PRLT-101/feat/also-ready')

      const ready = scheduler.getReady()
      expect(ready).to.have.length(2)
    })
  })

  describe('complete', () => {
    it('should remove completed branches from pending', () => {
      const scheduler = new GCScheduler(0)
      scheduler.schedule('PRLT-100/feat/test')
      expect(scheduler.size).to.equal(1)

      scheduler.complete('PRLT-100/feat/test')
      expect(scheduler.size).to.equal(0)
    })

    it('should not fail when completing unknown branches', () => {
      const scheduler = new GCScheduler(0)
      expect(() => scheduler.complete('nonexistent')).to.not.throw()
    })

    it('should only remove the completed branch, not others', () => {
      const scheduler = new GCScheduler(0)
      scheduler.schedule('PRLT-100/feat/test')
      scheduler.schedule('PRLT-101/feat/other')

      scheduler.complete('PRLT-100/feat/test')
      expect(scheduler.size).to.equal(1)
      expect(scheduler.getReady()).to.deep.equal(['PRLT-101/feat/other'])
    })
  })

  describe('getPending', () => {
    it('should return all pending cleanups', () => {
      const scheduler = new GCScheduler(60000)
      scheduler.schedule('PRLT-100/feat/test')
      scheduler.schedule('PRLT-101/feat/other')

      const pending = scheduler.getPending()
      expect(pending).to.have.length(2)
      expect(pending.map(p => p.branch)).to.include.members([
        'PRLT-100/feat/test',
        'PRLT-101/feat/other',
      ])
    })

    it('should include scheduling timestamps', () => {
      const before = Date.now()
      const scheduler = new GCScheduler(3600000) // 1 hour
      scheduler.schedule('PRLT-100/feat/test')
      const after = Date.now()

      const pending = scheduler.getPending()
      expect(pending[0].scheduledAt).to.be.at.least(before)
      expect(pending[0].scheduledAt).to.be.at.most(after)
      expect(pending[0].graceUntil).to.be.at.least(before + 3600000)
      expect(pending[0].graceUntil).to.be.at.most(after + 3600000)
    })
  })

  describe('size', () => {
    it('should return 0 for empty scheduler', () => {
      const scheduler = new GCScheduler(1000)
      expect(scheduler.size).to.equal(0)
    })

    it('should track size as items are added and removed', () => {
      const scheduler = new GCScheduler(0)
      expect(scheduler.size).to.equal(0)

      scheduler.schedule('a')
      expect(scheduler.size).to.equal(1)

      scheduler.schedule('b')
      expect(scheduler.size).to.equal(2)

      scheduler.complete('a')
      expect(scheduler.size).to.equal(1)

      scheduler.complete('b')
      expect(scheduler.size).to.equal(0)
    })
  })

  describe('grace period behavior', () => {
    it('should enforce 1-hour default grace period', () => {
      const scheduler = new GCScheduler() // default 1 hour
      scheduler.schedule('PRLT-100/feat/test')

      const pending = scheduler.getPending()
      const graceDuration = pending[0].graceUntil - pending[0].scheduledAt
      expect(graceDuration).to.equal(3600000) // 1 hour in ms
    })

    it('should support custom grace periods', () => {
      const scheduler = new GCScheduler(300000) // 5 minutes
      scheduler.schedule('PRLT-100/feat/test')

      const pending = scheduler.getPending()
      const graceDuration = pending[0].graceUntil - pending[0].scheduledAt
      expect(graceDuration).to.equal(300000)
    })

    it('should support zero grace period for immediate cleanup', () => {
      const scheduler = new GCScheduler(0)
      scheduler.schedule('PRLT-100/feat/test')

      // Should be immediately ready
      expect(scheduler.getReady()).to.have.length(1)
    })
  })

  describe('end-to-end scheduling flow', () => {
    it('should handle a full lifecycle: schedule → wait → ready → complete', () => {
      const scheduler = new GCScheduler(0)

      // Schedule cleanup for a merged PR's branch
      scheduler.schedule('PRLT-100/feat/implement-auth')
      expect(scheduler.size).to.equal(1)

      // Check what's ready
      const ready = scheduler.getReady()
      expect(ready).to.deep.equal(['PRLT-100/feat/implement-auth'])

      // Process cleanup and mark complete
      scheduler.complete('PRLT-100/feat/implement-auth')
      expect(scheduler.size).to.equal(0)
      expect(scheduler.getReady()).to.have.length(0)
    })

    it('should handle multiple branches at different stages', () => {
      const scheduler = new GCScheduler(0)

      scheduler.schedule('PRLT-100/feat/first')
      scheduler.schedule('PRLT-101/feat/second')
      scheduler.schedule('PRLT-102/feat/third')

      // Complete first, check others remain
      scheduler.complete('PRLT-100/feat/first')
      expect(scheduler.size).to.equal(2)

      const ready = scheduler.getReady()
      expect(ready).to.have.length(2)
      expect(ready).to.include('PRLT-101/feat/second')
      expect(ready).to.include('PRLT-102/feat/third')
    })
  })
})
