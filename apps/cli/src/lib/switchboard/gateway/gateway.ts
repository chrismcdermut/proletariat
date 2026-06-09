/**
 * Gateway — Coordinator for external messaging platform adapters.
 *
 * The gateway is the central hub that:
 * 1. Manages adapter lifecycle (start/stop)
 * 2. Routes inbound messages from platforms → switchboard
 * 3. Routes outbound switchboard messages → platforms
 * 4. Handles message targeting (specific agent vs broadcast)
 *
 * See: PRLT-1372
 */

import { SwitchboardClient } from '../client.js'
import type { SwitchboardAddress, SwitchboardMessage } from '../types.js'
import { parseMessageTarget } from './formatter.js'
import type {
  AdapterConfig,
  GatewayAdapter,
  GatewayConfig,
  GatewayPlatform,
  InboundMessage,
  MessageTarget,
  OutboundMessage,
} from './types.js'
import { SlackAdapter } from './adapters/slack.js'
import { DiscordAdapter } from './adapters/discord.js'
import { WhatsAppAdapter } from './adapters/whatsapp.js'

// =============================================================================
// Gateway
// =============================================================================

export class Gateway {
  private adapters = new Map<GatewayPlatform, GatewayAdapter>()
  private client: SwitchboardClient
  private config: GatewayConfig
  private log: (msg: string) => void
  private started = false

  /**
   * Default switchboard address for the gateway.
   */
  static readonly DEFAULT_ADDRESS: SwitchboardAddress = {
    kind: 'gateway',
    id: 'messaging-gateway',
  }

  /**
   * Default topics the gateway subscribes to for outbound notifications.
   */
  static readonly DEFAULT_TOPICS = [
    'agent:status_change',
    'agent:error',
    'work:pr_created',
    'work:completed',
    'work:status_changed',
  ]

  constructor(config: GatewayConfig) {
    this.config = config
    this.log = config.log ?? (() => {})

    const address = config.address ?? Gateway.DEFAULT_ADDRESS

    this.client = new SwitchboardClient({
      address,
      onMessage: (msg) => this.handleSwitchboardMessage(msg),
      log: this.log,
    })
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the gateway — initialize adapters and begin listening.
   */
  async start(): Promise<void> {
    if (this.started) return

    this.log('gateway: starting')

    // Initialize adapters from config
    for (const adapterConfig of this.config.adapters) {
      if (!adapterConfig.enabled) continue

      try {
        const adapter = this.createAdapter(adapterConfig)
        await adapter.start()
        this.adapters.set(adapterConfig.platform, adapter)
        this.log(`gateway: ${adapterConfig.platform} adapter started`)
      } catch (err) {
        this.log(`gateway: failed to start ${adapterConfig.platform} adapter: ${err}`)
      }
    }

    // Subscribe to switchboard topics for outbound messages
    const topics = this.config.subscribeTopics ?? Gateway.DEFAULT_TOPICS
    for (const topic of topics) {
      this.client.subscribe(topic)
    }

    // Start listening for switchboard messages
    this.client.startPolling()

    this.started = true
    this.log(`gateway: started with ${this.adapters.size} adapter(s)`)
  }

  /**
   * Stop the gateway — disconnect adapters and clean up.
   */
  async stop(): Promise<void> {
    if (!this.started) return

    this.log('gateway: stopping')

    // Stop all adapters
    for (const [platform, adapter] of this.adapters) {
      try {
        await adapter.stop()
        this.log(`gateway: ${platform} adapter stopped`)
      } catch (err) {
        this.log(`gateway: error stopping ${platform} adapter: ${err}`)
      }
    }
    this.adapters.clear()

    // Stop switchboard client
    this.client.close()

    this.started = false
    this.log('gateway: stopped')
  }

  // ===========================================================================
  // Adapter Management
  // ===========================================================================

  /**
   * Get a running adapter by platform.
   */
  getAdapter(platform: GatewayPlatform): GatewayAdapter | undefined {
    return this.adapters.get(platform)
  }

  /**
   * List all connected adapters and their states.
   */
  listAdapters(): Array<{ platform: GatewayPlatform; state: string }> {
    return Array.from(this.adapters.entries()).map(([platform, adapter]) => ({
      platform,
      state: adapter.state,
    }))
  }

  // ===========================================================================
  // Inbound (Platform → Switchboard)
  // ===========================================================================

  /**
   * Handle an inbound message from an external platform.
   *
   * Parses the routing target and publishes the message to the switchboard
   * as either a direct message (cast) or an event (publish).
   */
  async handleInboundMessage(message: InboundMessage): Promise<void> {
    const { mode, agentId, ticketId, cleanText } = parseMessageTarget(message.text)

    const target: MessageTarget = { mode, agentId, ticketId }
    const payload = {
      ...message,
      text: cleanText,
      target,
    }

    if (mode === 'direct' && agentId) {
      // Direct message to a specific agent
      this.client.cast({
        from: this.client.address,
        to: { kind: 'agent', id: agentId },
        type: `gateway:${message.platform}:message`,
        payload,
      })
      this.log(`gateway: routed message from ${message.platform}:${message.senderId} → agent:${agentId}`)
    } else if (mode === 'direct' && ticketId) {
      // Route by ticket — publish as event for the orchestrator to resolve
      this.client.publish(
        'gateway:route_by_ticket',
        `gateway:${message.platform}:message`,
        { ...payload, ticketId },
      )
      this.log(`gateway: routed message from ${message.platform}:${message.senderId} → ticket:${ticketId}`)
    } else {
      // Broadcast to all agents
      this.client.publish(
        'gateway:broadcast',
        `gateway:${message.platform}:message`,
        payload,
      )
      this.log(`gateway: broadcast message from ${message.platform}:${message.senderId}`)
    }
  }

  // ===========================================================================
  // Outbound (Switchboard → Platform)
  // ===========================================================================

  /**
   * Send a message to an external platform.
   *
   * Finds the adapter for the target platform and sends the message.
   */
  async sendOutbound(message: OutboundMessage): Promise<void> {
    const adapter = this.adapters.get(message.platform)
    if (!adapter) {
      this.log(`gateway: no adapter for platform ${message.platform}`)
      return
    }

    if (adapter.state !== 'connected') {
      this.log(`gateway: ${message.platform} adapter is not connected (state: ${adapter.state})`)
      return
    }

    await adapter.send(message)
  }

  /**
   * Send a message to all connected platforms.
   */
  async broadcastOutbound(text: string, channelIds: Map<GatewayPlatform, string>): Promise<void> {
    for (const [platform, channelId] of channelIds) {
      await this.sendOutbound({ platform, channelId, text })
    }
  }

  // ===========================================================================
  // Switchboard Message Handler
  // ===========================================================================

  /**
   * Handle a message received from the switchboard.
   *
   * Translates switchboard events (agent status changes, work updates)
   * into outbound notifications on configured platforms.
   */
  private async handleSwitchboardMessage(msg: SwitchboardMessage): Promise<void> {
    // Only forward events that have a topic (pub/sub events)
    if (!msg.topic) return

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(msg.payload) as Record<string, unknown>
    } catch {
      return
    }

    const text = this.formatSwitchboardNotification(msg.topic, msg.type, payload)
    if (!text) return

    // Send to all adapters that have a default channel configured
    for (const adapterConfig of this.config.adapters) {
      if (!adapterConfig.enabled || !adapterConfig.defaultChannelId) continue

      const adapter = this.adapters.get(adapterConfig.platform)
      if (!adapter || adapter.state !== 'connected') continue

      try {
        await adapter.send({
          platform: adapterConfig.platform,
          channelId: adapterConfig.defaultChannelId,
          text,
        })
      } catch (err) {
        this.log(`gateway: failed to send notification to ${adapterConfig.platform}: ${err}`)
      }
    }
  }

