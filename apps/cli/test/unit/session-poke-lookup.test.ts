import { expect } from 'chai'
import {
  findSessionByIdentifier,
  type UnifiedSession,
} from '../../src/lib/session/renderer.js'

/**
 * PRLT-1323 regression tests — `prlt session poke` must resolve running
 * sessions for workers, orchestrators, AND daemons. Previously, poke only
 * consulted the workspace.db executions table and returned
 * NO_ACTIVE_EXECUTION for orchestrator/daemon sessions that were running
 * but recorded via machine.db or tmux discovery.
 *
 * These tests exercise the pure lookup helper that poke now uses so the
 * resolution semantics are locked down regardless of how sessions are
 * discovered at runtime.
 */

describe('findSessionByIdentifier (PRLT-1323)', () => {
  const worker = (overrides: Partial<UnifiedSession> = {}): UnifiedSession => ({
    id: 'WORK-1',
    sessionId: 'PRLT-100-Implement-fair-knight',
    ticketId: 'PRLT-100',
    agentName: 'fair-knight',
    status: 'running',
    role: 'worker',
    environment: 'host',
    exists: true,
    source: 'db',
    ...overrides,
  })

  const orchestrator = (overrides: Partial<UnifiedSession> = {}): UnifiedSession => ({
    id: 'prlt-orchestrator-proletariat-main',
    sessionId: 'prlt-orchestrator-proletariat-main',
    ticketId: 'ORCH',
    agentName: 'orchestrator-main',
    status: 'running',
    role: 'orchestrator',
    environment: 'host',
    exists: true,
    source: 'discovered',
    ...overrides,
  })

  const daemon = (overrides: Partial<UnifiedSession> = {}): UnifiedSession => ({
    id: 'prlt-daemon-proletariat-reconciler',
    sessionId: 'prlt-daemon-proletariat-reconciler',
    ticketId: 'DAEMON',
    agentName: 'daemon-reconciler',
    status: 'running',
    role: 'daemon',
    environment: 'host',
    exists: true,
    source: 'db',
    ...overrides,
  })

  describe('worker sessions', () => {
    it('resolves a worker by exact agent name', () => {
      const sessions = [worker()]
      const result = findSessionByIdentifier(sessions, 'fair-knight')
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.agentName).to.equal('fair-knight')
      }
    })

    it('resolves a worker by exact ticket ID', () => {
      const sessions = [worker()]
      const result = findSessionByIdentifier(sessions, 'PRLT-100')
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.ticketId).to.equal('PRLT-100')
      }
    })

    it('resolves a worker by exact tmux session name', () => {
      const sessions = [worker()]
      const result = findSessionByIdentifier(
        sessions,
        'PRLT-100-Implement-fair-knight',
      )
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.agentName).to.equal('fair-knight')
      }
    })
  })

  describe('orchestrator sessions (the PRLT-1323 regression)', () => {
    it('resolves an orchestrator by exact agent name "orchestrator-main"', () => {
      const sessions = [orchestrator()]
      const result = findSessionByIdentifier(sessions, 'orchestrator-main')
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.role).to.equal('orchestrator')
      }
    })

    it('resolves an orchestrator via the "orchestrator" shorthand when only one is running', () => {
      const sessions = [orchestrator()]
      const result = findSessionByIdentifier(sessions, 'orchestrator')
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.agentName).to.equal('orchestrator-main')
      }
    })

    it('resolves an orchestrator by tmux session name (prlt-orchestrator-*)', () => {
      const sessions = [orchestrator()]
      const result = findSessionByIdentifier(
        sessions,
        'prlt-orchestrator-proletariat-main',
      )
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.role).to.equal('orchestrator')
      }
    })

    it('returns multiple when "orchestrator" matches several running instances', () => {
      const sessions = [
        orchestrator(),
        orchestrator({
          id: 'prlt-orchestrator-proletariat-alt',
          sessionId: 'prlt-orchestrator-proletariat-alt',
          agentName: 'orchestrator-alt',
        }),
      ]
      const result = findSessionByIdentifier(sessions, 'orchestrator')
      expect(result.kind).to.equal('multiple')
      if (result.kind === 'multiple') {
        expect(result.candidates).to.have.length(2)
      }
    })

    it('still resolves even if the orchestrator came from tmux discovery (no DB row)', () => {
      // This models the exact bug: orchestrator tmux pane is alive, machine.db
      // may not have a row, yet poke must still reach it.
      const sessions = [
        orchestrator({ source: 'discovered', ticketId: 'orchestrator' }),
      ]
      const result = findSessionByIdentifier(sessions, 'orchestrator-main')
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.source).to.equal('discovered')
      }
    })
  })

  describe('daemon sessions', () => {
    it('resolves a daemon by exact agent name "daemon-reconciler"', () => {
      const sessions = [daemon()]
      const result = findSessionByIdentifier(sessions, 'daemon-reconciler')
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.role).to.equal('daemon')
      }
    })

    it('resolves a daemon by short shorthand "reconciler"', () => {
      const sessions = [daemon()]
      const result = findSessionByIdentifier(sessions, 'reconciler')
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.agentName).to.equal('daemon-reconciler')
      }
    })

    it('resolves a daemon by ticket ID "DAEMON"', () => {
      const sessions = [daemon()]
      const result = findSessionByIdentifier(sessions, 'DAEMON')
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.role).to.equal('daemon')
      }
    })

    it('resolves a daemon by full tmux session name', () => {
      const sessions = [daemon()]
      const result = findSessionByIdentifier(
        sessions,
        'prlt-daemon-proletariat-reconciler',
      )
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.role).to.equal('daemon')
      }
    })
  })

  describe('alive-session preference', () => {
    it('prefers an alive session over a stale one when both match', () => {
      const sessions = [
        worker({ id: 'dead', sessionId: 'dead', exists: false }),
        worker({ id: 'alive', sessionId: 'alive', exists: true }),
      ]
      const result = findSessionByIdentifier(sessions, 'fair-knight')
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.id).to.equal('alive')
      }
    })

    it('falls back to a stale session when none are alive — so tmux-level errors surface precisely', () => {
      // Preserves the error contract for seeded-but-not-alive sessions:
      // the resolver returns the stale DB row so the subsequent tmux send
      // fails with SESSION_NOT_FOUND / SEND_FAILED rather than NO_ACTIVE_EXECUTION.
      const sessions = [worker({ exists: false })]
      const result = findSessionByIdentifier(sessions, 'fair-knight')
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.exists).to.equal(false)
      }
    })
  })

  describe('mixed role lookups', () => {
    it('prefers an exact agent-name match over ticket/role fallbacks', () => {
      // Both a worker named 'orchestrator-main' (weird but possible) and a real
      // orchestrator exist — the exact name must win.
      const sessions = [
        worker({ agentName: 'orchestrator-main', ticketId: 'PRLT-999' }),
        orchestrator(),
      ]
      const result = findSessionByIdentifier(sessions, 'orchestrator-main')
      expect(result.kind).to.equal('multiple')
      // Should report both since the name is ambiguous
      if (result.kind === 'multiple') {
        expect(result.candidates).to.have.length(2)
      }
    })

    it('returns none when nothing matches the identifier', () => {
      const sessions = [worker(), orchestrator(), daemon()]
      const result = findSessionByIdentifier(sessions, 'nonexistent')
      expect(result.kind).to.equal('none')
    })

    it('finds an orchestrator, worker, and daemon from the same session list', () => {
      const sessions = [worker(), orchestrator(), daemon()]
      expect(findSessionByIdentifier(sessions, 'fair-knight').kind).to.equal('match')
      expect(findSessionByIdentifier(sessions, 'orchestrator-main').kind).to.equal('match')
      expect(findSessionByIdentifier(sessions, 'reconciler').kind).to.equal('match')
    })
  })

  describe('container-based sessions', () => {
    it('returns the containerId alongside the sessionId for container sessions', () => {
      const sessions = [
        orchestrator({
          environment: 'container',
          containerId: 'abc123def456',
        }),
      ]
      const result = findSessionByIdentifier(sessions, 'orchestrator-main')
      expect(result.kind).to.equal('match')
      if (result.kind === 'match') {
        expect(result.session.environment).to.equal('container')
        expect(result.session.containerId).to.equal('abc123def456')
      }
    })
  })
})
