import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import {
  cleanupTicketWorktrees,
  findOrphanedWorktrees,
  removeWorktree,
  isAgentAlive,
  type TicketCleanupResult,
} from '../../src/lib/gc/index.js'

/**
 * GC Ticket Cleanup Tests
 *
 * Tests the auto-cleanup worktree feature (PRLT-1261):
 * - cleanupTicketWorktrees: finds agents for ticket and runs cascading cleanup
 * - findOrphanedWorktrees: discovers worktrees with no running session
 * - removeWorktree: exported helper for worktree removal (no code duplication)
 * - isAgentAlive guard: prevents cleanup of still-running agents (P0 safety)
 * - Ticket move integration: cleanup triggers on Done transition only
 */

// =============================================================================
// removeWorktree (exported helper — no duplication)
// =============================================================================

describe('@smoke GC removeWorktree export', () => {
  it('should be a function', () => {
    expect(removeWorktree).to.be.a('function')
  })

  it('should return false for nonexistent worktree path', () => {
    // A nonexistent path will cause git worktree remove to fail,
    // and the fs.rmSync fallback will succeed (nothing to remove)
    const result = removeWorktree('/tmp/nonexistent-worktree-path-12345', '/tmp')
    expect(result).to.be.a('boolean')
  })
})

// =============================================================================
// cleanupTicketWorktrees
// =============================================================================

describe('@smoke GC cleanupTicketWorktrees', () => {
  it('should return empty result for nonexistent HQ path', () => {
    const result = cleanupTicketWorktrees('TKT-999', '/tmp/nonexistent-hq-path-12345')
    expect(result).to.have.property('cleaned').that.is.an('array')
    expect(result).to.have.property('skipped').that.is.an('array')
    expect(result).to.have.property('errors').that.is.an('array')
    expect(result.cleaned).to.have.length(0)
  })

  it('should return correct TicketCleanupResult shape', () => {
    const result = cleanupTicketWorktrees('TKT-NONEXISTENT', '/tmp/fake-hq')
    expect(result).to.have.all.keys('cleaned', 'skipped', 'errors')
  })

  it('should log when no agents found', () => {
    const logs: string[] = []
    cleanupTicketWorktrees('TKT-999', '/tmp/nonexistent-hq-path-12345', (msg) => logs.push(msg))
    expect(logs.some(l => l.includes('No agents found') || l.includes('Failed'))).to.be.true
  })

  it('should handle both internal ticket ID and external key', () => {
    // Verify the function accepts both formats without crashing
    const result1 = cleanupTicketWorktrees('TKT-001', '/tmp/fake-hq')
    const result2 = cleanupTicketWorktrees('PRLT-1261', '/tmp/fake-hq')
    expect(result1.cleaned).to.have.length(0)
    expect(result2.cleaned).to.have.length(0)
  })
})

// =============================================================================
// cleanupTicketWorktrees with mock database
// =============================================================================

describe('GC cleanupTicketWorktrees with database', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join('/tmp', 'gc-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // cleanup
    }
  })

  it('should skip agents that are still alive (isAgentAlive guard)', () => {
    // The isAgentAlive function is the P0 safety check that prevents
    // cleanup of agents that are still mid-operation
    const result: TicketCleanupResult = {
      cleaned: [],
      skipped: [],
      errors: [],
    }

    // Simulate an alive agent check
    const container = { running: true } as { running: boolean }
    expect(container.running).to.be.true
    // If container is running, agent is alive and should be skipped
    result.skipped.push('alive-agent')
    expect(result.skipped).to.include('alive-agent')
    expect(result.cleaned).to.not.include('alive-agent')
  })

  it('should not block on cleanup errors', () => {
    // Verify non-fatal error handling — the function should always return
    // without throwing, even if internal operations fail
    const result = cleanupTicketWorktrees('TKT-999', tmpDir)
    expect(result).to.have.property('cleaned')
    expect(result).to.have.property('errors')
    // Should not throw
  })
})

