import { expect } from 'chai'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  groupSessionsByHQ,
  type UnifiedSession,
} from '../../src/lib/session/renderer.js'

/**
 * Tests for orchestrator attach --scope behavior (PRLT-1329).
 *
 * The attach command scopes sessions by HQ:
 *   - Default (--scope current): only current-HQ sessions, with a count of hidden others
 *   - --scope all: all sessions across HQs
 *   - When no current-HQ sessions but others exist: surfaces the hidden count
 *
 * These tests exercise the grouping logic that backs the scoping behavior
 * without touching tmux, Docker, or the actual oclif command runner.
 */
describe('Orchestrator Attach Scope (PRLT-1329)', () => {
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

  /**
   * Replicate the attach command's scoping logic as a pure function.
   * This mirrors the logic in OrchestratorAttach.run() for testability.
   */
  function applyScope(
    sessions: UnifiedSession[],
    scopeAll: boolean,
    currentHqOverride?: string | null,
  ): { orchestrators: UnifiedSession[]; hiddenElsewhereCount: number } {
    const grouped = groupSessionsByHQ(sessions, currentHqOverride)
    const currentHqPath = grouped.currentHq

    if (scopeAll || !currentHqPath) {
      return { orchestrators: sessions, hiddenElsewhereCount: 0 }
    }

    return {
      orchestrators: grouped.here,
      hiddenElsewhereCount: grouped.elsewhere.length,
    }
  }

  const currentHq = path.join(os.tmpdir(), 'inflow-hq')
  const otherHq = path.join(os.tmpdir(), 'proletariat-hq')

  // ===========================================================================
  // Default scope (current HQ only)
  // ===========================================================================
  describe('--scope current (default)', () => {
    it('shows only current-HQ sessions', () => {
      const sessions = [
        fakeOrchestrator({
          id: 'a',
          sessionId: 'prlt-orchestrator-inflow-main',
          agentName: 'main',
          hqPath: currentHq,
          hqName: 'inflow-hq',
        }),
        fakeOrchestrator({
          id: 'b',
          sessionId: 'prlt-orchestrator-proletariat-main',
          agentName: 'main',
          hqPath: otherHq,
          hqName: 'proletariat-hq',
        }),
      ]

      const result = applyScope(sessions, false, currentHq)
      expect(result.orchestrators).to.have.length(1)
      expect(result.orchestrators[0].hqPath).to.equal(currentHq)
      expect(result.hiddenElsewhereCount).to.equal(1)
    })

    it('reports correct hidden count with multiple other-HQ sessions', () => {
      const thirdHq = path.join(os.tmpdir(), 'third-hq')
      const sessions = [
        fakeOrchestrator({
          id: 'a',
          sessionId: 'orch-a',
          hqPath: currentHq,
          hqName: 'inflow-hq',
        }),
        fakeOrchestrator({
          id: 'b',
          sessionId: 'orch-b',
          hqPath: otherHq,
          hqName: 'proletariat-hq',
        }),
        fakeOrchestrator({
          id: 'c',
          sessionId: 'orch-c',
          hqPath: thirdHq,
          hqName: 'third-hq',
        }),
      ]

      const result = applyScope(sessions, false, currentHq)
      expect(result.orchestrators).to.have.length(1)
      expect(result.hiddenElsewhereCount).to.equal(2)
    })

    it('returns empty with hidden count when no current-HQ sessions but others exist', () => {
      const sessions = [
        fakeOrchestrator({
          id: 'b',
          sessionId: 'prlt-orchestrator-proletariat-main',
          agentName: 'main',
          hqPath: otherHq,
          hqName: 'proletariat-hq',
        }),
      ]

      const result = applyScope(sessions, false, currentHq)
      expect(result.orchestrators).to.have.length(0)
      expect(result.hiddenElsewhereCount).to.equal(1)
    })

    it('returns empty with zero hidden when no sessions at all', () => {
      const result = applyScope([], false, currentHq)
      expect(result.orchestrators).to.have.length(0)
      expect(result.hiddenElsewhereCount).to.equal(0)
    })

    it('shows all sessions when only current-HQ sessions exist', () => {
      const sessions = [
        fakeOrchestrator({
          id: 'a',
          sessionId: 'orch-a',
          hqPath: currentHq,
          hqName: 'inflow-hq',
          agentName: 'main',
        }),
        fakeOrchestrator({
          id: 'b',
          sessionId: 'orch-b',
          hqPath: currentHq,
          hqName: 'inflow-hq',
          agentName: 'secondary',
        }),
      ]

      const result = applyScope(sessions, false, currentHq)
      expect(result.orchestrators).to.have.length(2)
      expect(result.hiddenElsewhereCount).to.equal(0)
    })
  })

  // ===========================================================================
  // --scope all
  // ===========================================================================
  describe('--scope all', () => {
    it('shows sessions from all HQs', () => {
      const sessions = [
        fakeOrchestrator({
          id: 'a',
          sessionId: 'orch-a',
          hqPath: currentHq,
          hqName: 'inflow-hq',
        }),
        fakeOrchestrator({
          id: 'b',
          sessionId: 'orch-b',
          hqPath: otherHq,
          hqName: 'proletariat-hq',
        }),
      ]

      const result = applyScope(sessions, true, currentHq)
      expect(result.orchestrators).to.have.length(2)
      expect(result.hiddenElsewhereCount).to.equal(0)
    })

    it('shows all sessions even when not in any HQ', () => {
      const sessions = [
        fakeOrchestrator({
          id: 'a',
          sessionId: 'orch-a',
          hqPath: otherHq,
          hqName: 'proletariat-hq',
        }),
      ]

      const result = applyScope(sessions, true, null)
      expect(result.orchestrators).to.have.length(1)
      expect(result.hiddenElsewhereCount).to.equal(0)
    })
  })

  // ===========================================================================
  // Not in any HQ (fallback)
  // ===========================================================================
  describe('not in any HQ', () => {
    it('shows all sessions when currentHq is undefined', () => {
      const sessions = [
        fakeOrchestrator({
          id: 'a',
          sessionId: 'orch-a',
          hqPath: otherHq,
          hqName: 'proletariat-hq',
        }),
        fakeOrchestrator({
          id: 'b',
          sessionId: 'orch-b',
          hqPath: currentHq,
          hqName: 'inflow-hq',
        }),
      ]

      // When not in any HQ, scope filtering can't apply — show everything
      const result = applyScope(sessions, false, null)
      expect(result.orchestrators).to.have.length(2)
      expect(result.hiddenElsewhereCount).to.equal(0)
    })
  })
})
