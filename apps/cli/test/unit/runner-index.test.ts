import { expect } from 'chai'
import type { ExecutionContext, ExecutionConfig } from '../../src/lib/execution/types.js'
import { DEFAULT_EXECUTION_CONFIG } from '../../src/lib/execution/types.js'
import { runExecution } from '../../src/lib/execution/runners/index.js'

/**
 * Smoke tests for the runner dispatcher (runExecution).
 * TKT-140: Close coverage gaps in execution runner modules.
 */

const makeContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
  ticketId: 'TKT-001',
  ticketTitle: 'Dispatch test',
  agentName: 'dispatch-agent',
  agentDir: '/tmp/agent',
  worktreePath: '/tmp/worktree',
  branch: 'TKT-001/test',
  ...overrides,
})

describe('Runner Dispatcher (TKT-140)', () => {
  describe('runExecution', () => {
    it('should return error for unknown environment', async () => {
      const result = await runExecution(
        'unknown-env' as any,
        makeContext(),
        'claude-code',
        DEFAULT_EXECUTION_CONFIG,
      )
      expect(result.success).to.be.false
      expect(result.error).to.include('Unknown execution environment')
    })

    it('should set executionEnvironment on context', async () => {
      const ctx = makeContext()
      expect(ctx.executionEnvironment).to.be.undefined
      // Cloud runner will fail since no host, but context should be set
      await runExecution('cloud', ctx, 'claude-code', DEFAULT_EXECUTION_CONFIG)
      expect(ctx.executionEnvironment).to.equal('cloud')
    })

    it('should normalize vm to cloud', async () => {
      const ctx = makeContext()
      const result = await runExecution('vm', ctx, 'claude-code', DEFAULT_EXECUTION_CONFIG)
      // Should fail with cloud error, not unknown env error
      expect(result.success).to.be.false
      expect(result.error).to.include('No cloud host specified')
    })
  })
})
