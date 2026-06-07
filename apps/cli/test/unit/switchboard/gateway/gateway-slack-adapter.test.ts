import { expect } from 'chai'
import * as crypto from 'node:crypto'
import { SlackAdapter } from '../../../../src/lib/switchboard/gateway/adapters/slack.js'
import type { GatewayCredentials, InboundMessage, OutboundMessage } from '../../../../src/lib/switchboard/gateway/types.js'

describe('SlackAdapter', () => {
  const credentials: GatewayCredentials = {
    platform: 'slack',
    botToken: 'xoxb-test-token',
    signingSecret: 'slack-signing-secret',
    allowedUserIds: ['U1', 'U2'],
  }

  function makeSignedHeaders(body: string): Record<string, string> {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const baseString = `v0:${timestamp}:${body}`
    const hmac = crypto.createHmac('sha256', credentials.signingSecret!)
    hmac.update(baseString)
    return {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': `v0=${hmac.digest('hex')}`,
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe('lifecycle', () => {
    it('starts with stopped state', () => {
      const adapter = new SlackAdapter({ credentials })
      expect(adapter.state).to.equal('stopped')
      expect(adapter.platform).to.equal('slack')
    })

    it('transitions to connected on start', async () => {
      const adapter = new SlackAdapter({ credentials })
      await adapter.start()
      expect(adapter.state).to.equal('connected')
    })

    it('transitions to stopped on stop', async () => {
      const adapter = new SlackAdapter({ credentials })
      await adapter.start()
      await adapter.stop()
      expect(adapter.state).to.equal('stopped')
    })

    it('throws if botToken is missing', async () => {
      const badCreds: GatewayCredentials = { platform: 'slack', botToken: '' }
      const adapter = new SlackAdapter({ credentials: badCreds })
      try {
        await adapter.start()
        expect.fail('should have thrown')
      } catch (err: unknown) {
        expect((err as Error).message).to.include('botToken')
      }
      expect(adapter.state).to.equal('error')
    })
  })

  // ===========================================================================
  // parseEvent()
  // ===========================================================================

  describe('parseEvent()', () => {
    it('parses a valid message event', () => {
      const adapter = new SlackAdapter({ credentials })
      const result = adapter.parseEvent({
        type: 'event_callback',
        event_id: 'evt-123',
        event: {
          type: 'message',
          user: 'U1',
          text: 'Hello world',
          channel: 'C12345',
          ts: '1672531200.000000',
        },
      })

      expect(result).to.not.be.null
      expect(result!.platform).to.equal('slack')
      expect(result!.senderId).to.equal('U1')
      expect(result!.text).to.equal('Hello world')
      expect(result!.channelId).to.equal('C12345')
      expect(result!.platformMessageId).to.equal('evt-123')
    })

    it('includes thread_ts when present', () => {
      const adapter = new SlackAdapter({ credentials })
      const result = adapter.parseEvent({
        type: 'event_callback',
        event: {
          type: 'message',
          user: 'U1',
          text: 'Reply',
          channel: 'C1',
          ts: '1672531200.000',
          thread_ts: '1672531100.000',
        },
      })

      expect(result!.threadId).to.equal('1672531100.000')
    })

    it('returns null for url_verification events', () => {
      const adapter = new SlackAdapter({ credentials })
      const result = adapter.parseEvent({
        type: 'url_verification',
        challenge: 'challenge-token',
      })

      expect(result).to.be.null
    })

    it('returns null when event is missing', () => {
      const adapter = new SlackAdapter({ credentials })
      const result = adapter.parseEvent({ type: 'event_callback' })
      expect(result).to.be.null
    })

    it('returns null for non-message events', () => {
      const adapter = new SlackAdapter({ credentials })
      const result = adapter.parseEvent({
        type: 'event_callback',
        event: {
          type: 'reaction_added',
          user: 'U1',
          text: 'test',
          channel: 'C1',
        },
      })
      expect(result).to.be.null
    })

    it('returns null when user is missing', () => {
      const adapter = new SlackAdapter({ credentials })
      const result = adapter.parseEvent({
        type: 'event_callback',
        event: {
          type: 'message',
          text: 'Hello',
          channel: 'C1',
        },
      })
      expect(result).to.be.null
    })
  })

  // ===========================================================================
  // handleWebhook()
  // ===========================================================================

  describe('handleWebhook()', () => {
    it('responds to url_verification challenge', async () => {
      const adapter = new SlackAdapter({ credentials })
      const body = JSON.stringify({ type: 'url_verification', challenge: 'my-challenge' })
      const headers = makeSignedHeaders(body)

      const response = await adapter.handleWebhook(headers, body)
      expect(response.status).to.equal(200)
      expect(response.body).to.deep.equal({ challenge: 'my-challenge' })
    })

    it('rejects requests with invalid signature', async () => {
      const adapter = new SlackAdapter({ credentials })
      const body = '{"type":"event_callback"}'
      const headers = {
        'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-slack-signature': 'v0=invalid',
      }

      const response = await adapter.handleWebhook(headers, body)
      expect(response.status).to.equal(401)
    })

    it('rejects invalid JSON', async () => {
      const adapter = new SlackAdapter({ credentials })
      const body = 'not-json'
      const headers = makeSignedHeaders(body)

      const response = await adapter.handleWebhook(headers, body)
      expect(response.status).to.equal(400)
    })

    it('forwards valid message events to onMessage', async () => {
      const received: InboundMessage[] = []
      const adapter = new SlackAdapter({
        credentials: { ...credentials, allowedUserIds: undefined },
        onMessage: (msg) => { received.push(msg) },
      })

      const body = JSON.stringify({
        type: 'event_callback',
        event_id: 'evt-1',
        event: {
          type: 'message',
          user: 'U1',
          text: 'hello',
          channel: 'C1',
          ts: '1672531200.000',
        },
      })
      const headers = makeSignedHeaders(body)

      const response = await adapter.handleWebhook(headers, body)
      expect(response.status).to.equal(200)
      expect(received).to.have.length(1)
      expect(received[0].text).to.equal('hello')
    })
  })

  // ===========================================================================
  // verify()
  // ===========================================================================

  describe('verify()', () => {
    it('delegates to verifyAuth', async () => {
      const adapter = new SlackAdapter({ credentials })
      const body = '{"text":"test"}'
      const headers = makeSignedHeaders(body)

      const result = await adapter.verify(headers, body)
      expect(result.authorized).to.be.true
    })

    it('returns unauthorized for invalid signature', async () => {
      const adapter = new SlackAdapter({ credentials })
      const result = await adapter.verify(
        { 'x-slack-request-timestamp': '0', 'x-slack-signature': 'v0=bad' },
        '{}',
      )
      expect(result.authorized).to.be.false
    })
  })
})
