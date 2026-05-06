import { expect } from 'chai'
import * as os from 'node:os'
import * as path from 'node:path'
import { formatAvailableSessions } from '../../src/lib/orchestrator/format.js'
import type { UnifiedSession } from '../../src/lib/session/renderer.js'

/**
 * Tests for the formatAvailableSessions helper used by `prlt orchestrator
 * attach` and `prlt orchestrator stop` to produce a useful "name not found"
 * error message when --name does not match any running session (PRLT-1271).
 */
describe('formatAvailableSessions (PRLT-1271)', () => {
  const fakeOrchestrator = (overrides: Partial<UnifiedSession>): UnifiedSession => ({
    id: overrides.id ?? 'orch-1',
    sessionId: overrides.sessionId ?? 'prlt-orchestrator-hq-main',
    ticketId: 'orchestrator',
    agentName: overrides.agentName ?? 'main',
    status: 'running',
    role: 'orchestrator',
    environment: overrides.environment ?? 'host',
    exists: true,
    source: overrides.source ?? 'discovered',
    hqPath: overrides.hqPath,
    hqName: overrides.hqName,
    repoPath: overrides.repoPath,
    startedAt: overrides.startedAt,
    containerId: overrides.containerId,
  })

  it('returns "(none)" for an empty session list', () => {
    expect(formatAvailableSessions([])).to.equal('(none)')
  })

  it('formats a session with an HQ path using ~ expansion', () => {
    const home = os.homedir()
    const hq = path.join(home, 'Projects', 'backend')
    const out = formatAvailableSessions([
      fakeOrchestrator({ agentName: 'main', hqPath: hq }),
    ])
    expect(out).to.equal('main (~/Projects/backend)')
  })

  it('marks sessions with no HQ as host', () => {
    const out = formatAvailableSessions([
      fakeOrchestrator({ agentName: 'reviewer', hqPath: undefined }),
    ])
    expect(out).to.equal('reviewer (host)')
  })

  it('annotates Docker sessions', () => {
    const out = formatAvailableSessions([
      fakeOrchestrator({
        agentName: 'backend',
        hqPath: undefined,
        environment: 'container',
      }),
    ])
    expect(out).to.equal('backend (host, Docker)')
  })

  it('joins multiple sessions with ", "', () => {
    const home = os.homedir()
    const out = formatAvailableSessions([
      fakeOrchestrator({
        agentName: 'main',
        hqPath: path.join(home, 'Projects', 'backend'),
      }),
      fakeOrchestrator({
        agentName: 'backend',
        hqPath: path.join(home, 'Projects', 'proletariat-hq'),
      }),
      fakeOrchestrator({
        agentName: 'reviewer',
        hqPath: undefined,
      }),
    ])
    expect(out).to.equal(
      'main (~/Projects/backend), backend (~/Projects/proletariat-hq), reviewer (host)',
    )
  })
})
