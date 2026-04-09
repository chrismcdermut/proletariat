import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { MachineDB } from '../../src/lib/machine-db.js'
import { MessagingGateway, type SessionPoker } from '../../src/lib/gateway/router.js'
import type {
  ChannelAddress,
  Message,
  MessageHandler,
  MessagingChannel,
} from '../../src/lib/gateway/types.js'

/**
 * PRLT-1255 — Router-level tests for the MessagingGateway. These exercise
 * routing without a real Telegram connection: we feed messages into the
 * router through a FakeChannel and assert on the resulting DB state,
 * poke calls, and replies.
 */

// =============================================================================
// Test doubles
// =============================================================================

class FakeChannel implements MessagingChannel {
  readonly name: string
  started = false
  stopped = false
  sent: Array<{ to: ChannelAddress; text: string }> = []
  private handler: MessageHandler | null = null
  private sendImpl: ((to: ChannelAddress, text: string) => Promise<void>) | null = null

  constructor(name: string = 'fake') {
    this.name = name
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler
  }

  async start(): Promise<void> {
    this.started = true
  }

  async stop(): Promise<void> {
    this.stopped = true
  }

  async sendMessage(to: ChannelAddress, text: string): Promise<void> {
    if (this.sendImpl) {
      await this.sendImpl(to, text)
    }
    this.sent.push({ to, text })
  }

  /** Simulate a user sending a message to the bot. */
  async inject(msg: Message): Promise<void> {
    if (!this.handler) throw new Error('FakeChannel has no handler — router not registered?')
    await this.handler(msg)
  }

  /** Force sendMessage to throw on the next call. */
  failNextSendWith(err: Error): void {
    let thrown = false
    this.sendImpl = async () => {
      if (!thrown) {
        thrown = true
        throw err
      }
    }
  }
}

class FakePoker implements SessionPoker {
  calls: Array<{ agent: string; message: string; waitTimeoutSec?: number }> = []
  private responder: (agent: string, message: string) => Promise<string | null> =
    async () => 'ack'

  async poke(
    agent: string,
    message: string,
    options?: { waitTimeoutSec?: number },
  ): Promise<string | null> {
    this.calls.push({ agent, message, waitTimeoutSec: options?.waitTimeoutSec })
    return this.responder(agent, message)
  }

  respondWith(fn: (agent: string, message: string) => Promise<string | null>): void {
    this.responder = fn
  }
}

// =============================================================================
// Fixtures
// =============================================================================

