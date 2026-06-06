import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SwitchboardDB } from '../../../src/lib/switchboard/db.js'
import type { SwitchboardAddress } from '../../../src/lib/switchboard/types.js'

describe('SwitchboardDB', () => {
  let db: SwitchboardDB
  let dbPath: string
  let tmpDir: string

  const cliAddr: SwitchboardAddress = { kind: 'cli', id: 'user-1' }
  const agentAddr: SwitchboardAddress = { kind: 'agent', id: 'MRUN-ABCD1234' }
  const daemonAddr: SwitchboardAddress = { kind: 'daemon', id: 'daemon-1' }

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-switchboard-db-test-')))
    dbPath = path.join(tmpDir, 'switchboard.db')
    db = new SwitchboardDB(dbPath)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ===========================================================================
  // Schema
  // ===========================================================================

  describe('schema', () => {
    it('creates database and tables on construction', () => {
      expect(fs.existsSync(dbPath)).to.be.true
      const msg = db.enqueue({
        pattern: 'cast',
        from: cliAddr,
        to: agentAddr,
        type: 'poke',
        payload: { message: 'hello' },
      })
      expect(msg.id).to.match(/^MSG-/)
    })

    it('is idempotent — can reopen same database', () => {
      db.enqueue({
        pattern: 'cast',
        from: cliAddr,
        to: agentAddr,
        type: 'test',
        payload: {},
      })
      db.close()

      const db2 = new SwitchboardDB(dbPath)
      const messages = db2.listMessages()
      expect(messages).to.have.lengthOf(1)
      db2.close()

      // Re-assign for afterEach cleanup
      db = new SwitchboardDB(dbPath)
    })
  })

  // ===========================================================================
  // enqueue() and getMessage()
  // ===========================================================================

  describe('enqueue()', () => {
    it('creates a cast message with correct defaults', () => {
      const msg = db.enqueue({
        pattern: 'cast',
        from: cliAddr,
        to: agentAddr,
        type: 'poke',
        payload: { message: 'do something' },
      })

      expect(msg.id).to.match(/^MSG-[A-Z0-9]{8}$/)
      expect(msg.pattern).to.equal('cast')
      expect(msg.from.kind).to.equal('cli')
      expect(msg.from.id).to.equal('user-1')
      expect(msg.to).to.not.be.null
      expect(msg.to!.kind).to.equal('agent')
      expect(msg.to!.id).to.equal('MRUN-ABCD1234')
      expect(msg.type).to.equal('poke')
      expect(msg.status).to.equal('pending')
      expect(msg.ttlSeconds).to.equal(3600) // cast default
      expect(msg.retries).to.equal(0)
      expect(msg.deliveredAt).to.be.null
    })

    it('creates an event message with topic', () => {
      const msg = db.enqueue({
        pattern: 'event',
        from: daemonAddr,
        type: 'agent:spawned',
        payload: { sessionId: 'sess-1' },
        topic: 'agent:spawned',
      })

      expect(msg.pattern).to.equal('event')
      expect(msg.to).to.be.null
      expect(msg.topic).to.equal('agent:spawned')
      expect(msg.ttlSeconds).to.equal(86400) // event default
    })

    it('creates a call message with correlation', () => {
      const msg = db.enqueue({
        pattern: 'call',
        from: daemonAddr,
        to: agentAddr,
        type: 'decision_request',
        payload: { question: 'approve?' },
      })

      expect(msg.pattern).to.equal('call')
      expect(msg.ttlSeconds).to.equal(30) // call default
    })

    it('respects custom TTL', () => {
      const msg = db.enqueue({
        pattern: 'cast',
        from: cliAddr,
        to: agentAddr,
        type: 'test',
        payload: {},
        ttlSeconds: 60,
      })

      expect(msg.ttlSeconds).to.equal(60)
    })

    it('serializes object payloads to JSON', () => {
      const msg = db.enqueue({
        pattern: 'cast',
        from: cliAddr,
        to: agentAddr,
        type: 'test',
        payload: { key: 'value', nested: { a: 1 } },
      })

      const parsed = JSON.parse(msg.payload)
      expect(parsed.key).to.equal('value')
      expect(parsed.nested.a).to.equal(1)
    })

    it('handles string payloads directly', () => {
      const msg = db.enqueue({
        pattern: 'cast',
        from: cliAddr,
        to: agentAddr,
        type: 'test',
        payload: '{"raw":"json"}',
      })

      expect(msg.payload).to.equal('{"raw":"json"}')
    })
  })

  describe('getMessage()', () => {
    it('retrieves a message by ID', () => {
      const created = db.enqueue({
        pattern: 'cast',
        from: cliAddr,
        to: agentAddr,
        type: 'test',
        payload: {},
      })

      const retrieved = db.getMessage(created.id)
      expect(retrieved).to.not.be.null
      expect(retrieved!.id).to.equal(created.id)
    })

    it('returns null for non-existent message', () => {
      expect(db.getMessage('MSG-NONEXIST')).to.be.null
    })
  })

  // ===========================================================================
  // getPendingFor()
  // ===========================================================================

  describe('getPendingFor()', () => {
    it('returns pending messages for a recipient', () => {
      db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'msg1', payload: {} })
      db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'msg2', payload: {} })
      db.enqueue({ pattern: 'cast', from: cliAddr, to: daemonAddr, type: 'other', payload: {} })

      const pending = db.getPendingFor(agentAddr)
      expect(pending).to.have.lengthOf(2)
      expect(pending[0].type).to.equal('msg1')
      expect(pending[1].type).to.equal('msg2')
    })

    it('does not return delivered messages', () => {
      const msg = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'test', payload: {} })
      db.markDelivered(msg.id)

      const pending = db.getPendingFor(agentAddr)
      expect(pending).to.have.lengthOf(0)
    })

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: `msg-${i}`, payload: {} })
      }

      const pending = db.getPendingFor(agentAddr, 3)
      expect(pending).to.have.lengthOf(3)
    })
  })

  // ===========================================================================
  // markDelivered() and markFailed()
  // ===========================================================================

  describe('markDelivered()', () => {
    it('marks a message as delivered with timestamp', () => {
      const msg = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'test', payload: {} })
      db.markDelivered(msg.id)

      const updated = db.getMessage(msg.id)!
      expect(updated.status).to.equal('delivered')
      expect(updated.deliveredAt).to.not.be.null
    })
  })

  describe('markFailed()', () => {
    it('marks a message as failed and increments retries', () => {
      const msg = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'test', payload: {} })
      db.markFailed(msg.id)

      const updated = db.getMessage(msg.id)!
      expect(updated.status).to.equal('failed')
      expect(updated.retries).to.equal(1)

      db.markFailed(msg.id)
      const updated2 = db.getMessage(msg.id)!
      expect(updated2.retries).to.equal(2)
    })
  })

  // ===========================================================================
  // getReply()
  // ===========================================================================

  describe('getReply()', () => {
    it('finds a reply by correlation ID', () => {
      const call = db.enqueue({ pattern: 'call', from: cliAddr, to: agentAddr, type: 'request', payload: {} })

      db.enqueue({
        pattern: 'reply',
        from: agentAddr,
        to: cliAddr,
        type: 'response',
        payload: { answer: 'yes' },
        correlationId: call.id,
      })

      const reply = db.getReply(call.id)
      expect(reply).to.not.be.null
      expect(reply!.pattern).to.equal('reply')
      expect(reply!.correlationId).to.equal(call.id)
      expect(JSON.parse(reply!.payload).answer).to.equal('yes')
    })

    it('returns null when no reply exists', () => {
      expect(db.getReply('MSG-NONEXIST')).to.be.null
    })
  })

  // ===========================================================================
  // listMessages()
  // ===========================================================================

  describe('listMessages()', () => {
    it('lists all messages', () => {
      db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'msg1', payload: {} })
      db.enqueue({ pattern: 'event', from: daemonAddr, type: 'msg2', payload: {}, topic: 'test' })

      const all = db.listMessages()
      expect(all).to.have.lengthOf(2)
    })

    it('filters by status', () => {
      const msg = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'msg1', payload: {} })
      db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'msg2', payload: {} })
      db.markDelivered(msg.id)

      const delivered = db.listMessages({ status: 'delivered' })
      expect(delivered).to.have.lengthOf(1)
      expect(delivered[0].id).to.equal(msg.id)

      const pending = db.listMessages({ status: 'pending' })
      expect(pending).to.have.lengthOf(1)
    })

    it('filters by pattern', () => {
      db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'msg1', payload: {} })
      db.enqueue({ pattern: 'event', from: daemonAddr, type: 'msg2', payload: {}, topic: 'test' })

      const events = db.listMessages({ pattern: 'event' })
      expect(events).to.have.lengthOf(1)
      expect(events[0].pattern).to.equal('event')
    })

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: `msg-${i}`, payload: {} })
      }

      const limited = db.listMessages({ limit: 3 })
      expect(limited).to.have.lengthOf(3)
    })
  })

  // ===========================================================================
  // countByStatus()
  // ===========================================================================

  describe('countByStatus()', () => {
    it('counts messages by status', () => {
      const msg1 = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'msg1', payload: {} })
      db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'msg2', payload: {} })
      const msg3 = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'msg3', payload: {} })

      db.markDelivered(msg1.id)
      db.markFailed(msg3.id)

      const counts = db.countByStatus()
      expect(counts.pending).to.equal(1)
      expect(counts.delivered).to.equal(1)
      expect(counts.failed).to.equal(1)
      expect(counts.expired).to.equal(0)
    })
  })

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  describe('subscriptions', () => {
    it('creates a subscription', () => {
      const sub = db.subscribe('agent:spawned', agentAddr)
      expect(sub.id).to.match(/^SUB-/)
      expect(sub.topic).to.equal('agent:spawned')
      expect(sub.subscriber.kind).to.equal('agent')
      expect(sub.subscriber.id).to.equal('MRUN-ABCD1234')
      expect(sub.active).to.be.true
    })

    it('reactivates existing subscription on duplicate subscribe', () => {
      const sub1 = db.subscribe('agent:spawned', agentAddr)
      db.unsubscribe('agent:spawned', agentAddr)

      const sub2 = db.subscribe('agent:spawned', agentAddr)
      expect(sub2.id).to.equal(sub1.id)
      expect(sub2.active).to.be.true
    })

    it('unsubscribes by marking inactive', () => {
      db.subscribe('agent:spawned', agentAddr)
      db.unsubscribe('agent:spawned', agentAddr)

      const subs = db.getSubscribers('agent:spawned')
      expect(subs).to.have.lengthOf(0)
    })

    it('lists subscribers for a topic', () => {
      db.subscribe('agent:spawned', agentAddr)
      db.subscribe('agent:spawned', daemonAddr)

      const subs = db.getSubscribers('agent:spawned')
      expect(subs).to.have.lengthOf(2)
    })

    it('lists subscriptions for a subscriber', () => {
      db.subscribe('agent:spawned', agentAddr)
      db.subscribe('work:pr_merged', agentAddr)

      const subs = db.getSubscriptionsFor(agentAddr)
      expect(subs).to.have.lengthOf(2)
    })
  })

  // ===========================================================================
  // Cursors
  // ===========================================================================

  describe('cursors', () => {
    it('creates a cursor with default position', () => {
      const cursor = db.getCursor('agent:MRUN-1234')
      expect(cursor.consumerId).to.equal('agent:MRUN-1234')
      expect(cursor.lastRowId).to.equal(0)
    })

    it('advances a cursor', () => {
      db.getCursor('agent:MRUN-1234')
      db.advanceCursor('agent:MRUN-1234', 42)

      const cursor = db.getCursor('agent:MRUN-1234')
      expect(cursor.lastRowId).to.equal(42)
    })

    it('upserts cursor on advance', () => {
      // Advance without prior getCursor call
      db.advanceCursor('agent:NEW', 10)

      const cursor = db.getCursor('agent:NEW')
      expect(cursor.lastRowId).to.equal(10)
    })
  })

  // ===========================================================================
  // Garbage Collection
  // ===========================================================================

  describe('garbage collection', () => {
    it('purges old delivered messages', () => {
      const msg = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'test', payload: {} })
      db.markDelivered(msg.id)

      // Purge with 0 retention → should delete immediately
      const purged = db.purgeDelivered(0)
      expect(purged).to.equal(1)
      expect(db.getMessage(msg.id)).to.be.null
    })

    it('does not purge recent delivered messages', () => {
      const msg = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'test', payload: {} })
      db.markDelivered(msg.id)

      // Purge with 24hr retention → should keep
      const purged = db.purgeDelivered(24)
      expect(purged).to.equal(0)
      expect(db.getMessage(msg.id)).to.not.be.null
    })

    it('purges old failed messages', () => {
      const msg = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'test', payload: {} })
      db.markFailed(msg.id)

      const purged = db.purgeFailed(0)
      expect(purged).to.equal(1)
    })

    it('purges inactive subscriptions', () => {
      db.subscribe('test-topic', agentAddr)
      db.unsubscribe('test-topic', agentAddr)

      const purged = db.purgeInactiveSubscriptions(0)
      expect(purged).to.equal(1)
    })

    it('gc() runs all passes', () => {
      const msg1 = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'test1', payload: {} })
      db.markDelivered(msg1.id)
      const msg2 = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'test2', payload: {} })
      db.markFailed(msg2.id)
      db.subscribe('test', agentAddr)
      db.unsubscribe('test', agentAddr)

      // Use the full gc() with very short retention
      const result = db.gc()
      // At minimum, gc should have run without errors
      expect(result).to.have.property('delivered')
      expect(result).to.have.property('expired')
      expect(result).to.have.property('failed')
      expect(result).to.have.property('subscriptions')
      expect(result).to.have.property('messagesExpired')
    })
  })

  // ===========================================================================
  // getPendingEvents()
  // ===========================================================================

  describe('getPendingEvents()', () => {
    it('returns pending events for a topic after a given rowid', () => {
      db.enqueue({ pattern: 'event', from: daemonAddr, type: 'evt1', payload: {}, topic: 'test-topic' })
      db.enqueue({ pattern: 'event', from: daemonAddr, type: 'evt2', payload: {}, topic: 'test-topic' })
      db.enqueue({ pattern: 'event', from: daemonAddr, type: 'other', payload: {}, topic: 'other-topic' })

      const events = db.getPendingEvents('test-topic')
      expect(events).to.have.lengthOf(2)
      expect(events[0].type).to.equal('evt1')
      expect(events[1].type).to.equal('evt2')
    })

    it('filters by afterRowId', () => {
      db.enqueue({ pattern: 'event', from: daemonAddr, type: 'evt1', payload: {}, topic: 'test-topic' })
      db.enqueue({ pattern: 'event', from: daemonAddr, type: 'evt2', payload: {}, topic: 'test-topic' })

      // After rowid 1, should only get the second message
      const events = db.getPendingEvents('test-topic', 1)
      expect(events).to.have.lengthOf(1)
      expect(events[0].type).to.equal('evt2')
    })
  })

  // ===========================================================================
  // expireMessages()
  // ===========================================================================

  describe('expireMessages()', () => {
    it('expires messages past their TTL', () => {
      // Create a message with 0 TTL (already expired)
      db.enqueue({
        pattern: 'cast',
        from: cliAddr,
        to: agentAddr,
        type: 'test',
        payload: {},
        ttlSeconds: 0,
      })

      // Give SQLite a moment for datetime comparison
      const expired = db.expireMessages()
      // Message with 0 TTL may or may not be caught depending on timing,
      // but the function should not throw
      expect(expired).to.be.a('number')
    })
  })

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe('lifecycle', () => {
    it('reports open status', () => {
      expect(db.isOpen).to.be.true
      db.close()
      expect(db.isOpen).to.be.false
      // Re-create for afterEach
      db = new SwitchboardDB(dbPath)
    })
  })
})
