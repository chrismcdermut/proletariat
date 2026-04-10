import { expect } from 'chai'
import {
  TelegramChannel,
  type TelegramClient,
  type TelegramUpdate,
} from '../../src/lib/gateway/channels/telegram.js'
import type { Message } from '../../src/lib/gateway/types.js'

/**
 * PRLT-1255 — Telegram adapter tests. We don't touch the network: a
 * FakeTelegramClient sits in for the HTTP client so we can drive the
 * poll loop deterministically and assert on inbound normalization,
 * allowlist enforcement, and cursor advancement.
 */

// =============================================================================
// Test double
// =============================================================================

class FakeTelegramClient implements TelegramClient {
  getUpdatesCalls: Array<{ offset?: number; timeoutSec?: number }> = []
  sentMessages: Array<{ chatId: string | number; text: string }> = []

  /** Pending batches of updates. Each call to getUpdates returns the next batch. */
  private batches: TelegramUpdate[][] = []
  /** Whether to throw on the next getUpdates call. */
  private throwNext = false
  /** Resolves immediately after each batch is drained. */
  private drainSignals: Array<() => void> = []

  queueBatch(batch: TelegramUpdate[]): Promise<void> {
    this.batches.push(batch)
    return new Promise(resolve => {
      this.drainSignals.push(resolve)
    })
  }

  throwOnNext(): void {
    this.throwNext = true
  }

  async getUpdates(options: { offset?: number; timeoutSec?: number }): Promise<TelegramUpdate[]> {
    this.getUpdatesCalls.push(options)
    if (this.throwNext) {
      this.throwNext = false
      throw new Error('simulated network error')
    }
    const batch = this.batches.shift()
    if (!batch) {
      // Simulate Telegram long-poll timeout with an empty response.
      await new Promise(resolve => setTimeout(resolve, 10))
      return []
    }
    // Signal that this batch is being returned.
    const signal = this.drainSignals.shift()
    if (signal) signal()
    return batch
  }

  async sendMessage(chatId: string | number, text: string): Promise<void> {
    this.sentMessages.push({ chatId, text })
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('TelegramChannel (PRLT-1255)', () => {
  let client: FakeTelegramClient
  let channel: TelegramChannel
  let received: Message[]

  beforeEach(() => {
    client = new FakeTelegramClient()
    received = []
  })

  afterEach(async () => {
    if (channel) await channel.stop()
  })

  function build(allowlist: string[] = ['111']): TelegramChannel {
    channel = new TelegramChannel({
      config: { token: 'fake-token', allowlist, pollIntervalMs: 1 },
      client,
    })
    channel.onMessage(async msg => {
      received.push(msg)
    })
    return channel
  }

  it('refuses start() without a handler registered', async () => {
    const ch = new TelegramChannel({
      config: { token: 'fake-token', allowlist: [] },
      client,
    })
    let err: unknown = null
    try {
      await ch.start()
    } catch (e) {
      err = e
    }
    expect(err).to.be.instanceOf(Error)
    expect((err as Error).message).to.match(/onMessage/)
  })

  it('normalizes a text message into the gateway Message shape', async () => {
    const ch = build(['111'])
    const drained = client.queueBatch([
      {
        update_id: 10,
        message: {
          message_id: 5,
          from: { id: 111, username: 'alice' },
          chat: { id: 999, type: 'private' },
          date: 1_700_000_000,
          text: 'hello bot',
        },
      },
    ])

    await ch.start()
    await drained
    // Give the loop a beat to invoke the handler.
    await new Promise(resolve => setTimeout(resolve, 50))
    await ch.stop()

    expect(received).to.have.lengthOf(1)
    const msg = received[0]
    expect(msg.channel).to.equal('telegram')
    expect(msg.id).to.equal('telegram:5')
    expect(msg.text).to.equal('hello bot')
    expect(msg.from.id).to.equal('999')
    expect(msg.from.displayName).to.equal('@alice')
    expect(msg.timestamp).to.be.instanceOf(Date)
    expect(msg.timestamp.getTime()).to.equal(1_700_000_000 * 1000)
  })

  it('advances the offset cursor past the highest update id', async () => {
    const ch = build()
    const drained = client.queueBatch([
      {
        update_id: 42,
        message: {
          message_id: 1,
          from: { id: 111 },
          chat: { id: 999, type: 'private' },
          date: 1_700_000_000,
          text: 'hi',
        },
      },
    ])
    await ch.start()
    await drained
    await new Promise(resolve => setTimeout(resolve, 30))
    await ch.stop()

    // First call had no offset, subsequent calls must use offset 43.
    const calls = client.getUpdatesCalls
    expect(calls[0].offset).to.be.undefined
    const post = calls.slice(1)
    expect(post.length).to.be.greaterThan(0)
    for (const c of post) {
      expect(c.offset).to.equal(43)
    }
  })

  it('drops messages from users not on the allowlist', async () => {
    const ch = build(['111']) // only 111 is allowed
    const drained = client.queueBatch([
      {
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 222 },
          chat: { id: 999, type: 'private' },
          date: 1_700_000_000,
          text: 'please ignore me',
        },
      },
    ])
    await ch.start()
    await drained
    await new Promise(resolve => setTimeout(resolve, 30))
    await ch.stop()

    expect(received).to.have.lengthOf(0)
  })

  it('drops updates without text (MVP is text-only)', async () => {
    const ch = build()
    const drained = client.queueBatch([
      {
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 111 },
          chat: { id: 999, type: 'private' },
          date: 1_700_000_000,
          // no text
        },
      },
    ])
    await ch.start()
    await drained
    await new Promise(resolve => setTimeout(resolve, 30))
    await ch.stop()

    expect(received).to.have.lengthOf(0)
  })

  it('sendMessage forwards to the injected client', async () => {
    const ch = build()
    await ch.sendMessage({ channel: 'telegram', id: '999' }, 'pong')
    expect(client.sentMessages).to.have.lengthOf(1)
    expect(client.sentMessages[0]).to.deep.equal({ chatId: '999', text: 'pong' })
  })

  it('sendMessage refuses to send to a foreign channel address', async () => {
    const ch = build()
    let err: unknown = null
    try {
      await ch.sendMessage({ channel: 'slack', id: '999' }, 'nope')
    } catch (e) {
      err = e
    }
    expect(err).to.be.instanceOf(Error)
    expect((err as Error).message).to.match(/cannot send/)
  })

  it('recovers from a getUpdates error via backoff + retry', async () => {
    const errors: string[] = []
    channel = new TelegramChannel({
      config: { token: 'fake-token', allowlist: ['111'], pollIntervalMs: 1 },
      client,
      logger: { error: msg => errors.push(msg) },
      errorBackoffMs: 50, // keep the test fast
    })
    channel.onMessage(async msg => {
      received.push(msg)
    })

    client.throwOnNext()
    const drained = client.queueBatch([
      {
        update_id: 7,
        message: {
          message_id: 1,
          from: { id: 111 },
          chat: { id: 999, type: 'private' },
          date: 1_700_000_000,
          text: 'after recovery',
        },
      },
    ])

    await channel.start()
    await drained
    // Give the 50ms backoff + poll a beat.
    await new Promise(resolve => setTimeout(resolve, 300))
    await channel.stop()

    expect(errors.some(e => e.includes('poll loop error'))).to.equal(true)
    expect(received.map(m => m.text)).to.include('after recovery')
  })
})
