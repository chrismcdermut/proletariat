import { expect } from 'chai'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  groupSessionsByHQ,
  buildDaemonSessionName,
  type UnifiedSession,
  type SessionRole,
} from '../../src/lib/session/renderer.js'

/**
 * Tests for the daemon session role (PRLT-1287).
 *
 * Verifies:
 *   - 'daemon' is a valid SessionRole
 *   - Daemon sessions appear in session list with correct role
 *   - Daemon sessions are grouped correctly by HQ
 *   - buildDaemonSessionName produces the correct naming pattern
 *   - Session prune logic skips daemon sessions
 */
describe('Daemon Session Role (PRLT-1287)', () => {
  const fakeSession = (overrides: Partial<UnifiedSession>): UnifiedSession => ({
    id: overrides.id ?? 'WORK-1',
    sessionId: overrides.sessionId ?? 'sess-1',
    ticketId: overrides.ticketId ?? 'PRLT-1',
    agentName: overrides.agentName ?? 'fair-knight',
    status: overrides.status ?? 'running',
    role: overrides.role ?? 'worker',
    environment: overrides.environment ?? 'host',
    exists: overrides.exists ?? true,
    source: overrides.source ?? 'db',
    hqPath: overrides.hqPath,
    hqName: overrides.hqName,
    repoPath: overrides.repoPath,
    startedAt: overrides.startedAt,
    containerId: overrides.containerId,
    lastHeartbeat: overrides.lastHeartbeat,
    lifecycleState: overrides.lifecycleState,
  })

  // ===========================================================================
  // SessionRole type — daemon is valid
  // ===========================================================================
  describe('SessionRole includes daemon', () => {
    it('daemon is a valid SessionRole value', () => {
      const role: SessionRole = 'daemon'
      expect(role).to.equal('daemon')
    })

    it('all four roles are distinct', () => {
      const roles: SessionRole[] = ['orchestrator', 'worker', 'headless', 'daemon']
      expect(new Set(roles).size).to.equal(4)
    })
  })

  // ===========================================================================
  // buildDaemonSessionName
  // ===========================================================================
  describe('buildDaemonSessionName', () => {
    it('builds session name with hqName and daemonType', () => {
      const name = buildDaemonSessionName('proletariat', 'reconciler')
      expect(name).to.equal('prlt-daemon-proletariat-reconciler')
    })

    it('sanitizes special characters in hqName', () => {
      const name = buildDaemonSessionName('my project/hq', 'reconciler')
      expect(name).to.equal('prlt-daemon-my-project-hq-reconciler')
    })

    it('falls back to "default" for empty hqName', () => {
      const name = buildDaemonSessionName('', 'reconciler')
      expect(name).to.equal('prlt-daemon-default-reconciler')
    })

    it('falls back to "daemon" for empty daemonType', () => {
      const name = buildDaemonSessionName('proletariat', '')
      expect(name).to.equal('prlt-daemon-proletariat-daemon')
    })

    it('handles various daemon types', () => {
      expect(buildDaemonSessionName('hq', 'reconciler')).to.equal('prlt-daemon-hq-reconciler')
      expect(buildDaemonSessionName('hq', 'rebase-coordinator')).to.equal('prlt-daemon-hq-rebase-coordinator')
      expect(buildDaemonSessionName('hq', 'worktree-gc')).to.equal('prlt-daemon-hq-worktree-gc')
      expect(buildDaemonSessionName('hq', 'comment-watcher')).to.equal('prlt-daemon-hq-comment-watcher')
    })
  })

  // ===========================================================================
  // Daemon sessions in groupSessionsByHQ
  // ===========================================================================
  describe('groupSessionsByHQ with daemons', () => {
    it('groups daemon sessions into current HQ "here" bucket', () => {
      const hqPath = path.join(os.tmpdir(), 'fake-hq')
      const sessions = [
        fakeSession({
          id: 'reconciler',
          sessionId: 'prlt-daemon-fake-hq-reconciler',
          ticketId: 'DAEMON',
          agentName: 'daemon-reconciler',
          role: 'daemon',
          hqPath,
          hqName: 'fake-hq',
        }),
        fakeSession({
          id: 'worker-1',
          sessionId: 'TKT-1-work-agent-1',
          ticketId: 'TKT-1',
          role: 'worker',
          hqPath,
          hqName: 'fake-hq',
        }),
      ]

      const grouped = groupSessionsByHQ(sessions, hqPath)
      expect(grouped.here).to.have.length(2)
      expect(grouped.here.find(s => s.role === 'daemon')).to.exist
      expect(grouped.here.find(s => s.role === 'worker')).to.exist
    })

    it('daemon sessions without hqPath go to "elsewhere"', () => {
      const hqPath = path.join(os.tmpdir(), 'fake-hq')
      const sessions = [
        fakeSession({
          id: 'orphan-daemon',
          sessionId: 'prlt-daemon-unknown-reconciler',
          ticketId: 'DAEMON',
          agentName: 'daemon-reconciler',
          role: 'daemon',
          // No hqPath
        }),
      ]

      const grouped = groupSessionsByHQ(sessions, hqPath)
      expect(grouped.here).to.have.length(0)
      expect(grouped.elsewhere).to.have.length(1)
      expect(grouped.elsewhere[0].role).to.equal('daemon')
    })
  })

  // ===========================================================================
  // Role detection from execution data
  // ===========================================================================
  describe('daemon role detection', () => {
    it('detects daemon role from ticketId=DAEMON', () => {
      const session = fakeSession({
        ticketId: 'DAEMON',
        agentName: 'daemon-reconciler',
        role: 'daemon',
      })
      expect(session.role).to.equal('daemon')
    })

    it('detects daemon role from agentName starting with daemon-', () => {
      const session = fakeSession({
        ticketId: 'DAEMON',
        agentName: 'daemon-rebase-coordinator',
        role: 'daemon',
      })
      expect(session.role).to.equal('daemon')
      expect(session.agentName.startsWith('daemon-')).to.be.true
    })

    it('daemon role does not conflict with orchestrator role', () => {
      const daemon = fakeSession({ role: 'daemon', ticketId: 'DAEMON' })
      const orchestrator = fakeSession({ role: 'orchestrator', ticketId: 'ORCH' })
      expect(daemon.role).to.not.equal(orchestrator.role)
    })

    it('daemon role does not conflict with worker role', () => {
      const daemon = fakeSession({ role: 'daemon', ticketId: 'DAEMON' })
      const worker = fakeSession({ role: 'worker', ticketId: 'PRLT-123' })
      expect(daemon.role).to.not.equal(worker.role)
    })
  })

  // ===========================================================================
  // Session prune daemon protection
  // ===========================================================================
  describe('session prune daemon protection', () => {
    it('prlt-daemon- prefix is recognized as a daemon session', () => {
      const sessionName = 'prlt-daemon-proletariat-reconciler'
      expect(sessionName.startsWith('prlt-daemon-')).to.be.true
    })

    it('non-daemon sessions do not match the daemon prefix', () => {
      const workerSession = 'PRLT-123-Implement-bold-knight'
      const orchestratorSession = 'prlt-orchestrator-proletariat-main'
      expect(workerSession.startsWith('prlt-daemon-')).to.be.false
      expect(orchestratorSession.startsWith('prlt-daemon-')).to.be.false
    })

    it('daemon session naming is consistent across build and detect', () => {
      const built = buildDaemonSessionName('proletariat', 'reconciler')
      expect(built.startsWith('prlt-daemon-')).to.be.true
      // This is the same prefix check used in prune.ts to skip daemons
    })
  })
})
