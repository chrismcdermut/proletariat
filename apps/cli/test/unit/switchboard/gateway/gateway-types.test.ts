import { expect } from 'chai'
import type {
  GatewayPlatform,
  InboundMessage,
  OutboundMessage,
  MessageBlock,
  MessageTarget,
  GatewayCredentials,
  AuthResult,
  AdapterState,
  AdapterConfig,
  GatewayConfig,
  TextBlock,
  CodeBlock,
  LinkBlock,
  StatusCardBlock,
  DividerBlock,
} from '../../../../src/lib/switchboard/gateway/types.js'

describe('Gateway Types', () => {
  // ===========================================================================
  // GatewayPlatform
  // ===========================================================================

  describe('GatewayPlatform', () => {
    it('accepts valid platform values', () => {
      const platforms: GatewayPlatform[] = ['slack', 'discord', 'whatsapp']
      expect(platforms).to.have.length(3)
      expect(platforms).to.include('slack')
      expect(platforms).to.include('discord')
      expect(platforms).to.include('whatsapp')
    })
  })

  // ===========================================================================
  // InboundMessage
  // ===========================================================================

  describe('InboundMessage', () => {
    it('can construct a complete inbound message', () => {
      const msg: InboundMessage = {
        platformMessageId: 'msg-123',
        platform: 'slack',
        senderId: 'U12345',
        senderName: 'Alice',
        channelId: 'C67890',
        text: 'Hello agent',
        threadId: 'thread-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        metadata: { key: 'value' },
      }

      expect(msg.platformMessageId).to.equal('msg-123')
      expect(msg.platform).to.equal('slack')
      expect(msg.senderId).to.equal('U12345')
      expect(msg.senderName).to.equal('Alice')
      expect(msg.channelId).to.equal('C67890')
      expect(msg.text).to.equal('Hello agent')
      expect(msg.threadId).to.equal('thread-1')
      expect(msg.metadata).to.deep.equal({ key: 'value' })
    })

    it('works with minimal required fields', () => {
      const msg: InboundMessage = {
        platformMessageId: 'msg-456',
        platform: 'discord',
        senderId: 'user-1',
        channelId: 'ch-1',
        text: 'test',
        timestamp: '2026-01-01T00:00:00.000Z',
      }

      expect(msg.senderName).to.be.undefined
      expect(msg.threadId).to.be.undefined
      expect(msg.metadata).to.be.undefined
    })
  })

  // ===========================================================================
  // OutboundMessage
  // ===========================================================================

  describe('OutboundMessage', () => {
    it('can construct an outbound message with blocks', () => {
      const msg: OutboundMessage = {
        platform: 'slack',
        channelId: 'C12345',
        text: 'Fallback text',
        threadId: 'thread-1',
        blocks: [
          { type: 'text', content: 'Hello' },
          { type: 'divider' },
        ],
      }

      expect(msg.platform).to.equal('slack')
      expect(msg.blocks).to.have.length(2)
    })

    it('works without blocks', () => {
      const msg: OutboundMessage = {
        platform: 'discord',
        channelId: 'ch-1',
        text: 'Simple message',
      }

      expect(msg.blocks).to.be.undefined
    })
  })

  // ===========================================================================
  // MessageBlock
  // ===========================================================================

  describe('MessageBlock', () => {
    it('supports text blocks', () => {
      const block: TextBlock = { type: 'text', content: 'Hello world' }
      expect(block.type).to.equal('text')
      expect(block.content).to.equal('Hello world')
    })

    it('supports code blocks with language', () => {
      const block: CodeBlock = { type: 'code', content: 'const x = 1', language: 'typescript' }
      expect(block.type).to.equal('code')
      expect(block.language).to.equal('typescript')
    })

    it('supports link blocks', () => {
      const block: LinkBlock = { type: 'link', url: 'https://example.com', label: 'Example' }
      expect(block.type).to.equal('link')
      expect(block.url).to.equal('https://example.com')
    })

    it('supports status card blocks', () => {
      const block: StatusCardBlock = {
        type: 'status_card',
        title: 'Build Status',
        status: 'success',
        fields: [
          { label: 'Branch', value: 'main' },
          { label: 'Commit', value: 'abc123' },
        ],
      }
      expect(block.type).to.equal('status_card')
      expect(block.status).to.equal('success')
      expect(block.fields).to.have.length(2)
    })

    it('supports divider blocks', () => {
      const block: DividerBlock = { type: 'divider' }
      expect(block.type).to.equal('divider')
    })

    it('accepts all block types in an array', () => {
      const blocks: MessageBlock[] = [
        { type: 'text', content: 'Hello' },
        { type: 'code', content: 'x = 1' },
        { type: 'link', url: 'https://example.com' },
        { type: 'status_card', title: 'Status', status: 'info', fields: [] },
        { type: 'divider' },
      ]
      expect(blocks).to.have.length(5)
    })
  })

  // ===========================================================================
  // MessageTarget
  // ===========================================================================

  describe('MessageTarget', () => {
    it('represents a direct target by agent', () => {
      const target: MessageTarget = { mode: 'direct', agentId: 'agent-1' }
      expect(target.mode).to.equal('direct')
      expect(target.agentId).to.equal('agent-1')
    })

    it('represents a direct target by ticket', () => {
      const target: MessageTarget = { mode: 'direct', ticketId: 'PRLT-123' }
      expect(target.mode).to.equal('direct')
      expect(target.ticketId).to.equal('PRLT-123')
    })

    it('represents a broadcast target', () => {
      const target: MessageTarget = { mode: 'broadcast' }
      expect(target.mode).to.equal('broadcast')
      expect(target.agentId).to.be.undefined
      expect(target.ticketId).to.be.undefined
    })
  })

  // ===========================================================================
  // GatewayCredentials
  // ===========================================================================

  describe('GatewayCredentials', () => {
    it('accepts complete Slack credentials', () => {
      const creds: GatewayCredentials = {
        platform: 'slack',
        botToken: 'xoxb-123',
        signingSecret: 'secret-123',
        appToken: 'xapp-123',
        allowedUserIds: ['U1', 'U2'],
      }

      expect(creds.platform).to.equal('slack')
      expect(creds.botToken).to.equal('xoxb-123')
      expect(creds.allowedUserIds).to.have.length(2)
    })

    it('accepts WhatsApp credentials with extra fields', () => {
      const creds: GatewayCredentials = {
        platform: 'whatsapp',
        botToken: 'access-token',
        signingSecret: 'app-secret',
        phoneNumberId: 'phone-1',
        verifyToken: 'verify-tok',
      }

      expect(creds.phoneNumberId).to.equal('phone-1')
      expect(creds.verifyToken).to.equal('verify-tok')
    })

    it('works with minimal fields', () => {
      const creds: GatewayCredentials = {
        platform: 'discord',
        botToken: 'discord-bot-token',
      }

      expect(creds.signingSecret).to.be.undefined
      expect(creds.allowedUserIds).to.be.undefined
    })
  })

  // ===========================================================================
  // AuthResult
  // ===========================================================================

  describe('AuthResult', () => {
    it('represents authorized result', () => {
      const result: AuthResult = {
        authorized: true,
        userId: 'U12345',
      }

      expect(result.authorized).to.be.true
      expect(result.userId).to.equal('U12345')
      expect(result.reason).to.be.undefined
    })

    it('represents denied result', () => {
      const result: AuthResult = {
        authorized: false,
        reason: 'Invalid signature',
      }

      expect(result.authorized).to.be.false
      expect(result.reason).to.equal('Invalid signature')
    })
  })

  // ===========================================================================
  // AdapterState
  // ===========================================================================

  describe('AdapterState', () => {
    it('accepts all valid states', () => {
      const states: AdapterState[] = ['stopped', 'starting', 'connected', 'error']
      expect(states).to.have.length(4)
    })
  })

  // ===========================================================================
  // GatewayConfig
  // ===========================================================================

  describe('GatewayConfig', () => {
    it('can construct a complete config', () => {
      const config: GatewayConfig = {
        adapters: [
          {
            platform: 'slack',
            enabled: true,
            credentials: {
              platform: 'slack',
              botToken: 'xoxb-123',
              signingSecret: 'secret',
            },
            defaultChannelId: 'C12345',
          },
        ],
        address: { kind: 'gateway', id: 'test-gateway' },
        subscribeTopics: ['agent:status_change'],
        webhookPort: 3000,
      }

      expect(config.adapters).to.have.length(1)
      expect(config.adapters[0].platform).to.equal('slack')
      expect(config.address?.id).to.equal('test-gateway')
    })
  })
})