  /**
   * Format a switchboard event into a human-readable notification.
   */
  private formatSwitchboardNotification(
    topic: string,
    type: string,
    payload: Record<string, unknown>,
  ): string | null {
    switch (topic) {
      case 'agent:status_change':
        return `Agent ${payload.agentId ?? 'unknown'} status: ${payload.status ?? type}`

      case 'agent:error':
        return `Agent ${payload.agentId ?? 'unknown'} error: ${payload.error ?? 'unknown error'}`

      case 'work:pr_created':
        return `PR created: ${payload.url ?? payload.title ?? 'unknown'}`

      case 'work:completed':
        return `Work completed: ${payload.ticketId ?? payload.title ?? 'unknown'}`

      case 'work:status_changed':
        return `Work status: ${payload.ticketId ?? 'unknown'} → ${payload.status ?? 'unknown'}`

      default:
        return null
    }
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  /**
   * Get the gateway status — adapters, subscriptions, message counts.
   */
  status(): {
    started: boolean
    adapters: Array<{ platform: GatewayPlatform; state: string }>
    switchboard: ReturnType<SwitchboardClient['status']>
  } {
    return {
      started: this.started,
      adapters: this.listAdapters(),
      switchboard: this.client.status(),
    }
  }

  // ===========================================================================
  // Factory
  // ===========================================================================

  /**
   * Create an adapter instance from configuration.
   */
  private createAdapter(config: AdapterConfig): GatewayAdapter {
    const onMessage = (msg: InboundMessage) => this.handleInboundMessage(msg)

    switch (config.platform) {
      case 'slack':
        return new SlackAdapter({
          credentials: config.credentials,
          onMessage,
          log: this.log,
        })

      case 'discord':
        return new DiscordAdapter({
          credentials: config.credentials,
          onMessage,
          log: this.log,
        })

      case 'whatsapp':
        return new WhatsAppAdapter({
          credentials: config.credentials,
          phoneNumberId: config.credentials.phoneNumberId ?? '',
          verifyToken: config.credentials.verifyToken ?? '',
          onMessage,
          log: this.log,
        })
    }
  }
}
