/**
 * Regression test for PRLT-1163
 *
 * Verifies that the HQ .proletariat directory is mounted read-only into
 * agent containers to prevent SQLite corruption from concurrent writers.
 */
import { expect } from 'chai'
import {
  buildContainerMounts,
} from '../../src/lib/execution/runners/docker-management.js'
import {
  generateDevcontainerJson,
} from '../../src/lib/execution/devcontainer.js'
import type { ExecutionContext } from '../../src/lib/execution/types.js'

describe('PRLT-1163: HQ .proletariat mount must be read-only', () => {
  // =========================================================================
  // Docker management (raw docker run path)
  // =========================================================================
  describe('buildContainerMounts (docker-management)', () => {
    function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
      return {
        ticketId: 'TKT-001',
        ticketTitle: 'Test ticket',
        agentName: 'test-agent',
        agentDir: '/path/to/agent',
        worktreePath: '/path/to/worktree',
        branch: 'main',
        hqPath: '/path/to/hq',
        ...overrides,
      }
    }

    it('should mount .proletariat as read-only (:ro)', () => {
      const mounts = buildContainerMounts(makeContext())
      const hqMount = mounts.find(m => m.includes('.proletariat:/hq/.proletariat'))
      expect(hqMount).to.exist
      expect(hqMount).to.include(':ro')
      // Must NOT use :cached without :ro — that's the bug this ticket fixes
      expect(hqMount).to.not.include(':cached')
    })

    it('should not include .proletariat mount when hqPath is not set', () => {
      const mounts = buildContainerMounts(makeContext({ hqPath: undefined }))
      const hqMount = mounts.find(m => m.includes('.proletariat:/hq/.proletariat'))
      expect(hqMount).to.not.exist
    })

    it('should still mount workspace as read-write (cached)', () => {
      const mounts = buildContainerMounts(makeContext())
      const wsMount = mounts.find(m => m.includes('/workspace:'))
      expect(wsMount).to.exist
      expect(wsMount).to.include(':cached')
    })
  })

  // =========================================================================
  // Devcontainer JSON (devcontainer CLI path)
  // =========================================================================
  describe('generateDevcontainerJson', () => {
    it('should mount .proletariat as readonly in devcontainer config', () => {
      const result = generateDevcontainerJson({
        agentName: 'test-agent',
        agentDir: '/path/to/agents/staff/test-agent',
      })
      const hqMount = result.mounts.find((m: string) =>
        m.includes('.proletariat') && m.includes('/hq/.proletariat')
      )
      expect(hqMount).to.exist
      expect(hqMount).to.include('readonly')
    })
  })
})
