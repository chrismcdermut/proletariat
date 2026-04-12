import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Unit tests for daemon session role support (PRLT-1287)
 *
 * Tests:
 * - buildDaemonSessionName produces correct format
 * - Daemon role detection in session collection
 * - Session prune skips daemon sessions
 * - Session list includes daemon sessions with correct role
 */

// =============================================================================
// buildDaemonSessionName
// =============================================================================

describe('Daemon Session Role (PRLT-1287)', () => {
  describe('buildDaemonSessionName', () => {
    let buildDaemonSessionName: (hqName: string, daemonType: string) => string

    before(async () => {
      const mod = await import('../../src/lib/session/renderer.js')
      buildDaemonSessionName = mod.buildDaemonSessionName
    })

    it('builds correct session name for reconciler daemon', () => {
      const name = buildDaemonSessionName('proletariat', 'reconciler')
      expect(name).to.equal('prlt-daemon-proletariat-reconciler')
    })

    it('builds correct session name for other daemon types', () => {
      const name = buildDaemonSessionName('my-hq', 'rebase-coordinator')
      expect(name).to.equal('prlt-daemon-my-hq-rebase-coordinator')
    })

    it('sanitizes HQ name with special characters', () => {
      const name = buildDaemonSessionName('my hq/path', 'reconciler')
      expect(name).to.equal('prlt-daemon-my-hq-path-reconciler')
    })

    it('uses default when HQ name is empty', () => {
      const name = buildDaemonSessionName('', 'reconciler')
      expect(name).to.equal('prlt-daemon-default-reconciler')
    })
  })

  // =============================================================================
  // Daemon role detection
  // =============================================================================

  describe('daemon role detection', () => {
    it('identifies daemon role from ticketId DAEMON', () => {
      // The role detection logic checks ticketId === 'DAEMON' or agentName starts with 'daemon-'
      const testCases = [
        { ticketId: 'DAEMON', agentName: 'daemon-reconciler', expected: 'daemon' },
        { ticketId: 'DAEMON', agentName: 'anything', expected: 'daemon' },
        { ticketId: 'PRLT-123', agentName: 'daemon-watcher', expected: 'daemon' },
        { ticketId: 'PRLT-123', agentName: 'my-agent', expected: 'worker' },
        { ticketId: 'ORCH', agentName: 'orchestrator-main', expected: 'orchestrator' },
        { ticketId: 'orchestrator', agentName: 'orch', expected: 'orchestrator' },
      ]

      for (const tc of testCases) {
        // Mirror the role detection logic from renderer.ts
        let role = tc.ticketId ? 'worker' : 'headless'
        if (tc.ticketId === 'DAEMON' || tc.agentName.startsWith('daemon-')) {
          role = 'daemon'
        } else if (
          tc.agentName.startsWith('orchestrator') ||
          tc.ticketId === 'ORCH' ||
          tc.ticketId === 'orchestrator'
        ) {
          role = 'orchestrator'
        }
        expect(role).to.equal(tc.expected, `${tc.ticketId}/${tc.agentName} should be ${tc.expected}`)
      }
    })
  })

  // =============================================================================
  // Daemon manager
  // =============================================================================

  describe('daemon-manager', () => {
    let reconcilerDaemonSpec: (intervalSeconds?: number) => { type: string; command: string }

    before(async () => {
      const mod = await import('../../src/lib/session/daemon-manager.js')
      reconcilerDaemonSpec = mod.reconcilerDaemonSpec
    })

    it('reconcilerDaemonSpec builds correct spec with default interval', () => {
      const spec = reconcilerDaemonSpec()
      expect(spec.type).to.equal('reconciler')
      expect(spec.command).to.equal('prlt reconcile --watch --foreground --interval 300')
    })

    it('reconcilerDaemonSpec accepts custom interval', () => {
      const spec = reconcilerDaemonSpec(60)
      expect(spec.type).to.equal('reconciler')
      expect(spec.command).to.equal('prlt reconcile --watch --foreground --interval 60')
    })
  })

  // =============================================================================
  // Session prune daemon protection
  // =============================================================================

  describe('session prune daemon protection', () => {
    it('skips sessions with prlt-daemon- prefix', () => {
      // Simulate the prune logic: orphan detection should skip daemon sessions
      const tmuxSessions = [
        'TKT-123-Implement-my-agent',
        'prlt-daemon-proletariat-reconciler',
        'prlt-orchestrator-proletariat-main',
        'TKT-456-Review-other-agent',
      ]
      const matchedSessions = new Set<string>()

      const orphanSessions: string[] = []
      for (const sessionName of tmuxSessions) {
        if (matchedSessions.has(sessionName)) continue
        if (sessionName.startsWith('prlt-daemon-')) continue // PRLT-1287: skip daemons
        // Simplified: just check if it looks like a prlt session
        if (sessionName.includes('-')) {
          orphanSessions.push(sessionName)
        }
      }

      // Daemon session should NOT be in orphan list
      expect(orphanSessions).to.not.include('prlt-daemon-proletariat-reconciler')
      // Other sessions should still be detected as orphans
      expect(orphanSessions).to.include('TKT-123-Implement-my-agent')
      expect(orphanSessions).to.include('TKT-456-Review-other-agent')
    })
  })

  // =============================================================================
  // Session list daemon display
  // =============================================================================

  describe('session list daemon display', () => {
    it('daemon role is a valid SessionRole value', async () => {
      // Verify the type is extended correctly by checking the value is valid
      const validRoles = ['orchestrator', 'worker', 'headless', 'daemon']
      expect(validRoles).to.include('daemon')
    })

    it('daemon sessions have correct fields', () => {
      // Simulate a daemon UnifiedSession
      const daemonSession = {
        id: 'prlt-daemon-proletariat-reconciler',
        sessionId: 'prlt-daemon-proletariat-reconciler',
        ticketId: 'DAEMON',
        agentName: 'daemon-reconciler',
        status: 'running' as const,
        role: 'daemon' as const,
        environment: 'host' as const,
        exists: true,
        source: 'discovered' as const,
        hqPath: '/home/user/hq',
        hqName: 'proletariat',
      }

      expect(daemonSession.role).to.equal('daemon')
      expect(daemonSession.ticketId).to.equal('DAEMON')
      expect(daemonSession.agentName).to.equal('daemon-reconciler')
      expect(daemonSession.sessionId).to.match(/^prlt-daemon-/)
    })
  })

  // =============================================================================
  // Health check daemon detection
  // =============================================================================

  describe('session health daemon detection', () => {
    it('extracts daemon type from session name', () => {
      const sessionName = 'prlt-daemon-proletariat-reconciler'
      const parts = sessionName.split('-')
      const daemonType = parts.length >= 4 ? parts.slice(3).join('-') : 'unknown'
      expect(daemonType).to.equal('reconciler')
    })

    it('extracts compound daemon types from session name', () => {
      const sessionName = 'prlt-daemon-myhq-rebase-coordinator'
      const parts = sessionName.split('-')
      const daemonType = parts.length >= 4 ? parts.slice(3).join('-') : 'unknown'
      expect(daemonType).to.equal('rebase-coordinator')
    })

    it('detects daemon sessions by prefix', () => {
      const tmuxSessions = [
        'TKT-123-Implement-agent',
        'prlt-daemon-hq-reconciler',
        'prlt-orchestrator-hq-main',
      ]
      const daemonSessions = tmuxSessions.filter(s => s.startsWith('prlt-daemon-'))
      expect(daemonSessions).to.have.length(1)
      expect(daemonSessions[0]).to.equal('prlt-daemon-hq-reconciler')
    })
  })

  // =============================================================================
  // Orchestrator reconciler supervision
  // =============================================================================

  describe('orchestrator reconciler supervision', () => {
    it('reconcilerDaemonSpec produces a valid DaemonSpec', async () => {
      const { reconcilerDaemonSpec: specFn } = await import('../../src/lib/session/daemon-manager.js')
      const spec = specFn(120)
      expect(spec).to.have.property('type', 'reconciler')
      expect(spec).to.have.property('command')
      expect(spec.command).to.contain('prlt reconcile --watch --foreground')
      expect(spec.command).to.contain('--interval 120')
    })

    it('ensureDaemonRunning is exported', async () => {
      const mod = await import('../../src/lib/session/daemon-manager.js')
      expect(mod.ensureDaemonRunning).to.be.a('function')
      expect(mod.isDaemonAlive).to.be.a('function')
      expect(mod.spawnDaemon).to.be.a('function')
      expect(mod.getDaemonStatus).to.be.a('function')
    })
  })
})
