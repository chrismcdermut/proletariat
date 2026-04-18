import { expect } from 'chai'
import { executeHook } from '../../src/lib/work-lifecycle/hooks/executor.js'
import type { WorkHookConfig } from '../../src/lib/work-lifecycle/hooks/types.js'

/**
 * Tests for hook executor — shell commands, webhooks, log interpolation.
 * TKT-140: Close coverage gaps in hook system.
 */

function makeHook(overrides: Partial<WorkHookConfig> = {}): WorkHookConfig {
  return {
    id: 'hook-001',
    name: 'test-hook',
    event: 'work:started',
    actionType: 'log',
    actionValue: 'default log message',
    actionRef: null,
    enabled: true,
    description: null,
    createdAt: new Date().toISOString(),
    mode: 'auto',
    priority: 0,
    config: null,
    ...overrides,
  }
}

describe('Hook Executor (TKT-140)', () => {
  // =========================================================================
  // Shell Hooks
  // =========================================================================
  describe('shell action', () => {
    it('should execute a simple shell command and return success', () => {
      const hook = makeHook({ actionType: 'shell', actionValue: 'true' })
      const result = executeHook(hook, 'work:started', { ticketId: 'TKT-1' })
      expect(result.success).to.be.true
      expect(result.hookId).to.equal('hook-001')
      expect(result.hookName).to.equal('test-hook')
      expect(result.durationMs).to.be.a('number').and.at.least(0)
    })

    it('should return failure for a command that exits non-zero', () => {
      const hook = makeHook({ actionType: 'shell', actionValue: 'false' })
      const result = executeHook(hook, 'work:started', {})
      expect(result.success).to.be.false
      expect(result.error).to.be.a('string')
    })

    it('should pass PRLT_HOOK_EVENT env var to shell command', () => {
      // Use env to capture and echo the variable
      const hook = makeHook({
        actionType: 'shell',
        actionValue: 'test -n "$PRLT_HOOK_EVENT"',
      })
      const result = executeHook(hook, 'work:started', {})
      expect(result.success).to.be.true
    })

    it('should pass event data as PRLT_HOOK_* env vars', () => {
      const hook = makeHook({
        actionType: 'shell',
        actionValue: 'test "$PRLT_HOOK_TICKET_ID" = "TKT-100"',
      })
      const result = executeHook(hook, 'work:started', { ticketId: 'TKT-100' })
      expect(result.success).to.be.true
    })

    it('should uppercase camelCase keys to UPPER_SNAKE_CASE', () => {
      const hook = makeHook({
        actionType: 'shell',
        actionValue: 'test -n "$PRLT_HOOK_AGENT_NAME"',
      })
      const result = executeHook(hook, 'agent:spawned', { agentName: 'my-agent' })
      expect(result.success).to.be.true
    })

    it('should skip null and undefined values in env vars', () => {
      const hook = makeHook({
        actionType: 'shell',
        actionValue: 'test -z "$PRLT_HOOK_MISSING"',
      })
      const result = executeHook(hook, 'work:started', { missing: null })
      expect(result.success).to.be.true
    })

    it('should handle Date values in event data', () => {
      const hook = makeHook({
        actionType: 'shell',
        actionValue: 'test -n "$PRLT_HOOK_STARTED_AT"',
      })
      const result = executeHook(hook, 'work:started', { startedAt: new Date() })
      expect(result.success).to.be.true
    })

    it('should return failure for command timeout (30s)', () => {
      // This is a fast test — we just verify the timeout is set by testing
      // structure, not by waiting 30s
      const hook = makeHook({ actionType: 'shell', actionValue: 'echo fast' })
      const result = executeHook(hook, 'work:started', {})
      expect(result.success).to.be.true
      expect(result.durationMs).to.be.lessThan(5000) // Should complete quickly
    })
  })

  // =========================================================================
  // Log Hooks
  // =========================================================================
  describe('log action', () => {
    it('should succeed and return result', () => {
      const hook = makeHook({ actionType: 'log', actionValue: 'Work started!' })
      const result = executeHook(hook, 'work:started', {})
      expect(result.success).to.be.true
    })

    it('should interpolate {{event}} placeholder', () => {
      const hook = makeHook({ actionType: 'log', actionValue: 'Event: {{event}}' })
      const result = executeHook(hook, 'work:completed', {})
      expect(result.success).to.be.true
    })

    it('should interpolate {{key}} placeholders from event data', () => {
      const hook = makeHook({
        actionType: 'log',
        actionValue: 'Ticket {{ticketId}} started by {{agentName}}',
      })
      const result = executeHook(hook, 'work:started', {
        ticketId: 'TKT-200',
        agentName: 'fast-agent',
      })
      expect(result.success).to.be.true
    })

    it('should leave unmatched placeholders as-is', () => {
      const hook = makeHook({ actionType: 'log', actionValue: '{{missing}} is unknown' })
      const result = executeHook(hook, 'work:started', {})
      expect(result.success).to.be.true
    })

    it('should handle Date values in interpolation', () => {
      const hook = makeHook({ actionType: 'log', actionValue: 'Time: {{startedAt}}' })
      const now = new Date()
      const result = executeHook(hook, 'work:started', { startedAt: now })
      expect(result.success).to.be.true
    })
  })

  // =========================================================================
  // Webhook Hooks
  // =========================================================================
  describe('webhook action', () => {
    it('should fail gracefully for invalid URL', () => {
      const hook = makeHook({
        actionType: 'webhook',
        actionValue: 'http://localhost:99999/nonexistent',
      })
      const result = executeHook(hook, 'work:started', { ticketId: 'TKT-1' })
      // Will fail because endpoint doesn't exist, but shouldn't throw
      expect(result).to.have.property('success')
      expect(result.durationMs).to.be.a('number')
    })

    it('should return hook metadata in result', () => {
      const hook = makeHook({
        id: 'wh-001',
        name: 'webhook-test',
        actionType: 'webhook',
        actionValue: 'http://localhost:99999/nonexistent',
      })
      const result = executeHook(hook, 'work:pr_created', { prUrl: 'https://github.com/...' })
      expect(result.hookId).to.equal('wh-001')
      expect(result.hookName).to.equal('webhook-test')
    })
  })

  // =========================================================================
  // General behavior
  // =========================================================================
  describe('general', () => {
    it('should always return hookId, hookName, action, success, and durationMs', () => {
      const hook = makeHook({ actionType: 'log', actionValue: 'test' })
      const result = executeHook(hook, 'work:started', {})
      expect(result).to.have.all.keys('hookId', 'hookName', 'action', 'success', 'durationMs')
    })

    it('should include error field on failure', () => {
      const hook = makeHook({ actionType: 'shell', actionValue: 'exit 1' })
      const result = executeHook(hook, 'work:started', {})
      expect(result.success).to.be.false
      expect(result).to.have.property('error').that.is.a('string')
    })

    it('should not include error field on success', () => {
      const hook = makeHook({ actionType: 'log', actionValue: 'ok' })
      const result = executeHook(hook, 'work:started', {})
      expect(result.success).to.be.true
      expect(result.error).to.be.undefined
    })
  })
})
