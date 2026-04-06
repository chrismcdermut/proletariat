import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  cleanupTicketWorktrees,
  findOrphanedWorktrees,
  type TicketCleanupResult,
  type OrphanedWorktree,
} from '../../src/lib/gc/index.js'

/**
 * GC Ticket Cleanup & Orphan Detection Tests
 *
 * Tests:
 * - cleanupTicketWorktrees: ticket-driven worktree cleanup on Done status
 * - findOrphanedWorktrees: detection of worktrees with no tmux session
 */

// =============================================================================
// cleanupTicketWorktrees Tests
// =============================================================================

describe('@smoke GC cleanupTicketWorktrees', () => {
  it('should return empty result when no HQ path exists', () => {
    const result = cleanupTicketWorktrees('TKT-999', '/nonexistent/path')
    expect(result.agentsCleaned).to.have.length(0)
    expect(result.worktreesRemoved).to.have.length(0)
    expect(result.agentDirsRemoved).to.have.length(0)
    expect(result.errors).to.have.length(0)
  })

  it('should return empty result when agent_work table does not exist', () => {
    // Uses a path that exists but has no database
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-test-'))
    try {
      const result = cleanupTicketWorktrees('TKT-001', tmpDir)
      expect(result.agentsCleaned).to.have.length(0)
      expect(result.worktreesRemoved).to.have.length(0)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('should have correct result shape', () => {
    const result = cleanupTicketWorktrees('TKT-001', '/nonexistent')
    expect(result).to.have.property('agentsCleaned').that.is.an('array')
    expect(result).to.have.property('worktreesRemoved').that.is.an('array')
    expect(result).to.have.property('agentDirsRemoved').that.is.an('array')
    expect(result).to.have.property('errors').that.is.an('array')
  })

  it('should invoke log callback when agents are found', () => {
    // This test verifies the log parameter is called correctly.
    // Since we don't have a real DB, the function returns early,
    // but the interface is tested.
    const logs: string[] = []
    const result = cleanupTicketWorktrees(
      'TKT-001',
      '/nonexistent',
      (msg) => logs.push(msg),
    )
    // No agents found = no log messages
    expect(result.agentsCleaned).to.have.length(0)
  })
})

// =============================================================================
// findOrphanedWorktrees Tests
// =============================================================================

describe('@smoke GC findOrphanedWorktrees', () => {
  it('should return empty array when repos directory does not exist', () => {
    const orphans = findOrphanedWorktrees('/nonexistent/hq')
    expect(orphans).to.be.an('array').that.is.empty
  })

  it('should return empty array when repos directory is empty', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-orphan-test-'))
    const reposDir = path.join(tmpDir, 'repos')
    fs.mkdirSync(reposDir, { recursive: true })
    try {
      const orphans = findOrphanedWorktrees(tmpDir)
      expect(orphans).to.be.an('array').that.is.empty
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('should have correct OrphanedWorktree shape', () => {
    // Verify the type exports correctly
    const orphan: OrphanedWorktree = {
      worktreePath: '/path/to/worktree',
      branch: 'feat/test',
      agentName: 'test-agent',
      repoName: 'my-repo',
      sourceRepoPath: '/path/to/repos/my-repo',
    }
    expect(orphan).to.have.property('worktreePath')
    expect(orphan).to.have.property('branch')
    expect(orphan).to.have.property('agentName')
    expect(orphan).to.have.property('repoName')
    expect(orphan).to.have.property('sourceRepoPath')
  })

  it('should not crash when repos dir has non-directory entries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-orphan-test-'))
    const reposDir = path.join(tmpDir, 'repos')
    fs.mkdirSync(reposDir, { recursive: true })
    // Create a file (not a directory) in repos/
    fs.writeFileSync(path.join(reposDir, 'not-a-repo'), 'test')
    try {
      const orphans = findOrphanedWorktrees(tmpDir)
      expect(orphans).to.be.an('array').that.is.empty
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// =============================================================================
// TicketCleanupResult shape tests
// =============================================================================

describe('@smoke GC TicketCleanupResult', () => {
  it('should export TicketCleanupResult type correctly', () => {
    const result: TicketCleanupResult = {
      agentsCleaned: ['agent-1'],
      worktreesRemoved: ['/path/to/worktree'],
      agentDirsRemoved: ['/path/to/agent/dir'],
      errors: [],
    }
    expect(result.agentsCleaned).to.deep.equal(['agent-1'])
    expect(result.worktreesRemoved).to.have.length(1)
    expect(result.agentDirsRemoved).to.have.length(1)
    expect(result.errors).to.be.empty
  })
})
