import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SwitchboardClient } from '../../../src/lib/switchboard/client.js'
import { SwitchboardDB } from '../../../src/lib/switchboard/db.js'
import type { SwitchboardAddress } from '../../../src/lib/switchboard/types.js'

describe('SwitchboardClient', () => {
  let tmpDir: string
  let dbPath: string
  let socketPath: string

  const cliAddr: SwitchboardAddress = { kind: 'cli', id: 'user-1' }
  const agentAddr: SwitchboardAddress = { kind: 'agent', id: 'MRUN-ABCD1234' }
  const daemonAddr: SwitchboardAddress = { kind: 'daemon', id: 'daemon-1' }

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-switchboard-client-test-')))
    dbPath = path.join(tmpDir, 'switchboard.db')
    socketPath = path.join(tmpDir, 'switchboard.sock')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createClient(address: SwitchboardAddress): SwitchboardClient {
    return new SwitchboardClient({
      address,
      dbPath,
      socketPath,
      pollIntervalMs: 50,
    })
  }

  // ===========================================================================
  // cast()
  // ===========================================================================

  describe('cast()', () => {
    it('sends a fire-and-forget message', () => {
      const client = createClient(cliAddr)

      const msg = client.cast({
        from: cliAddr,
        to: agentAddr,
        type: 'poke',
        payload: { message: 'do something' },
      })

      expect(msg.id).to.match(/^MSG-/)
      expect(msg.pattern).to.equal('cast')
      expect(msg.from.kind).to.equal('cli')
      expect(msg.to!.kind).to.equal('agent')
      expect(msg.type).to.equal('poke')
      expect(msg.status).to.equal('pending')

      client.close()
    })

    it('uses client address as default sender', () => {
      const client = createClient(cliAddr)

      const msg = client.cast({
        from: cliAddr,
        to: agentAddr,
        type: 'test',
        payload: {},
      })

      expect(msg.from.kind).to.equal('cli')
      expect(msg.from.id).to.equal('user-1')

      client.close()
    })
  })

  // ===========================================================================
  // reply()
  // ===========================================================================

  describe('reply()', () => {
    it('sends a reply to a call', () => {
      const sender = createClient(cliAddr)
      const receiver = createClient(agentAddr)

      const call = sender.cast({
        from: cliAddr,
        to: agentAddr,
        type: 'request',
        payload: {},
      })

      const reply = receiver.reply(call.id, cliAddr, 'response', { answer: 'yes' })

      expect(reply.pattern).to.equal('reply')
      expect(reply.correlationId).to.equal(call.id)
      expect(reply.to!.kind).to.equal('cli')
      expect(JSON.parse(reply.payload).answer).to.equal('yes')

      sender.close()
      receiver.close()
    })
  })

  // ===========================================================================
  // publish()
  // ===========================================================================

  describe('publish()', () => {
    it('publishes an event to a topic', () => {
      const client = createClient(daemonAddr)

      const msg = client.publish('agent:spawned', 'agent:spawned', { sessionId: 'sess-1' })

      expect(msg.pattern).to.equal('event')
      expect(msg.topic).to.equal('agent:spawned')
      expect(msg.to).to.be.null

      client.close()
    })
  })

  // ===========================================================================
  // poll()
  // ===========================================================================

  describe('poll()', () => {
    it('retrieves and marks pending messages as delivered', () => {
      const sender = createClient(cliAddr)
      const receiver = createClient(agentAddr)

      sender.cast({ from: cliAddr, to: agentAddr, type: 'msg1', payload: {} })
      sender.cast({ from: cliAddr, to: agentAddr, type: 'msg2', payload: {} })

      const messages = receiver.poll()
      expect(messages).to.have.lengthOf(2)
      expect(messages[0].type).to.equal('msg1')
      expect(messages[1].type).to.equal('msg2')

      // Second poll should return empty (already delivered)
      const second = receiver.poll()
      expect(second).to.have.lengthOf(0)

      sender.close()
      receiver.close()
    })

    it('does not return messages for other recipients', () => {
      const sender = createClient(cliAddr)
      const receiver = createClient(agentAddr)

      sender.cast({ from: cliAddr, to: daemonAddr, type: 'for-daemon', payload: {} })

      const messages = receiver.poll()
      expect(messages).to.have.lengthOf(0)

      sender.close()
      receiver.close()
    })
  })

  // ===========================================================================
  // subscribe() / unsubscribe()
  // ===========================================================================

  describe('subscribe() and unsubscribe()', () => {
    it('subscribes to a topic', () => {
      const client = createClient(agentAddr)

      const sub = client.subscribe('agent:spawned')
      expect(sub.topic).to.equal('agent:spawned')
      expect(sub.active).to.be.true

      client.close()
    })

    it('lists subscriptions', () => {
      const client = createClient(agentAddr)

      client.subscribe('agent:spawned')
      client.subscribe('work:pr_merged')

      const subs = client.listSubscriptions()
      expect(subs).to.have.lengthOf(2)

      client.close()
    })

    it('unsubscribes from a topic', () => {
      const client = createClient(agentAddr)

      client.subscribe('agent:spawned')
      client.unsubscribe('agent:spawned')

      const subs = client.listSubscriptions()
      expect(subs).to.have.lengthOf(0)

      client.close()
    })
  })

  // ===========================================================================
  // status()
  // ===========================================================================

  describe('status()', () => {
    it('returns client status', () => {
      const client = createClient(agentAddr)

      client.subscribe('test-topic')

      const status = client.status()
      expect(status.address.kind).to.equal('agent')
      expect(status.address.id).to.equal('MRUN-ABCD1234')
      expect(status.connected).to.be.false // No server running
      expect(status.messageCounts).to.have.property('pending')
      expect(status.subscriptionCount).to.equal(1)

      client.close()
    })
  })

  // ===========================================================================
  // call() — request/reply
  // ===========================================================================

  describe('call()', () => {
    it('returns a reply when one is available', async () => {
      const sender = createClient(cliAddr)
      const db = new SwitchboardDB(dbPath)

      // Start the call in the background
      const callPromise = sender.call({
        from: cliAddr,
        to: agentAddr,
        type: 'decision_request',
        payload: { question: 'approve?' },
        timeoutMs: 2000,
      })

      // Simulate agent replying after a short delay
      await sleep(100)
      const pending = db.getPendingFor(agentAddr)
      expect(pending).to.have.lengthOf(1)

      db.enqueue({
        pattern: 'reply',
        from: agentAddr,
        to: cliAddr,
        type: 'decision_response',
        payload: { approved: true },
        correlationId: pending[0].id,
      })

      const result = await callPromise
      expect(result.success).to.be.true
      expect(result.timedOut).to.be.false
      expect(result.reply).to.not.be.null
      expect(JSON.parse(result.reply!.payload).approved).to.be.true

      sender.close()
      db.close()
    })

    it('times out when no reply arrives', async () => {
      const sender = createClient(cliAddr)

      const result = await sender.call({
        from: cliAddr,
        to: agentAddr,
        type: 'test',
        payload: {},
        timeoutMs: 200,
      })

      expect(result.success).to.be.false
      expect(result.timedOut).to.be.true
      expect(result.reply).to.be.null

      sender.close()
    })
  })

  // ===========================================================================
  // Polling loop
  // ===========================================================================

  describe('polling loop', () => {
    it('starts and stops without errors', () => {
      const client = createClient(agentAddr)

      client.startPolling()
      // Starting again is idempotent
      client.startPolling()

      client.stopPolling()

      client.close()
    })

    it('invokes onMessage callback for pending messages', async () => {
      const received: string[] = []
      const sender = createClient(cliAddr)
      const receiver = new SwitchboardClient({
        address: agentAddr,
        dbPath,
        socketPath,
        pollIntervalMs: 50,
        onMessage: (msg) => {
          received.push(msg.type)
        },
      })

      sender.cast({ from: cliAddr, to: agentAddr, type: 'hello', payload: {} })

      receiver.startPolling()
      await sleep(200)
      receiver.stopPolling()

      expect(received).to.include('hello')

      sender.close()
      receiver.close()
    })
  })

  // ===========================================================================
  // close()
  // ===========================================================================

  describe('close()', () => {
    it('stops polling and closes DB', () => {
      const client = createClient(agentAddr)
      client.startPolling()
      client.close()
      // Should not throw on double close
    })
  })
})

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
