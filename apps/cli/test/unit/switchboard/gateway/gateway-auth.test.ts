import { expect } from 'chai'
import * as crypto from 'node:crypto'
import {
  verifyAuth,
  verifySlackSignature,
  verifyWhatsAppSignature,
} from '../../../../src/lib/switchboard/gateway/auth.js'
import type { GatewayCredentials } from '../../../../src/lib/switchboard/gateway/types.js'

describe('Gateway Auth', () => {
  // ===========================================================================
  // verifySlackSignature()
  // ===========================================================================

  describe('verifySlackSignature()', () => {
    const signingSecret = 'test-signing-secret-12345'

    function makeSlackHeaders(body: string, secret: string, timestampOverride?: string): Record<string, string> {
      const timestamp = timestampOverride ?? String(Math.floor(Date.now() / 1000))
      const baseString = `v0:${timestamp}:${body}`
      const hmac = crypto.createHmac('sha256', secret)
      hmac.update(baseString)
      const signature = `v0=${hmac.digest('hex')}`
      return {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      }
    }

    it('accepts a valid signature', () => {
      const body = '{"text":"hello"}'
      const headers = makeSlackHeaders(body, signingSecret)

      expect(verifySlackSignature(signingSecret, headers, body)).to.be.true
    })

    it('rejects an invalid signature', () => {
      const body = '{"text":"hello"}'
      const headers = makeSlackHeaders(body, 'wrong-secret')

      expect(verifySlackSignature(signingSecret, headers, body)).to.be.false
    })

    it('rejects when timestamp is missing', () => {
      const result = verifySlackSignature(signingSecret, { 'x-slack-signature': 'v0=abc' }, '{}')
      expect(result).to.be.false
    })

    it('rejects when signature is missing', () => {
      const result = verifySlackSignature(signingSecret, { 'x-slack-request-timestamp': '12345' }, '{}')
      expect(result).to.be.false
    })

    it('rejects requests older than 5 minutes', () => {
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400) // 6+ minutes ago
      const body = '{"text":"hello"}'
      const headers = makeSlackHeaders(body, signingSecret, oldTimestamp)

      expect(verifySlackSignature(signingSecret, headers, body)).to.be.false
    })

    it('rejects when body has been tampered with', () => {
      const body = '{"text":"hello"}'
      const headers = makeSlackHeaders(body, signingSecret)

      expect(verifySlackSignature(signingSecret, headers, '{"text":"tampered"}')).to.be.false
    })
  })

  // ===========================================================================
  // verifyWhatsAppSignature()
  // ===========================================================================

  describe('verifyWhatsAppSignature()', () => {
    const appSecret = 'whatsapp-app-secret-12345'

    function makeWhatsAppHeaders(body: string, secret: string): Record<string, string> {
      const hmac = crypto.createHmac('sha256', secret)
      hmac.update(body)
      return {
        'x-hub-signature-256': `sha256=${hmac.digest('hex')}`,
      }
    }

    it('accepts a valid signature', () => {
      const body = '{"object":"whatsapp_business_account"}'
      const headers = makeWhatsAppHeaders(body, appSecret)

      expect(verifyWhatsAppSignature(appSecret, headers, body)).to.be.true
    })

    it('rejects an invalid signature', () => {
      const body = '{"object":"whatsapp_business_account"}'
      const headers = makeWhatsAppHeaders(body, 'wrong-secret')

      expect(verifyWhatsAppSignature(appSecret, headers, body)).to.be.false
    })

    it('rejects when signature header is missing', () => {
      expect(verifyWhatsAppSignature(appSecret, {}, '{}')).to.be.false
    })

    it('rejects when body has been tampered with', () => {
      const body = '{"object":"test"}'
      const headers = makeWhatsAppHeaders(body, appSecret)

      expect(verifyWhatsAppSignature(appSecret, headers, '{"object":"tampered"}')).to.be.false
    })
  })

  // ===========================================================================
  // verifyAuth()
  // ===========================================================================

  describe('verifyAuth()', () => {
    it('authorizes when no signing secret and no allowed users', () => {
      const creds: GatewayCredentials = {
        platform: 'slack',
        botToken: 'xoxb-123',
      }

      const result = verifyAuth(creds, {}, '{}')
      expect(result.authorized).to.be.true
    })

    it('authorizes when signing secret matches', () => {
      const signingSecret = 'test-secret'
      const creds: GatewayCredentials = {
        platform: 'slack',
        botToken: 'xoxb-123',
        signingSecret,
      }

      const body = '{"text":"hello"}'
      const timestamp = String(Math.floor(Date.now() / 1000))
      const baseString = `v0:${timestamp}:${body}`
      const hmac = crypto.createHmac('sha256', signingSecret)
      hmac.update(baseString)
      const signature = `v0=${hmac.digest('hex')}`

      const headers = {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      }

      const result = verifyAuth(creds, headers, body)
      expect(result.authorized).to.be.true
    })

    it('rejects when signing secret is invalid', () => {
      const creds: GatewayCredentials = {
        platform: 'slack',
        botToken: 'xoxb-123',
        signingSecret: 'correct-secret',
      }

      const result = verifyAuth(creds, { 'x-slack-request-timestamp': '0', 'x-slack-signature': 'v0=invalid' }, '{}')
      expect(result.authorized).to.be.false
      expect(result.reason).to.include('Invalid')
    })

    it('authorizes when user is in allowed list', () => {
      const creds: GatewayCredentials = {
        platform: 'slack',
        botToken: 'xoxb-123',
        allowedUserIds: ['U1', 'U2', 'U3'],
      }

      const result = verifyAuth(creds, {}, '{}', 'U2')
      expect(result.authorized).to.be.true
      expect(result.userId).to.equal('U2')
    })

    it('rejects when user is not in allowed list', () => {
      const creds: GatewayCredentials = {
        platform: 'slack',
        botToken: 'xoxb-123',
        allowedUserIds: ['U1', 'U2'],
      }

      const result = verifyAuth(creds, {}, '{}', 'U99')
      expect(result.authorized).to.be.false
      expect(result.reason).to.include('not in the allowed')
      expect(result.userId).to.equal('U99')
    })

    it('authorizes when allowed list is empty (no restriction)', () => {
      const creds: GatewayCredentials = {
        platform: 'slack',
        botToken: 'xoxb-123',
        allowedUserIds: [],
      }

      const result = verifyAuth(creds, {}, '{}', 'U99')
      expect(result.authorized).to.be.true
    })

    it('authorizes when no senderId is provided (skip user check)', () => {
      const creds: GatewayCredentials = {
        platform: 'slack',
        botToken: 'xoxb-123',
        allowedUserIds: ['U1'],
      }

      const result = verifyAuth(creds, {}, '{}')
      expect(result.authorized).to.be.true
    })
  })
})
