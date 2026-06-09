import { expect } from 'chai'
import { Gateway } from '../../../../src/lib/switchboard/gateway/gateway.js'
import type {
  GatewayConfig,
  GatewayAdapter,
  AdapterState,
  OutboundMessage,
  AuthResult,
  InboundMessage,
} from '../../../../src/lib/switchboard/gateway/types.js'

/**
 * A mock adapter for testing the gateway coordinator.
 * Does not make any real API calls.
 */
class MockAdapter implements GatewayAdapter {
  readonly platform: 'slack' | 'discord' | 'whatsapp'
  private _state: AdapterState = 'stopped'
  sent: OutboundMessage[] = []
  startCalled = false
  stopCalled = false

  constructor(platform: 'slack' | 'discord' | 'whatsapp') {
    this.platform = platform
  }

  get state(): AdapterState {
    return this._state
  }

  async start(): Promise<void> {
    this.startCalled = true
    this._state = 'connected'
  }

  async stop(): Promise<void> {
    this.stopCalled = true
    this._state = 'stopped'
  }

  async send(message: OutboundMessage): Promise<void> {
    this.sent.push(message)
  }

  async verify(): Promise<AuthResult> {
    return { authorized: true }
  }
}

describe('Gateway', () => {
  // ===========================================================================
  // Constructor & Defaults
  // ===========================================================================

  describe('constructor', () => {
    it('uses default address when not provided', () => {
      const config: GatewayConfig = { adapters: [] }
      const gw = new Gateway(config)
      const status = gw.status()

      expect(status.switchboard.address.kind).to.equal('gateway')
      expect(status.switchboard.address.id).to.equal('messaging-gateway')
    })

    it('uses provided address', () => {
      const config: GatewayConfig = {
        adapters: [],
        address: { kind: 'gateway', id: 'custom-gw' },
      }
      const gw = new Gateway(config)
      const status = gw.status()

      expect(status.switchboard.address.id).to.equal('custom-gw')
    })
  })

  // ===========================================================================
  // DEFAULT_ADDRESS & DEFAULT_TOPICS
  // ===========================================================================

  describe('defaults', () => {
    it('has expected default address', () => {
      expect(Gateway.DEFAULT_ADDRESS.kind).to.equal('gateway')
      expect(Gateway.DEFAULT_ADDRESS.id).to.equal('messaging-gateway')
    })

    it('has expected default topics', () => {
      expect(Gateway.DEFAULT_TOPICS).to.include('agent:status_change')
      expect(Gateway.DEFAULT_TOPICS).to.include('agent:error')
      expect(Gateway.DEFAULT_TOPICS).to.include('work:pr_created')
      expect(Gateway.DEFAULT_TOPICS).to.include('work:completed')
      expect(Gateway.DEFAULT_TOPICS).to.include('work:status_changed')
    })
  })

  // ===========================================================================
  // status()
  // ===========================================================================

  describe('status()', () => {
    it('reports not started initially', () => {
      const gw = new Gateway({ adapters: [] })
      const status = gw.status()

      expect(status.started).to.be.false
      expect(status.adapters).to.have.length(0)
    })
  })

  // ===========================================================================
  // listAdapters()
  // ===========================================================================

  describe('listAdapters()', () => {
    it('returns empty array when no adapters are configured', () => {
      const gw = new Gateway({ adapters: [] })
      expect(gw.listAdapters()).to.have.length(0)
    })
  })

  // ===========================================================================
  // handleInboundMessage()
  // ===========================================================================

  describe('handleInboundMessage()', () => {
    it('processes an inbound message without error', async () => {
      const gw = new Gateway({ adapters: [] })

      // Should not throw even though there are no adapters
      await gw.handleInboundMessage({
        platformMessageId: 'msg-1',
        platform: 'slack',
        senderId: 'U1',
        channelId: 'C1',
        text: 'hello',
        timestamp: new Date().toISOString(),
      })
    })

    it('handles direct agent targeting', async () => {
      const gw = new Gateway({ adapters: [] })

      await gw.handleInboundMessage({
        platformMessageId: 'msg-2',
        platform: 'discord',
        senderId: 'user-1',
        channelId: 'ch-1',
        text: '@my-agent do something',
        timestamp: new Date().toISOString(),
      })
    })

    it('handles ticket-based routing', async () => {
      const gw = new Gateway({ adapters: [] })

      await gw.handleInboundMessage({
        platformMessageId: 'msg-3',
        platform: 'whatsapp',
        senderId: '+111',
        channelId: '+111',
        text: '#PRLT-123 check status',
        timestamp: new Date().toISOString(),
      })
    })

    it('handles broadcast messages', async () => {
      const gw = new Gateway({ adapters: [] })

      await gw.handleInboundMessage({
        platformMessageId: 'msg-4',
        platform: 'slack',
        senderId: 'U1',
        channelId: 'C1',
        text: 'hello everyone',
        timestamp: new Date().toISOString(),
      })
    })
  })

  // ===========================================================================
  // sendOutbound()
  // ===========================================================================

  describe('sendOutbound()', () => {
    it('logs and returns when no adapter exists for platform', async () => {
      const logs: string[] = []
      const gw = new Gateway({
        adapters: [],
        log: (msg) => logs.push(msg),
      })

      await gw.sendOutbound({
        platform: 'slack',
        channelId: 'C1',
        text: 'test',
      })

      expect(logs.some(l => l.includes('no adapter'))).to.be.true
    })
  })

  // ===========================================================================
  // broadcastOutbound()
  // ===========================================================================

  describe('broadcastOutbound()', () => {
    it('does nothing when channelIds map is empty', async () => {
      const gw = new Gateway({ adapters: [] })

      // Should not throw
      await gw.broadcastOutbound('hello', new Map())
    })
  })

  // ===========================================================================
  // formatSwitchboardNotification (via handleSwitchboardMessage)
  // ===========================================================================

  describe('notification formatting', () => {
    // We can test the formatting indirectly through the gateway's internal logic
    // by verifying the formatSwitchboardNotification patterns

    it('Gateway class can be instantiated with full config', () => {
      const config: GatewayConfig = {
        adapters: [
          {
            platform: 'slack',
            enabled: true,
            credentials: {
              platform: 'slack',
              botToken: 'xoxb-test',
              signingSecret: 'secret',
            },
            defaultChannelId: 'C12345',
          },
          {
            platform: 'discord',
            enabled: false,
            credentials: {
              platform: 'discord',
              botToken: 'discord-token',
            },
          },
          {
            platform: 'whatsapp',
            enabled: true,
            credentials: {
              platform: 'whatsapp',
              botToken: 'wa-token',
              phoneNumberId: 'phone-1',
              verifyToken: 'verify',
            },
          },
        ],
        subscribeTopics: ['agent:status_change', 'custom:topic'],
        webhookPort: 3000,
      }

      const gw = new Gateway(config)
      expect(gw.status().started).to.be.false
    })
  })

  // ===========================================================================
  // getAdapter()
  // ===========================================================================

  describe('getAdapter()', () => {
    it('returns undefined for non-existent platform', () => {
      const gw = new Gateway({ adapters: [] })
      expect(gw.getAdapter('slack')).to.be.undefined
    })
  })
})
