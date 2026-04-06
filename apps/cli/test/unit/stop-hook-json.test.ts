import { expect } from 'chai'
import { executeHook } from '../../src/lib/work-lifecycle/hooks/executor.js'
import {
  buildEnvVars,
  safeJsonStringify,
  safeJsonReplacer,
} from '../../src/lib/work-lifecycle/hooks/executor.js'
import type { WorkHookConfig } from '../../src/lib/work-lifecycle/hooks/types.js'

/**
 * Regression tests for PRLT-1260: Stop hook — ensure valid JSON on abnormal termination.
 *
 * The stop hook was receiving invalid JSON when an agent terminated abnormally
 * because:
 * 1. buildEnvVars did not expose a PRLT_HOOK_JSON env var
 * 2. Non-primitive values (Date, objects) produced [object Object] in env vars
 * 3. Webhook body was passed through shell interpolation, risking corruption
 *
 * These tests verify all three fixes hold.
 */

function makeHook(overrides: Partial<WorkHookConfig> = {}): WorkHookConfig {
  return {
    id: 'hook-001',
    name: 'test-hook',
    event: 'agent:stopped',
    actionType: 'log',
    actionValue: 'default log message',
    enabled: true,
    description: null,
    createdAt: new Date().toISOString(),
    mode: 'auto',
    priority: 0,
    config: null,
    ...overrides,
  }
}

