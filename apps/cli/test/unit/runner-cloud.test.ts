import { expect } from 'chai'
import { DEFAULT_EXECUTION_CONFIG } from '../../src/lib/execution/types.js'
import type { ExecutionContext, ExecutionConfig } from '../../src/lib/execution/types.js'

/**
 * Smoke tests for cloud runner — config validation and command generation logic.
 * The actual runCloud function requires SSH which can't be tested in unit tests,
 * so we test the setup/config validation paths.
 * TKT-140: Close coverage gaps in execution runner modules.
 */

const makeContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
  ticketId: 'TKT-888',
  ticketTitle: 'Cloud test',
  agentName: 'cloud-agent',
  agentDir: '/tmp/agent',
  worktreePath: '/tmp/worktree',
  branch: 'TKT-888/test',
  ...overrides,
})

describe('Cloud Runner Config (TKT-140)', () => {
  describe('DEFAULT_EXECUTION_CONFIG cloud settings', () => {
    it('should have cloud config with user and syncMethod', () => {
      expect(DEFAULT_EXECUTION_CONFIG.cloud).to.have.property('user', 'agent')
      expect(DEFAULT_EXECUTION_CONFIG.cloud).to.have.property('syncMethod', 'git')
    })

    it('should have vm config for backwards compatibility', () => {
      expect(DEFAULT_EXECUTION_CONFIG.vm).to.have.property('user', 'agent')
      expect(DEFAULT_EXECUTION_CONFIG.vm).to.have.property('syncMethod', 'git')
    })

    it('should not have defaultHost set', () => {
      expect(DEFAULT_EXECUTION_CONFIG.cloud.defaultHost).to.be.undefined
    })
  })

  describe('runCloud error handling', () => {
    it('should return error when no host is specified', async () => {
      // Import dynamically to test the actual function
      const { runCloud } = await import('../../src/lib/execution/runners/cloud.js')
      const config: ExecutionConfig = {
        ...DEFAULT_EXECUTION_CONFIG,
        cloud: { user: 'agent', syncMethod: 'git' },
      }
      const result = await runCloud(makeContext(), 'claude-code', config)
      expect(result.success).to.be.false
      expect(result.error).to.include('No cloud host specified')
    })
  })
})
