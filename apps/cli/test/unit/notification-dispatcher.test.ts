import { expect } from 'chai'
import {
  buildMessage,
  dispatchNotification,
  dispatchNotifications,
} from '../../src/lib/notifications/dispatcher.js'
import type { NotificationProvider, NotificationContext } from '../../src/lib/notifications/types.js'

/**
 * Tests for notification dispatcher — message building and handler behavior.
 */
describe('NotificationDispatcher (PRLT-1157)', () => {
  // =========================================================================
  // buildMessage
  // =========================================================================
  describe('buildMessage', () => {
    it('should build message from event context', () => {
      const msg = buildMessage({
        event: 'on_agent_died',
        ticket: 'PRLT-123',
        pr: 42,
        agent: 'agent-1',
        branch: 'feat/test',
      })

      expect(msg).to.include('[on_agent_died]')
      expect(msg).to.include('ticket=PRLT-123')
      expect(msg).to.include('PR=#42')
      expect(msg).to.include('agent=agent-1')
      expect(msg).to.include('branch=feat/test')
    })

    it('should include custom message', () => {
      const msg = buildMessage({
        event: 'test',
        message: 'Custom notification text',
      })

      expect(msg).to.include('[test]')
      expect(msg).to.include('Custom notification text')
    })

    it('should return "Notification" for empty context', () => {
      const msg = buildMessage({} as NotificationContext)
      expect(msg).to.equal('Notification')
    })
  })

  // =========================================================================
  // Terminal handler
  // =========================================================================
  describe('terminal handler', () => {
    it('should succeed for terminal provider', async () => {
      const provider: NotificationProvider = {
        id: 'test-id',
        type: 'terminal',
        name: 'test-terminal',
        config: { prefix: '[TEST]' },
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const result = await dispatchNotification(provider, {
        event: 'test',
        message: 'Hello world',
      })

      expect(result.success).to.equal(true)
      expect(result.providerName).to.equal('test-terminal')
      expect(result.providerType).to.equal('terminal')
      expect(result.durationMs).to.be.a('number')
    })
  })

  // =========================================================================
  // Browser push handler (placeholder)
  // =========================================================================
  describe('browser_push handler', () => {
    it('should succeed silently for browser push', async () => {
      const provider: NotificationProvider = {
        id: 'test-push',
        type: 'browser_push',
        name: 'test-push',
        config: {},
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const result = await dispatchNotification(provider, { event: 'test' })
      expect(result.success).to.equal(true)
    })
  })

  // =========================================================================
  // Slack handler (validation)
  // =========================================================================
  describe('slack handler', () => {
    it('should fail without webhook_url', async () => {
      const provider: NotificationProvider = {
        id: 'test-slack',
        type: 'slack',
        name: 'test-slack',
        config: {} as any,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const result = await dispatchNotification(provider, { event: 'test' })
      expect(result.success).to.equal(false)
      expect(result.error).to.include('webhook_url')
    })
  })

  // =========================================================================
  // Email handler (validation)
  // =========================================================================
  describe('email handler', () => {
    it('should fail without required fields', async () => {
      const provider: NotificationProvider = {
        id: 'test-email',
        type: 'email',
        name: 'test-email',
        config: { provider: 'sendgrid' } as any,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const result = await dispatchNotification(provider, { event: 'test' })
      expect(result.success).to.equal(false)
      expect(result.error).to.include('api_key')
    })
  })

  // =========================================================================
  // SMS handler (validation)
  // =========================================================================
  describe('sms handler', () => {
    it('should fail without required fields', async () => {
      const provider: NotificationProvider = {
        id: 'test-sms',
        type: 'sms',
        name: 'test-sms',
        config: {} as any,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const result = await dispatchNotification(provider, { event: 'test' })
      expect(result.success).to.equal(false)
      expect(result.error).to.include('account_sid')
    })
  })

  // =========================================================================
  // dispatchNotifications (multiple)
  // =========================================================================
  describe('dispatchNotifications', () => {
    it('should dispatch to multiple providers', async () => {
      const terminal1: NotificationProvider = {
        id: 't1',
        type: 'terminal',
        name: 'terminal-1',
        config: {},
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      const terminal2: NotificationProvider = {
        id: 't2',
        type: 'terminal',
        name: 'terminal-2',
        config: {},
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const results = await dispatchNotifications([terminal1, terminal2], { event: 'test' })
      expect(results).to.have.lengthOf(2)
      expect(results.every(r => r.success)).to.equal(true)
    })
  })
})
