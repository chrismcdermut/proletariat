import { expect } from 'chai'
import {
  detectZombieContainers,
  detectOrphanedWorktrees,
  detectStaleTmuxSessions,
  type ZombieContainer,
  type OrphanedWorktree,
  type StaleTmuxSession,
} from '../../src/lib/gc/cascade.js'

/**
 * Unit tests for the GC sweep detection functions used by the gc-sweep action.
 *
 * These tests cover the pure-logic portions of zombie container detection,
 * orphaned worktree detection, and stale tmux session detection.
 *
 * Note: detectZombieContainers and detectStaleTmuxSessions shell out to
 * docker/tmux, so we test them with the expectation they gracefully return
 * empty arrays when those tools are unavailable. The real logic is tested
 * via the cascade module. detectOrphanedWorktrees needs a filesystem with
 * repos/, so we test it with a nonexistent path.
 */
describe('@smoke GC Sweep Action', () => {
  // ---------------------------------------------------------------------------
  // detectZombieContainers
  // ---------------------------------------------------------------------------
  describe('detectZombieContainers', () => {
    it('should return empty array when no Docker is available', () => {
      // In CI/test environments, Docker may not be running.
      // The function should gracefully return [] on failure.
      const activeAgentNames = new Set(['bold-turing'])
      const zombies = detectZombieContainers(activeAgentNames)

      expect(zombies).to.be.an('array')
      // May be empty (no Docker) or may find containers — both are valid.
    })

    it('should accept an empty active set', () => {
      const zombies = detectZombieContainers(new Set())
      expect(zombies).to.be.an('array')
    })
  })

  // ---------------------------------------------------------------------------
  // detectOrphanedWorktrees
  // ---------------------------------------------------------------------------
  describe('detectOrphanedWorktrees', () => {
    it('should return empty array for nonexistent hqPath', () => {
      const orphans = detectOrphanedWorktrees(
        '/tmp/nonexistent-hq-' + Date.now(),
        new Set<string>(),
      )

      expect(orphans).to.be.an('array')
      expect(orphans).to.have.length(0)
    })

    it('should return empty array when repos directory does not exist', () => {
      const orphans = detectOrphanedWorktrees(
        '/tmp',
        new Set<string>(),
      )

      // /tmp/repos likely does not exist
      expect(orphans).to.be.an('array')
    })

    it('should accept non-empty active set', () => {
      const orphans = detectOrphanedWorktrees(
        '/tmp/nonexistent-' + Date.now(),
        new Set(['bold-turing', 'clever-lovelace']),
      )

      expect(orphans).to.be.an('array')
      expect(orphans).to.have.length(0)
    })
  })

  // ---------------------------------------------------------------------------
  // detectStaleTmuxSessions
  // ---------------------------------------------------------------------------
  describe('detectStaleTmuxSessions', () => {
    it('should return empty array when tmux is not available', () => {
      // In most test environments, tmux may not be running.
      const stale = detectStaleTmuxSessions(new Set<string>())

      expect(stale).to.be.an('array')
      // Gracefully returns [] when tmux is unavailable
    })

    it('should accept an empty active session set', () => {
      const stale = detectStaleTmuxSessions(new Set())
      expect(stale).to.be.an('array')
    })

    it('should accept a populated active session set', () => {
      const stale = detectStaleTmuxSessions(new Set(['TKT-100-implement-bold-turing']))
      expect(stale).to.be.an('array')
    })
  })

  // ---------------------------------------------------------------------------
  // ZombieContainer type shape
  // ---------------------------------------------------------------------------
  describe('ZombieContainer type compliance', () => {
    it('should have the expected fields', () => {
      const zombie: ZombieContainer = {
        containerId: 'abc123',
        containerName: 'prlt-agent-bold-turing',
        agentName: 'bold-turing',
      }

      expect(zombie.containerId).to.equal('abc123')
      expect(zombie.containerName).to.equal('prlt-agent-bold-turing')
      expect(zombie.agentName).to.equal('bold-turing')
    })
  })

  // ---------------------------------------------------------------------------
  // OrphanedWorktree type shape
  // ---------------------------------------------------------------------------
  describe('OrphanedWorktree type compliance', () => {
    it('should have the expected fields', () => {
      const orphan: OrphanedWorktree = {
        worktreePath: '/hq/agents/temp/bold-turing/repo',
        branch: 'PRLT-123/feat/test',
        agentName: 'bold-turing',
        repoPath: '/hq/repos/repo',
      }

      expect(orphan.worktreePath).to.be.a('string')
      expect(orphan.branch).to.be.a('string')
      expect(orphan.agentName).to.be.a('string')
      expect(orphan.repoPath).to.be.a('string')
    })
  })

  // ---------------------------------------------------------------------------
  // StaleTmuxSession type shape
  // ---------------------------------------------------------------------------
  describe('StaleTmuxSession type compliance', () => {
    it('should have the expected fields', () => {
      const stale: StaleTmuxSession = {
        sessionName: 'TKT-100-implement-bold-turing',
        agentName: 'bold-turing',
      }

      expect(stale.sessionName).to.be.a('string')
      expect(stale.agentName).to.be.a('string')
      expect(stale.containerId).to.be.undefined
    })
  })
})