describe('Stop hook JSON validity (PRLT-1260)', () => {
  // ===========================================================================
  // safeJsonReplacer
  // ===========================================================================
  describe('safeJsonReplacer', () => {
    it('should convert Date objects to ISO-8601 strings', () => {
      const d = new Date('2026-01-15T10:30:00Z')
      const result = safeJsonReplacer('ts', d)
      expect(result).to.equal('2026-01-15T10:30:00.000Z')
    })

    it('should pass through primitives unchanged', () => {
      expect(safeJsonReplacer('k', 'hello')).to.equal('hello')
      expect(safeJsonReplacer('k', 42)).to.equal(42)
      expect(safeJsonReplacer('k', true)).to.equal(true)
      expect(safeJsonReplacer('k', null)).to.equal(null)
    })

    it('should pass through plain objects unchanged (JSON.stringify recurses)', () => {
      const obj = { nested: true }
      expect(safeJsonReplacer('k', obj)).to.equal(obj)
    })
  })

  // ===========================================================================
  // safeJsonStringify
  // ===========================================================================
  describe('safeJsonStringify', () => {
    it('should produce valid JSON for agent:stopped event data', () => {
      const data = {
        sessionId: 'TKT-100-implement-bold-turing',
        runner: 'claude-code',
        reason: 'error',
        timestamp: new Date('2026-04-06T12:00:00Z'),
      }
      const json = safeJsonStringify('agent:stopped', data)
      const parsed = JSON.parse(json)
      expect(parsed.event).to.equal('agent:stopped')
      expect(parsed.sessionId).to.equal('TKT-100-implement-bold-turing')
      expect(parsed.reason).to.equal('error')
      expect(parsed.timestamp).to.equal('2026-04-06T12:00:00.000Z')
    })

    it('should produce valid JSON even with nested objects', () => {
      const data = {
        sessionId: 'x',
        meta: { nested: true, count: 3 },
      }
      const json = safeJsonStringify('agent:stopped', data)
      const parsed = JSON.parse(json)
      expect(parsed.meta).to.deep.equal({ nested: true, count: 3 })
    })

    it('should return fallback JSON on serialization failure', () => {
      // Create circular reference to force JSON.stringify to throw
      const data: Record<string, unknown> = { sessionId: 'x' }
      data.self = data
      const json = safeJsonStringify('agent:stopped', data)
      const parsed = JSON.parse(json)
      expect(parsed.event).to.equal('agent:stopped')
      expect(parsed.error).to.equal('payload_serialization_failed')
    })

    it('should handle empty event data', () => {
      const json = safeJsonStringify('agent:stopped', {})
      const parsed = JSON.parse(json)
      expect(parsed.event).to.equal('agent:stopped')
    })
  })

  // ===========================================================================
  // buildEnvVars — PRLT_HOOK_JSON
  // ===========================================================================
  describe('buildEnvVars — PRLT_HOOK_JSON', () => {
    it('should include PRLT_HOOK_JSON with valid JSON', () => {
      const env = buildEnvVars('agent:stopped', {
        sessionId: 'sess-1',
        runner: 'docker',
        reason: 'error',
        timestamp: new Date('2026-04-06T12:00:00Z'),
      })
      expect(env).to.have.property('PRLT_HOOK_JSON')
      const parsed = JSON.parse(env.PRLT_HOOK_JSON)
      expect(parsed.event).to.equal('agent:stopped')
      expect(parsed.sessionId).to.equal('sess-1')
      expect(parsed.timestamp).to.equal('2026-04-06T12:00:00.000Z')
    })

    it('should produce PRLT_HOOK_JSON that is always parseable', () => {
      const env = buildEnvVars('agent:stopped', {
        reason: 'error',
        timestamp: new Date(),
      })
      expect(() => JSON.parse(env.PRLT_HOOK_JSON)).not.to.throw()
    })

    it('should still include individual PRLT_HOOK_* vars', () => {
      const env = buildEnvVars('agent:stopped', {
        sessionId: 'sess-1',
        runner: 'docker',
      })
      expect(env.PRLT_HOOK_EVENT).to.equal('agent:stopped')
      expect(env.PRLT_HOOK_SESSION_ID).to.equal('sess-1')
      expect(env.PRLT_HOOK_RUNNER).to.equal('docker')
    })
  })

  // ===========================================================================
  // buildEnvVars — object serialization
  // ===========================================================================
  describe('buildEnvVars — object serialization', () => {
    it('should serialize plain objects as JSON strings, not [object Object]', () => {
      const env = buildEnvVars('agent:stopped', {
        config: { retries: 3, timeout: 5000 },
      })
      expect(env.PRLT_HOOK_CONFIG).to.not.equal('[object Object]')
      const parsed = JSON.parse(env.PRLT_HOOK_CONFIG)
      expect(parsed).to.deep.equal({ retries: 3, timeout: 5000 })
    })

    it('should serialize arrays as JSON strings', () => {
      const env = buildEnvVars('agent:stopped', {
        tags: ['deploy', 'urgent'],
      })
      const parsed = JSON.parse(env.PRLT_HOOK_TAGS)
      expect(parsed).to.deep.equal(['deploy', 'urgent'])
    })

    it('should serialize Date objects as ISO strings (not JSON)', () => {
      const d = new Date('2026-04-06T12:00:00Z')
      const env = buildEnvVars('agent:stopped', { timestamp: d })
      expect(env.PRLT_HOOK_TIMESTAMP).to.equal('2026-04-06T12:00:00.000Z')
    })
  })

  // ===========================================================================
  // Shell hook receives valid JSON env var
  // ===========================================================================
  describe('shell hook receives PRLT_HOOK_JSON', () => {
    it('should pass PRLT_HOOK_JSON that is parseable by jq-like consumers', () => {
      const hook = makeHook({
        actionType: 'shell',
        // Use node to parse JSON and check it has the expected event field
        actionValue:
          'node -e "const d = JSON.parse(process.env.PRLT_HOOK_JSON); if (d.event !== \'agent:stopped\') process.exit(1)"',
      })
      const result = executeHook(hook, 'agent:stopped', {
        sessionId: 'TKT-100-implement-bold-turing',
        runner: 'docker',
        reason: 'error',
        timestamp: new Date(),
      })
      expect(result.success).to.be.true
    })

    it('should produce valid JSON even with special characters in values', () => {
      const hook = makeHook({
        actionType: 'shell',
        actionValue:
          'node -e "JSON.parse(process.env.PRLT_HOOK_JSON)"',
      })
      const result = executeHook(hook, 'agent:stopped', {
        sessionId: "it's a test",
        runner: 'has "quotes" and \\ backslash',
        reason: 'error',
        timestamp: new Date(),
      })
      expect(result.success).to.be.true
    })
  })

  // ===========================================================================
  // Abnormal termination scenario
  // ===========================================================================
  describe('abnormal termination event data', () => {
    it('should produce valid JSON for signal-handler-style event data', () => {
      // This mirrors exactly what signal-handler.ts emits on SIGINT/SIGTERM
      const eventData = {
        sessionId: 'TKT-100-implement-bold-turing',
        runner: 'docker',
        reason: 'error' as const,
        timestamp: new Date(),
      }
      const json = safeJsonStringify('agent:stopped', eventData)
      const parsed = JSON.parse(json)
      expect(parsed.event).to.equal('agent:stopped')
      expect(parsed.reason).to.equal('error')
      expect(parsed.timestamp).to.be.a('string')
      // Verify it's a valid ISO date
      expect(new Date(parsed.timestamp).toISOString()).to.equal(parsed.timestamp)
    })

    it('should produce valid env vars for signal-handler-style event data', () => {
      const eventData = {
        sessionId: 'TKT-100-implement-bold-turing',
        runner: 'docker',
        reason: 'error' as const,
        timestamp: new Date(),
      }
      const env = buildEnvVars('agent:stopped', eventData)

      // All env vars should be strings
      for (const [key, val] of Object.entries(env)) {
        expect(val, `${key} should be a string`).to.be.a('string')
      }

      // PRLT_HOOK_JSON must be valid JSON
      expect(() => JSON.parse(env.PRLT_HOOK_JSON)).not.to.throw()
    })

    it('should handle stale-cleanup event data (storage.ts style)', () => {
      // This mirrors what execution/storage.ts emits for stale executions
      const eventData = {
        sessionId: 'exec-123',
        runner: 'stale-cleanup',
        reason: 'error' as const,
        timestamp: new Date(),
      }
      const json = safeJsonStringify('agent:stopped', eventData)
      expect(() => JSON.parse(json)).not.to.throw()
    })

    it('should handle gc-sweep event data (orchestrate/actions.ts style)', () => {
      // This mirrors what orchestrate/actions.ts emits for zombie cleanup
      const eventData = {
        sessionId: 'gc-sweep-bold-turing',
        runner: 'gc-sweep',
        reason: 'error' as const,
        timestamp: new Date(),
      }
      const json = safeJsonStringify('agent:stopped', eventData)
      expect(() => JSON.parse(json)).not.to.throw()
    })
  })
})
