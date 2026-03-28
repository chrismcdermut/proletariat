import { expect } from 'chai'
import Database from 'better-sqlite3'
import type { PRInfo } from '../../src/lib/pr/index.js'
import type { ContainerInfo } from '../../src/lib/execution/container-cleanup.js'
import {
  GCScheduler,
  classifyArtifact,
  parseWorktreeList,
  extractAgentName,
  executeGC,
  deleteRemoteBranch,
  killTmuxInContainer,
  cleanClaudeSessionData,
  markExecutionRecordsCleaned,
  purgeExecutionRecords,
  recycleAgentNames,
  type GCCandidate,
  type GCResult,
} from '../../src/lib/gc/index.js'

/**
 * GC Module Unit Tests
 *
 * Tests the garbage collection logic:
 * - classifyArtifact: PR status → GC status mapping
 * - parseWorktreeList: git worktree list parsing
 * - extractAgentName: worktree path → agent name extraction
 * - GCScheduler: grace period scheduling
 * - executeGC: new artifact cleanup fields (remote branches, tmux, claude, DB, agent names)
 * - Helper functions: deleteRemoteBranch, killTmuxInContainer, etc.
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

// =============================================================================
// GCResult Structure Tests (PRLT-1176)
// =============================================================================

describe('@smoke GC Result structure', () => {
  function makeCandidate(overrides: Partial<GCCandidate> = {}): GCCandidate {
    return {
      worktreePath: '/workspace/agents/temp/bold-turing/proletariat',
      branch: 'PRLT-100/feat/test',
      agentName: 'bold-turing',
      repoName: 'proletariat',
      sourceRepoPath: '/workspace/repos/proletariat',
      pr: makePR({ state: 'MERGED' }),
      status: 'merged',
      container: null,
      ...overrides,
    }
  }

  it('should include remoteBranchesDeleted in dry-run result', () => {
    const candidate = makeCandidate()
    const result = executeGC([candidate], {
      hqPath: '/workspace',
      execute: false,
    })
    expect(result).to.have.property('remoteBranchesDeleted')
    expect(result.remoteBranchesDeleted).to.be.an('array')
    expect(result.remoteBranchesDeleted).to.include('PRLT-100/feat/test')
  })

  it('should include tmuxSessionsCleaned in result', () => {
    const candidate = makeCandidate({
      container: {
        containerId: 'abc123',
        containerName: 'prlt-agent-bold-turing',
        agentName: 'bold-turing',
        running: true,
        status: 'running',
      },
    })
    const result = executeGC([candidate], {
      hqPath: '/workspace',
      execute: false,
    })
    expect(result).to.have.property('tmuxSessionsCleaned')
    expect(result.tmuxSessionsCleaned).to.be.an('array')
    expect(result.tmuxSessionsCleaned).to.include('prlt-agent-bold-turing')
  })

  it('should include claudeSessionsCleaned in result', () => {
    const candidate = makeCandidate({
      container: {
        containerId: 'abc123',
        containerName: 'prlt-agent-bold-turing',
        agentName: 'bold-turing',
        running: true,
        status: 'running',
      },
    })
    const result = executeGC([candidate], {
      hqPath: '/workspace',
      execute: false,
    })
    expect(result).to.have.property('claudeSessionsCleaned')
    expect(result.claudeSessionsCleaned).to.be.an('array')
    expect(result.claudeSessionsCleaned).to.include('prlt-agent-bold-turing')
  })

  it('should include dbRecordsMarked in result', () => {
    const result = executeGC([], {
      hqPath: '/workspace',
      execute: false,
    })
    expect(result).to.have.property('dbRecordsMarked')
    expect(result.dbRecordsMarked).to.equal(0)
  })

  it('should include dbRecordsPurged in result', () => {
    const result = executeGC([], {
      hqPath: '/workspace',
      execute: false,
    })
    expect(result).to.have.property('dbRecordsPurged')
    expect(result.dbRecordsPurged).to.equal(0)
  })

  it('should include agentNamesRecycled in result', () => {
    const candidate = makeCandidate()
    const result = executeGC([candidate], {
      hqPath: '/workspace',
      execute: false,
    })
    expect(result).to.have.property('agentNamesRecycled')
    expect(result.agentNamesRecycled).to.be.an('array')
    expect(result.agentNamesRecycled).to.include('bold-turing')
  })

  it('should deduplicate remote branch deletions across multiple candidates with same branch', () => {
    const candidate1 = makeCandidate({ branch: 'PRLT-100/feat/shared' })
    const candidate2 = makeCandidate({
      branch: 'PRLT-100/feat/shared',
      worktreePath: '/workspace/agents/temp/bold-turing/other-repo',
      repoName: 'other-repo',
    })
    const result = executeGC([candidate1, candidate2], {
      hqPath: '/workspace',
      execute: false,
    })
    // Remote branch deletion should only appear once despite two candidates with same branch
    expect(result.remoteBranchesDeleted).to.have.length(1)
    expect(result.remoteBranchesDeleted[0]).to.equal('PRLT-100/feat/shared')
  })

  it('should deduplicate tmux/claude cleanup for same container across multiple candidates', () => {
    const container: ContainerInfo = {
      containerId: 'abc123',
      containerName: 'prlt-agent-bold-turing',
      agentName: 'bold-turing',
      running: true,
      status: 'running',
    }
    const candidate1 = makeCandidate({ container, branch: 'PRLT-100/feat/a' })
    const candidate2 = makeCandidate({ container, branch: 'PRLT-101/feat/b' })
    const result = executeGC([candidate1, candidate2], {
      hqPath: '/workspace',
      execute: false,
    })
    // tmux and claude cleanup should deduplicate by container ID
    expect(result.tmuxSessionsCleaned).to.have.length(1)
    expect(result.claudeSessionsCleaned).to.have.length(1)
  })

  it('should skip active candidates and not include them in new cleanup fields', () => {
    const activeCandidate = makeCandidate({
      status: 'active',
      pr: makePR({ state: 'OPEN', updatedAt: new Date().toISOString() }),
    })
    const result = executeGC([activeCandidate], {
      hqPath: '/workspace',
      execute: false,
    })
    expect(result.remoteBranchesDeleted).to.have.length(0)
    expect(result.agentNamesRecycled).to.have.length(0)
    expect(result.skipped).to.have.length(1)
  })

  it('should collect agent names from all actionable candidates for recycling', () => {
    const candidate1 = makeCandidate({ agentName: 'alpha-agent' })
    const candidate2 = makeCandidate({
      agentName: 'beta-agent',
      branch: 'PRLT-101/feat/other',
      worktreePath: '/workspace/agents/temp/beta-agent/proletariat',
    })
    const result = executeGC([candidate1, candidate2], {
      hqPath: '/workspace',
      execute: false,
    })
    expect(result.agentNamesRecycled).to.include('alpha-agent')
    expect(result.agentNamesRecycled).to.include('beta-agent')
  })
})

// =============================================================================
// deleteRemoteBranch Tests (PRLT-1176)
// =============================================================================

describe('@smoke GC deleteRemoteBranch', () => {
  it('should return false when branch does not exist on remote', () => {
    // This will fail because the branch doesn't exist, but should not throw
    const result = deleteRemoteBranch('nonexistent-branch-gc-test-99999', process.cwd())
    expect(result).to.be.false
  })

  it('should not throw on failure', () => {
    expect(() => {
      deleteRemoteBranch('nonexistent-branch-gc-test-99999', process.cwd())
    }).to.not.throw()
  })
})

// =============================================================================
// killTmuxInContainer Tests (PRLT-1176)
// =============================================================================

describe('@smoke GC killTmuxInContainer', () => {
  it('should return false for non-existent container', () => {
    // Non-existent container — should fail gracefully
    const result = killTmuxInContainer('nonexistent-container-gc-test-99999')
    expect(result).to.be.false
  })

  it('should not throw on failure', () => {
    expect(() => {
      killTmuxInContainer('nonexistent-container-gc-test-99999')
    }).to.not.throw()
  })
})

// =============================================================================
// cleanClaudeSessionData Tests (PRLT-1176)
// =============================================================================

describe('@smoke GC cleanClaudeSessionData', () => {
  it('should return false for non-existent container', () => {
    const result = cleanClaudeSessionData('nonexistent-container-gc-test-99999')
    expect(result).to.be.false
  })

  it('should not throw on failure', () => {
    expect(() => {
      cleanClaudeSessionData('nonexistent-container-gc-test-99999')
    }).to.not.throw()
  })
})

// =============================================================================
// markExecutionRecordsCleaned / purgeExecutionRecords Tests (PRLT-1176)
// =============================================================================

describe('@smoke GC DB record cleanup', () => {
  it('should return 0 for empty agent list', () => {
    const marked = markExecutionRecordsCleaned('/nonexistent/path', [])
    expect(marked).to.equal(0)
  })

  it('should return 0 for purge with empty agent list', () => {
    const purged = purgeExecutionRecords('/nonexistent/path', [])
    expect(purged).to.equal(0)
  })

  it('should return 0 when database does not exist', () => {
    // Non-existent path — should fail gracefully
    const marked = markExecutionRecordsCleaned('/tmp/nonexistent-gc-test-99999', ['some-agent'])
    expect(marked).to.equal(0)
  })

  it('should return 0 for purge when database does not exist', () => {
    const purged = purgeExecutionRecords('/tmp/nonexistent-gc-test-99999', ['some-agent'])
    expect(purged).to.equal(0)
  })
})

// =============================================================================
// recycleAgentNames Tests (PRLT-1176)
// =============================================================================

describe('@smoke GC recycleAgentNames', () => {
  it('should return empty array for empty agent list', () => {
    const recycled = recycleAgentNames('/nonexistent/path', [])
    expect(recycled).to.deep.equal([])
  })

  it('should return empty array when database does not exist', () => {
    // Non-existent path — should fail gracefully
    const recycled = recycleAgentNames('/tmp/nonexistent-gc-test-99999', ['some-agent'])
    expect(recycled).to.deep.equal([])
  })
})

// =============================================================================
// Regression: GCResult must have all new fields (PRLT-1176)
// =============================================================================

describe('@smoke GC PRLT-1176 regression — result fields', () => {
  it('should fail if remoteBranchesDeleted field is missing from GCResult', () => {
    const result: GCResult = executeGC([], { hqPath: '/workspace', execute: false })
    // This test would fail if the field was removed from GCResult
    expect(result).to.have.property('remoteBranchesDeleted')
    expect(Array.isArray(result.remoteBranchesDeleted)).to.be.true
  })

  it('should fail if tmuxSessionsCleaned field is missing from GCResult', () => {
    const result: GCResult = executeGC([], { hqPath: '/workspace', execute: false })
    expect(result).to.have.property('tmuxSessionsCleaned')
    expect(Array.isArray(result.tmuxSessionsCleaned)).to.be.true
  })

  it('should fail if claudeSessionsCleaned field is missing from GCResult', () => {
    const result: GCResult = executeGC([], { hqPath: '/workspace', execute: false })
    expect(result).to.have.property('claudeSessionsCleaned')
    expect(Array.isArray(result.claudeSessionsCleaned)).to.be.true
  })

  it('should fail if dbRecordsMarked field is missing from GCResult', () => {
    const result: GCResult = executeGC([], { hqPath: '/workspace', execute: false })
    expect(result).to.have.property('dbRecordsMarked')
    expect(typeof result.dbRecordsMarked).to.equal('number')
  })

  it('should fail if dbRecordsPurged field is missing from GCResult', () => {
    const result: GCResult = executeGC([], { hqPath: '/workspace', execute: false })
    expect(result).to.have.property('dbRecordsPurged')
    expect(typeof result.dbRecordsPurged).to.equal('number')
  })

  it('should fail if agentNamesRecycled field is missing from GCResult', () => {
    const result: GCResult = executeGC([], { hqPath: '/workspace', execute: false })
    expect(result).to.have.property('agentNamesRecycled')
    expect(Array.isArray(result.agentNamesRecycled)).to.be.true
  })
})