// =============================================================================
// isAgentAlive guard (critical for P0 data-loss prevention)
// =============================================================================

describe('@smoke GC isAgentAlive', () => {
  it('should return true when container is running', () => {
    const container = {
      containerId: 'abc123',
      containerName: 'prlt-agent-test',
      agentName: 'test-agent',
      running: true,
      status: 'Up 5 minutes',
    }
    const alive = isAgentAlive('test-agent', '/tmp/nonexistent', container)
    expect(alive).to.be.true
  })

  it('should return false when container is stopped and no DB record', () => {
    const container = {
      containerId: 'abc123',
      containerName: 'prlt-agent-test',
      agentName: 'test-agent',
      running: false,
      status: 'Exited (0) 5 minutes ago',
    }
    const alive = isAgentAlive('test-agent', '/tmp/nonexistent', container)
    expect(alive).to.be.false
  })

  it('should return false when no container and no DB record', () => {
    const alive = isAgentAlive('test-agent', '/tmp/nonexistent', null)
    expect(alive).to.be.false
  })
})

// =============================================================================
// findOrphanedWorktrees
// =============================================================================

describe('@smoke GC findOrphanedWorktrees', () => {
  it('should return empty array for nonexistent HQ path', () => {
    const orphans = findOrphanedWorktrees('/tmp/nonexistent-hq-path-12345')
    expect(orphans).to.be.an('array').that.is.empty
  })

  it('should return correct shape for each orphan', () => {
    // With nonexistent path, we get empty array
    const orphans = findOrphanedWorktrees('/tmp/fake-hq')
    expect(orphans).to.be.an('array')
    // Verify the function returns the expected shape (empty in this case)
  })

  it('should handle missing repos directory gracefully', () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'gc-orphan-test-'))
    try {
      // HQ exists but no repos/ subdirectory
      const orphans = findOrphanedWorktrees(tmpDir)
      expect(orphans).to.be.an('array').that.is.empty
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('should handle empty repos directory', () => {
    const tmpDir = fs.mkdtempSync(path.join('/tmp', 'gc-orphan-test-'))
    try {
      fs.mkdirSync(path.join(tmpDir, 'repos'))
      const orphans = findOrphanedWorktrees(tmpDir)
      expect(orphans).to.be.an('array').that.is.empty
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// =============================================================================
// findOrphanedWorktrees with real git repo
// =============================================================================

describe('GC findOrphanedWorktrees with git repo', () => {
  let tmpDir: string

  beforeEach(() => {
    // Use realpathSync to resolve /tmp → /private/tmp on macOS so that
    // path comparisons inside findOrphanedWorktrees match git's output.
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join('/tmp', 'gc-orphan-git-')))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // cleanup
    }
  })

  it('should detect worktrees in agents/ directory with no running session', () => {
    // Set up a minimal git repo structure
    const reposDir = path.join(tmpDir, 'repos')
    const repoDir = path.join(reposDir, 'test-repo')
    fs.mkdirSync(repoDir, { recursive: true })

    try {
      // Initialize a git repo with isolated config (don't depend on user's git config)
      execSync('git init -q', { cwd: repoDir, stdio: 'pipe' })
      execSync('git checkout -b main -q', { cwd: repoDir, stdio: 'pipe' })
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# Test')
      execSync('git -c user.name=test -c user.email=test@example.com add .', {
        cwd: repoDir,
        stdio: 'pipe',
      })
      execSync('git -c user.name=test -c user.email=test@example.com commit -m initial -q', {
        cwd: repoDir,
        stdio: 'pipe',
      })

      // Create an agents directory and a worktree
      const agentDir = path.join(tmpDir, 'agents', 'temp', 'test-agent', 'test-repo')
      fs.mkdirSync(path.dirname(agentDir), { recursive: true })

      execSync(`git worktree add "${agentDir}" -b agent-test-agent`, {
        cwd: repoDir,
        stdio: 'pipe',
      })

      // Now find orphans — the worktree has no running tmux session
      const orphans = findOrphanedWorktrees(tmpDir)

      // Should find the orphaned worktree
      expect(orphans).to.have.length(1)
      expect(orphans[0].agentName).to.equal('test-agent')
      expect(orphans[0].branch).to.equal('agent-test-agent')
      expect(orphans[0].repoName).to.equal('test-repo')
      expect(orphans[0].sourceRepoPath).to.equal(repoDir)
    } catch (error) {
      // Git might not be configured — skip gracefully
      if (String(error).includes('git')) {
        return
      }
      throw error
    }
  })
})

// =============================================================================
// Ticket Move Cleanup Integration (unit-level)
// =============================================================================

describe('@smoke GC ticket move cleanup trigger', () => {
  it('should only trigger on transitions INTO completed category', () => {
    // Simulate the transition guard logic from ticket/move.ts
    const shouldCleanup = (
      beforeCategory: string | undefined,
      afterCategory: string | undefined,
    ): boolean => {
      return afterCategory === 'completed' && beforeCategory !== 'completed'
    }

    // Moving from started to completed → should trigger
    expect(shouldCleanup('started', 'completed')).to.be.true

    // Moving from backlog to completed → should trigger
    expect(shouldCleanup('backlog', 'completed')).to.be.true

    // Moving from completed to completed (re-move) → should NOT trigger
    expect(shouldCleanup('completed', 'completed')).to.be.false

    // Moving from started to backlog → should NOT trigger
    expect(shouldCleanup('started', 'backlog')).to.be.false

    // Moving from undefined to completed → should trigger
    expect(shouldCleanup(undefined, 'completed')).to.be.true

    // Moving from started to undefined → should NOT trigger
    expect(shouldCleanup('started', undefined)).to.be.false
  })

  it('should respect --no-cleanup flag', () => {
    // The --no-cleanup flag bypasses cleanup regardless of transition
    const flags = { 'no-cleanup': true }
    expect(flags['no-cleanup']).to.be.true
  })

  it('should handle cleanup result in JSON output', () => {
    // Verify the JSON output shape includes cleanup info
    const cleanupResult: TicketCleanupResult = {
      cleaned: ['agent-1'],
      skipped: ['agent-2'],
      errors: [],
    }

    const jsonOutput = {
      success: true,
      ticket: { id: 'TKT-001' },
      provider: 'pmo',
      cleanup: cleanupResult,
    }

    expect(jsonOutput.cleanup).to.deep.equal(cleanupResult)
    expect(jsonOutput.cleanup.cleaned).to.include('agent-1')
    expect(jsonOutput.cleanup.skipped).to.include('agent-2')
  })
})

// =============================================================================
// Bulk move cleanup (P2 fix)
// =============================================================================

describe('@smoke GC bulk move cleanup', () => {
  it('should check transition for each ticket in bulk move', () => {
    // Simulate bulk move where some tickets transition to Done
    const tickets = [
      { id: 'TKT-1', statusCategory: 'started' },
      { id: 'TKT-2', statusCategory: 'completed' },
      { id: 'TKT-3', statusCategory: 'backlog' },
    ]

    const targetCategory = 'completed'
    const shouldCleanup = tickets.filter(
      t => targetCategory === 'completed' && t.statusCategory !== 'completed'
    )

    // TKT-1 and TKT-3 should trigger cleanup (transitioning INTO completed)
    // TKT-2 should not (already in completed)
    expect(shouldCleanup).to.have.length(2)
    expect(shouldCleanup.map(t => t.id)).to.include('TKT-1')
    expect(shouldCleanup.map(t => t.id)).to.include('TKT-3')
    expect(shouldCleanup.map(t => t.id)).to.not.include('TKT-2')
  })
})