function sampleMessage(partial: Partial<Message> = {}): Message {
  return {
    id: 'telegram:1',
    channel: 'fake',
    from: { channel: 'fake', id: '42', displayName: 'tester' },
    text: 'hello agent',
    timestamp: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('MessagingGateway (PRLT-1255)', () => {
  let db: MachineDB
  let dbPath: string
  let tmpDir: string
  let channel: FakeChannel
  let poker: FakePoker

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-gateway-router-test-')))
    dbPath = path.join(tmpDir, 'machine.db')
    db = new MachineDB(dbPath)
    channel = new FakeChannel('fake')
    poker = new FakePoker()
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeGateway(
    resolveAgentForNewUser: (msg: Message) => string | null = () => 'altman',
  ): MessagingGateway {
    return new MessagingGateway({
      db,
      sessionPoker: poker,
      resolveAgentForNewUser,
    })
  }

  // ---------------------------------------------------------------------------
  // Registration + lifecycle
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('registerChannel wires the onMessage handler', () => {
      const gw = makeGateway()
      gw.registerChannel(channel)
      expect(gw.listChannelNames()).to.deep.equal(['fake'])
    })

    it('rejects duplicate channel registration', () => {
      const gw = makeGateway()
      gw.registerChannel(channel)
      expect(() => gw.registerChannel(new FakeChannel('fake'))).to.throw(
        /already registered/,
      )
    })

    it('start() and stop() fan out to every channel', async () => {
      const gw = makeGateway()
      const a = new FakeChannel('a')
      const b = new FakeChannel('b')
      gw.registerChannel(a)
      gw.registerChannel(b)

      await gw.start()
      expect(a.started).to.equal(true)
      expect(b.started).to.equal(true)

      await gw.stop()
      expect(a.stopped).to.equal(true)
      expect(b.stopped).to.equal(true)
    })

    it('start() is idempotent', async () => {
      const gw = makeGateway()
      gw.registerChannel(channel)
      await gw.start()
      channel.started = false
      await gw.start() // no-op
      expect(channel.started).to.equal(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Routing a new user
  // ---------------------------------------------------------------------------

  describe('new user routing', () => {
    it('creates a route on first message and pokes the agent', async () => {
      const gw = makeGateway(() => 'altman')
      gw.registerChannel(channel)

      await channel.inject(sampleMessage())

      expect(poker.calls).to.have.lengthOf(1)
      expect(poker.calls[0].agent).to.equal('altman')
      expect(poker.calls[0].message).to.equal('hello agent')

      const route = db.getMessagingRoute('fake', '42')
      expect(route).to.not.be.null
      expect(route!.agentSessionId).to.equal('altman')
    })

    it('forwards the captured response back through the channel', async () => {
      poker.respondWith(async () => 'here is your tests output')
      const gw = makeGateway()
      gw.registerChannel(channel)

      await channel.inject(sampleMessage())

      expect(channel.sent).to.have.lengthOf(1)
      expect(channel.sent[0].to.id).to.equal('42')
      expect(channel.sent[0].text).to.equal('here is your tests output')
    })

    it('does not send an outbound message when the agent returns null', async () => {
      poker.respondWith(async () => null)
      const gw = makeGateway()
      gw.registerChannel(channel)

      await channel.inject(sampleMessage())
      expect(channel.sent).to.have.lengthOf(0)
    })

    it('drops messages for unresolved users without calling the poker', async () => {
      const gw = makeGateway(() => null)
      gw.registerChannel(channel)

      await channel.inject(sampleMessage())

      expect(poker.calls).to.have.lengthOf(0)
      expect(channel.sent).to.have.lengthOf(0)
      expect(db.getMessagingRoute('fake', '42')).to.be.null
    })

    it('drops empty text messages before consulting the poker', async () => {
      const gw = makeGateway()
      gw.registerChannel(channel)

      await channel.inject(sampleMessage({ text: '   ' }))
      expect(poker.calls).to.have.lengthOf(0)

      await channel.inject(sampleMessage({ text: undefined }))
      expect(poker.calls).to.have.lengthOf(0)
    })

    it('logs and ignores messages from unknown channels', async () => {
      const errors: string[] = []
      const gw = new MessagingGateway({
        db,
        sessionPoker: poker,
        resolveAgentForNewUser: () => 'altman',
        logger: { error: msg => errors.push(msg) },
      })
      // Do NOT register the channel — routeInbound should log and return.
      await gw.routeInbound(sampleMessage({ channel: 'ghost' }))

      expect(poker.calls).to.have.lengthOf(0)
      expect(errors.some(e => e.includes('no channel registered'))).to.equal(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Routing an existing user
  // ---------------------------------------------------------------------------

  describe('existing user routing', () => {
    it('reuses an existing route and bypasses resolveAgentForNewUser', async () => {
      db.upsertMessagingRoute({ channel: 'fake', userId: '42', agentSessionId: 'preset' })

      let resolverCalls = 0
      const gw = makeGateway(() => {
        resolverCalls++
        return 'should-not-be-used'
      })
      gw.registerChannel(channel)

      await channel.inject(sampleMessage())

      expect(resolverCalls).to.equal(0)
      expect(poker.calls[0].agent).to.equal('preset')
    })

    it('updates last_used_at on the route and last_message_at on the channel', async () => {
      db.upsertMessagingChannel({ name: 'fake', type: 'telegram', configJson: '{}' })
      db.upsertMessagingRoute({ channel: 'fake', userId: '42', agentSessionId: 'preset' })

      const gw = makeGateway()
      gw.registerChannel(channel)

      await channel.inject(sampleMessage())

      expect(db.getMessagingRoute('fake', '42')!.lastUsedAt).to.be.instanceOf(Date)
      expect(db.getMessagingChannel('fake')!.lastMessageAt).to.be.instanceOf(Date)
    })
  })

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe('error handling', () => {
    it('sends a friendly error reply when the poker throws', async () => {
      poker.respondWith(async () => {
        throw new Error('session dead')
      })

      const gw = makeGateway()
      gw.registerChannel(channel)

      await channel.inject(sampleMessage())

      expect(channel.sent).to.have.lengthOf(1)
      expect(channel.sent[0].text).to.match(/couldn't reach/i)
    })

    it('swallows channel.sendMessage errors so they do not escape routeInbound', async () => {
      poker.respondWith(async () => 'ok')
      const gw = makeGateway()
      gw.registerChannel(channel)

      channel.failNextSendWith(new Error('telegram 500'))

      // Must not throw.
      await channel.inject(sampleMessage())
    })

    it('passes the waitTimeoutSec through to the poker', async () => {
      const gw = new MessagingGateway({
        db,
        sessionPoker: poker,
        resolveAgentForNewUser: () => 'altman',
        waitTimeoutSec: 33,
      })
      gw.registerChannel(channel)

      await channel.inject(sampleMessage())
      expect(poker.calls[0].waitTimeoutSec).to.equal(33)
    })
  })
})
