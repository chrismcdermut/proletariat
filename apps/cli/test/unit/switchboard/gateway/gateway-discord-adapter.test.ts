import { expect } from 'chai'
import { DiscordAdapter } from '../../../../src/lib/switchboard/gateway/adapters/discord.js'
import type { GatewayCredentials, InboundMessage } from '../../../../src/lib/switchboard/gateway/types.js'

describe('DiscordAdapter', () => {
  const credentials: GatewayCredentials = {
    platform: 'discord',
    botToken: 'discord-bot-token',
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe('lifecycle', () => {
    it('starts with stopped state', () => {
      const adapter = new DiscordAdapter({ credentials })
      expect(adapter.state).to.equal('stopped')
      expect(adapter.platform).to.equal('discord')
    })

    it('transitions to connected on start', async () => {
      const adapter = new DiscordAdapter({ credentials })
      await adapter.start()
      expect(adapter.state).to.equal('connected')
    })

    it('transitions to stopped on stop', async () => {
      const adapter = new DiscordAdapter({ credentials })
      await adapter.start()
      await adapter.stop()
      expect(adapter.state).to.equal('stopped')
    })

    it('throws if botToken is missing', async () => {
      const badCreds: GatewayCredentials = { platform: 'discord', botToken: '' }
      const adapter = new DiscordAdapter({ credentials: badCreds })
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
  // parseMessageEvent()
  // ===========================================================================

  describe('parseMessageEvent()', () => {
    it('parses a valid message event', () => {
      const adapter = new DiscordAdapter({ credentials })
      const result = adapter.parseMessageEvent({
        id: 'msg-123',
        channel_id: 'ch-456',
        content: 'Hello from Discord',
        author: { id: 'user-1', username: 'alice' },
        timestamp: '2026-01-01T00:00:00.000Z',
      })

      expect(result).to.not.be.null
      expect(result!.platform).to.equal('discord')
      expect(result!.platformMessageId).to.equal('msg-123')
      expect(result!.senderId).to.equal('user-1')
      expect(result!.senderName).to.equal('alice')
      expect(result!.channelId).to.equal('ch-456')
      expect(result!.text).to.equal('Hello from Discord')
    })

    it('includes message_reference as threadId', () => {
      const adapter = new DiscordAdapter({ credentials })
      const result = adapter.parseMessageEvent({
        id: 'msg-2',
        channel_id: 'ch-1',
        content: 'Reply',
        author: { id: 'user-1', username: 'bob' },
        timestamp: '2026-01-01T00:00:00.000Z',
        message_reference: { message_id: 'msg-1' },
      })

      expect(result!.threadId).to.equal('msg-1')
    })

    it('returns null for bot messages', () => {
      const adapter = new DiscordAdapter({ credentials })
      const result = adapter.parseMessageEvent({
        id: 'msg-3',
        channel_id: 'ch-1',
        content: 'Bot message',
        author: { id: 'bot-1', username: 'mybot', bot: true },
        timestamp: '2026-01-01T00:00:00.000Z',
      })

      expect(result).to.be.null
    })

    it('returns null for empty content', () => {
      const adapter = new DiscordAdapter({ credentials })
      const result = adapter.parseMessageEvent({
        id: 'msg-4',
        channel_id: 'ch-1',
        content: '',
        author: { id: 'user-1', username: 'alice' },
        timestamp: '2026-01-01T00:00:00.000Z',
      })

      expect(result).to.be.null
    })
  })

  // ===========================================================================
  // parseInteraction()
  // ===========================================================================

  describe('parseInteraction()', () => {
    it('parses a slash command interaction', () => {
      const adapter = new DiscordAdapter({ credentials })
      const result = adapter.parseInteraction({
        type: 2, // APPLICATION_COMMAND
        id: 'int-123',
        channel_id: 'ch-1',
        member: {
          user: { id: 'user-1', username: 'alice' },
        },
        data: {
          name: 'status',
          options: [{ name: 'agent', value: 'my-agent' }],
        },
      })

      expect(result).to.not.be.null
      expect(result!.platform).to.equal('discord')
      expect(result!.senderId).to.equal('user-1')
      expect(result!.text).to.equal('/status my-agent')
      expect(result!.metadata).to.have.property('interactionType', 2)
    })

    it('returns null for PING interactions', () => {
      const adapter = new DiscordAdapter({ credentials })
      const result = adapter.parseInteraction({ type: 1 })
      expect(result).to.be.null
    })

    it('returns null when user is missing', () => {
      const adapter = new DiscordAdapter({ credentials })
      const result = adapter.parseInteraction({
        type: 2,
        data: { name: 'test' },
      })
      expect(result).to.be.null
    })

    it('uses DM user when member is absent', () => {
      const adapter = new DiscordAdapter({ credentials })
      const result = adapter.parseInteraction({
        type: 2,
        id: 'int-1',
        user: { id: 'user-dm', username: 'bob' },
        data: { name: 'help' },
      })

      expect(result).to.not.be.null
      expect(result!.senderId).to.equal('user-dm')
    })
  })

  // ===========================================================================
  // handleWebhook()
  // ===========================================================================

  describe('handleWebhook()', () => {
    it('responds to PING with type 1', async () => {
      const adapter = new DiscordAdapter({
        credentials: { platform: 'discord', botToken: 'token' },
      })
      const body = JSON.stringify({ type: 1 })

      const response = await adapter.handleWebhook({}, body)
      expect(response.status).to.equal(200)
      expect(response.body).to.deep.equal({ type: 1 })
    })

    it('acknowledges command interactions with type 5', async () => {
      const received: InboundMessage[] = []
      const adapter = new DiscordAdapter({
        credentials: { platform: 'discord', botToken: 'token' },
        onMessage: (msg) => { received.push(msg) },
      })

      const body = JSON.stringify({
        type: 2,
        id: 'int-1',
        channel_id: 'ch-1',
        member: { user: { id: 'user-1', username: 'alice' } },
        data: { name: 'status' },
      })

      const response = await adapter.handleWebhook({}, body)
      expect(response.status).to.equal(200)
      expect(response.body).to.deep.equal({ type: 5 })
      expect(received).to.have.length(1)
    })

    it('rejects invalid JSON', async () => {
      const adapter = new DiscordAdapter({
        credentials: { platform: 'discord', botToken: 'token' },
      })

      const response = await adapter.handleWebhook({}, 'not-json')
      expect(response.status).to.equal(400)
    })
  })
})
