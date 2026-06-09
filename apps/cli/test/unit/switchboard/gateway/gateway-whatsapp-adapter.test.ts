import { expect } from 'chai'
import * as crypto from 'node:crypto'
import { WhatsAppAdapter } from '../../../../src/lib/switchboard/gateway/adapters/whatsapp.js'
import type { GatewayCredentials, InboundMessage } from '../../../../src/lib/switchboard/gateway/types.js'

describe('WhatsAppAdapter', () => {
  const credentials: GatewayCredentials = {
    platform: 'whatsapp',
    botToken: 'whatsapp-access-token',
    signingSecret: 'whatsapp-app-secret',
  }

  function makeSignedHeaders(body: string): Record<string, string> {
    const hmac = crypto.createHmac('sha256', credentials.signingSecret!)
    hmac.update(body)
    return {
      'x-hub-signature-256': `sha256=${hmac.digest('hex')}`,
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe('lifecycle', () => {
    it('starts with stopped state', () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'verify-tok',
      })
      expect(adapter.state).to.equal('stopped')
      expect(adapter.platform).to.equal('whatsapp')
    })

    it('transitions to connected on start', async () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'verify-tok',
      })
      await adapter.start()
      expect(adapter.state).to.equal('connected')
    })

    it('transitions to stopped on stop', async () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'verify-tok',
      })
      await adapter.start()
      await adapter.stop()
      expect(adapter.state).to.equal('stopped')
    })

    it('throws if botToken is missing', async () => {
      const badCreds: GatewayCredentials = { platform: 'whatsapp', botToken: '' }
      const adapter = new WhatsAppAdapter({
        credentials: badCreds,
        phoneNumberId: 'phone-1',
        verifyToken: 'verify-tok',
      })
      try {
        await adapter.start()
        expect.fail('should have thrown')
      } catch (err: unknown) {
        expect((err as Error).message).to.include('botToken')
      }
      expect(adapter.state).to.equal('error')
    })

    it('throws if phoneNumberId is missing', async () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: '',
        verifyToken: 'verify-tok',
      })
      try {
        await adapter.start()
        expect.fail('should have thrown')
      } catch (err: unknown) {
        expect((err as Error).message).to.include('phoneNumberId')
      }
    })
  })

  // ===========================================================================
  // handleVerification()
  // ===========================================================================

  describe('handleVerification()', () => {
    it('accepts valid verification request', () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'my-verify-token',
      })

      const result = adapter.handleVerification({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'my-verify-token',
        'hub.challenge': 'challenge-123',
      })

      expect(result.status).to.equal(200)
      expect(result.body).to.equal('challenge-123')
    })

    it('rejects mismatched verify token', () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'correct-token',
      })

      const result = adapter.handleVerification({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'challenge-123',
      })

      expect(result.status).to.equal(403)
    })

    it('rejects non-subscribe mode', () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'token',
      })

      const result = adapter.handleVerification({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': 'token',
        'hub.challenge': 'challenge-123',
      })

      expect(result.status).to.equal(403)
    })

    it('rejects when challenge is missing', () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'token',
      })

      const result = adapter.handleVerification({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'token',
      })

      expect(result.status).to.equal(403)
    })
  })

  // ===========================================================================
  // parseWebhookPayload()
  // ===========================================================================

  describe('parseWebhookPayload()', () => {
    it('parses a valid text message', () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'token',
      })

      const result = adapter.parseWebhookPayload({
        object: 'whatsapp_business_account',
        entry: [{
          id: 'entry-1',
          changes: [{
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ wa_id: '+1234567890', profile: { name: 'Alice' } }],
              messages: [{
                from: '+1234567890',
                id: 'wamid-123',
                timestamp: '1672531200',
                type: 'text',
                text: { body: 'Hello from WhatsApp' },
              }],
            },
          }],
        }],
      })

      expect(result).to.have.length(1)
      expect(result[0].platform).to.equal('whatsapp')
      expect(result[0].senderId).to.equal('+1234567890')
      expect(result[0].senderName).to.equal('Alice')
      expect(result[0].text).to.equal('Hello from WhatsApp')
      expect(result[0].channelId).to.equal('+1234567890')
    })

    it('parses multiple messages in one payload', () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'token',
      })

      const result = adapter.parseWebhookPayload({
        object: 'whatsapp_business_account',
        entry: [{
          id: 'entry-1',
          changes: [{
            field: 'messages',
            value: {
              messages: [
                { from: '+111', id: 'msg-1', type: 'text', text: { body: 'First' }, timestamp: '1672531200' },
                { from: '+222', id: 'msg-2', type: 'text', text: { body: 'Second' }, timestamp: '1672531201' },
              ],
            },
          }],
        }],
      })

      expect(result).to.have.length(2)
      expect(result[0].text).to.equal('First')
      expect(result[1].text).to.equal('Second')
    })

    it('ignores non-text messages', () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'token',
      })

      const result = adapter.parseWebhookPayload({
        object: 'whatsapp_business_account',
        entry: [{
          id: 'entry-1',
          changes: [{
            field: 'messages',
            value: {
              messages: [
                { from: '+111', id: 'msg-1', type: 'image', timestamp: '1672531200' },
              ],
            },
          }],
        }],
      })

      expect(result).to.have.length(0)
    })

    it('ignores non-whatsapp_business_account objects', () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'token',
      })

      const result = adapter.parseWebhookPayload({
        object: 'page',
        entry: [{
          id: 'entry-1',
          changes: [{
            field: 'messages',
            value: {
              messages: [
                { from: '+111', id: 'msg-1', type: 'text', text: { body: 'Hello' }, timestamp: '1' },
              ],
            },
          }],
        }],
      })

      expect(result).to.have.length(0)
    })

    it('ignores non-messages field changes', () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'token',
      })

      const result = adapter.parseWebhookPayload({
        object: 'whatsapp_business_account',
        entry: [{
          id: 'entry-1',
          changes: [{
            field: 'statuses',
            value: {},
          }],
        }],
      })

      expect(result).to.have.length(0)
    })

    it('handles empty entry array', () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'token',
      })

      const result = adapter.parseWebhookPayload({
        object: 'whatsapp_business_account',
        entry: [],
      })

      expect(result).to.have.length(0)
    })
  })

  // ===========================================================================
  // handleWebhook()
  // ===========================================================================

  describe('handleWebhook()', () => {
    it('rejects invalid signature', async () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'token',
      })

      const response = await adapter.handleWebhook(
        { 'x-hub-signature-256': 'sha256=invalid' },
        '{}',
      )
      expect(response.status).to.equal(401)
    })

    it('rejects invalid JSON', async () => {
      const adapter = new WhatsAppAdapter({
        credentials,
        phoneNumberId: 'phone-1',
        verifyToken: 'token',
      })
      const body = 'not-json'
      const headers = makeSignedHeaders(body)

      const response = await adapter.handleWebhook(headers, body)
      expect(response.status).to.equal(400)
    })

    it('processes valid webhook and forwards messages', async () => {
      const received: InboundMessage[] = []
      const adapter = new WhatsAppAdapter({
        credentials: { ...credentials, allowedUserIds: undefined },
        phoneNumberId: 'phone-1',
        verifyToken: 'token',
        onMessage: (msg) => { received.push(msg) },
      })

      const body = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{
          id: 'entry-1',
          changes: [{
            field: 'messages',
            value: {
              messages: [{
                from: '+111',
                id: 'msg-1',
                type: 'text',
                text: { body: 'Test message' },
                timestamp: '1672531200',
              }],
            },
          }],
        }],
      })
      const headers = makeSignedHeaders(body)

      const response = await adapter.handleWebhook(headers, body)
      expect(response.status).to.equal(200)
      expect(received).to.have.length(1)
      expect(received[0].text).to.equal('Test message')
    })

    it('returns 200 even when no messages are in payload', async () => {
      const adapter = new WhatsAppAdapter({
        credentials: { ...credentials, allowedUserIds: undefined },
        phoneNumberId: 'phone-1',
        verifyToken: 'token',
      })

      const body = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [],
      })
      const headers = makeSignedHeaders(body)

      const response = await adapter.handleWebhook(headers, body)
      expect(response.status).to.equal(200)
    })
  })
})
