import { expect } from 'chai'
import { SessionService } from '../../src/services/session-service.js'
import {
  findSessionByIdentifier,
  type UnifiedSession,
} from '../../src/lib/session/renderer.js'
import type { ResolveSessionResult } from '../../src/services/types.js'

/**
 * PRLT-1263 — Unify session lookup in poke command with session list.
 *
 * Verifies that SessionService.resolveSession() delegates to the same
 * collectAllSessions + findSessionByIdentifier path that listSessions()
 * uses, so `session poke` and `session list` always see an identical
 * set of sessions.
 */

describe('SessionService.resolveSession (PRLT-1263)', () => {
  let service: SessionService

  beforeEach(() => {
    service = new SessionService()
  })

  it('returns none for a non-existent session identifier', () => {
    const result = service.resolveSession('nonexistent-agent-xyz-12345')
    expect(result.kind).to.equal('none')
  })

  it('returns a ResolveSessionResult type with valid kind', () => {
    const result = service.resolveSession('nonexistent-agent-xyz-12345')
    expect(result).to.have.property('kind')
    expect(['match', 'multiple', 'none']).to.include(result.kind)
  })

  it('accepts CollectOptions to pass through to collectAllSessions', () => {
    const result = service.resolveSession('nonexistent-agent-xyz-12345', {
      roleFilter: 'worker',
    })
    expect(result.kind).to.equal('none')
  })

  it('accepts hqPathFilter option', () => {
    const result = service.resolveSession('nonexistent-agent-xyz-12345', {
      hqPathFilter: '/tmp/nonexistent-hq',
    })
    expect(result.kind).to.equal('none')
  })

  it('uses the same session pool as listSessions', () => {
    const listResult = service.listSessions({ includeAll: true })
    const sessions = listResult.sessions

    for (const s of sessions) {
      const resolveResult = service.resolveSession(s.agentName, { includeAll: true })
      expect(resolveResult.kind).to.not.equal('none',
        `resolveSession should find session "${s.agentName}" that listSessions returned`)
    }
  })
})

describe('findSessionByIdentifier — unified resolution contract (PRLT-1263)', () => {
  const makeSession = (overrides: Partial<UnifiedSession> = {}): UnifiedSession => ({
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

  it('returns the same result type as ResolveSessionResult', () => {
    const sessions = [makeSession()]
    const result: ResolveSessionResult = findSessionByIdentifier(sessions, 'fair-knight')
    expect(result.kind).to.equal('match')
  })

  it('resolution is deterministic — same input always yields same output', () => {
    const sessions = [
      makeSession(),
      makeSession({
        id: 'WORK-2',
        sessionId: 'prlt-orchestrator-main',
        ticketId: 'ORCH',
        agentName: 'orchestrator-main',
        role: 'orchestrator',
      }),
    ]

    const r1 = findSessionByIdentifier(sessions, 'fair-knight')
    const r2 = findSessionByIdentifier(sessions, 'fair-knight')
    expect(r1.kind).to.equal(r2.kind)
    if (r1.kind === 'match' && r2.kind === 'match') {
      expect(r1.session.id).to.equal(r2.session.id)
    }
  })

  it('poke resolution matches what list would show — sessions from all sources are fair game', () => {
    const sessions = [
      makeSession({ source: 'db', hqPath: '/home/user/hq1' }),
      makeSession({
        id: 'MACHINE-1',
        sessionId: 'headless-run-1',
        ticketId: 'headless',
        agentName: 'headless-runner',
        source: 'db',
        role: 'headless',
        hqPath: undefined,
      }),
      makeSession({
        id: 'prlt-orchestrator-proletariat-main',
        sessionId: 'prlt-orchestrator-proletariat-main',
        ticketId: 'ORCH',
        agentName: 'orchestrator-main',
        source: 'discovered',
        role: 'orchestrator',
      }),
    ]

    expect(findSessionByIdentifier(sessions, 'fair-knight').kind).to.equal('match')
    expect(findSessionByIdentifier(sessions, 'headless-runner').kind).to.equal('match')
    expect(findSessionByIdentifier(sessions, 'orchestrator-main').kind).to.equal('match')
  })
})
