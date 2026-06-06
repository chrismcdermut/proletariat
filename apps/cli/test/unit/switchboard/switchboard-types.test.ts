import { expect } from 'chai'
import {
  addressKey,
  DEFAULT_TTL,
  rowToMessage,
  rowToSubscription,
  rowToCursor,
  type SwitchboardAddress,
  type MessageRow,
  type SubscriptionRow,
  type CursorRow,
} from '../../../src/lib/switchboard/types.js'

describe('Switchboard Types', () => {
  // ===========================================================================
  // addressKey()
  // ===========================================================================

  describe('addressKey()', () => {
    it('serializes an address to kind:id format', () => {
      const addr: SwitchboardAddress = { kind: 'agent', id: 'MRUN-12345678' }
      expect(addressKey(addr)).to.equal('agent:MRUN-12345678')
    })

    it('ignores containerId in key', () => {
      const addr: SwitchboardAddress = { kind: 'agent', id: 'MRUN-ABCD', containerId: 'abc123' }
      expect(addressKey(addr)).to.equal('agent:MRUN-ABCD')
    })

    it('works for all address kinds', () => {
      const kinds = ['session', 'agent', 'daemon', 'orchestrator', 'gateway', 'cli', 'topic'] as const
      for (const kind of kinds) {
        const addr: SwitchboardAddress = { kind, id: 'test-id' }
        expect(addressKey(addr)).to.equal(`${kind}:test-id`)
      }
    })
  })

  // ===========================================================================
  // DEFAULT_TTL
  // ===========================================================================

  describe('DEFAULT_TTL', () => {
    it('cast has 1 hour TTL', () => {
      expect(DEFAULT_TTL.cast).to.equal(3600)
    })

    it('call has 30 second TTL', () => {
      expect(DEFAULT_TTL.call).to.equal(30)
    })

    it('reply has 5 minute TTL', () => {
      expect(DEFAULT_TTL.reply).to.equal(300)
    })

    it('event has 24 hour TTL', () => {
      expect(DEFAULT_TTL.event).to.equal(86400)
    })
  })

  // ===========================================================================
  // rowToMessage()
  // ===========================================================================

  describe('rowToMessage()', () => {
    it('converts a message row to a record', () => {
      const row: MessageRow = {
        rowid: 1,
        id: 'MSG-ABCD1234',
        pattern: 'cast',
        from_kind: 'cli',
        from_id: 'user-1',
        from_container_id: null,
        to_kind: 'agent',
        to_id: 'MRUN-1234',
        to_container_id: 'container-abc',
        correlation_id: null,
        topic: null,
        type: 'poke',
        payload: '{"message":"hello"}',
        status: 'pending',
        created_at: '2026-01-01T00:00:00.000Z',
        delivered_at: null,
        ttl_seconds: 3600,
        retries: 0,
      }

      const msg = rowToMessage(row)
      expect(msg.id).to.equal('MSG-ABCD1234')
      expect(msg.pattern).to.equal('cast')
      expect(msg.from.kind).to.equal('cli')
      expect(msg.from.id).to.equal('user-1')
      expect(msg.from.containerId).to.be.undefined
      expect(msg.to).to.not.be.null
      expect(msg.to!.kind).to.equal('agent')
      expect(msg.to!.id).to.equal('MRUN-1234')
      expect(msg.to!.containerId).to.equal('container-abc')
      expect(msg.correlationId).to.be.null
      expect(msg.topic).to.be.null
      expect(msg.type).to.equal('poke')
      expect(msg.payload).to.equal('{"message":"hello"}')
      expect(msg.status).to.equal('pending')
      expect(msg.ttlSeconds).to.equal(3600)
      expect(msg.retries).to.equal(0)
    })

    it('handles null to address', () => {
      const row: MessageRow = {
        rowid: 2,
        id: 'MSG-EFGH5678',
        pattern: 'event',
        from_kind: 'daemon',
        from_id: 'daemon-1',
        from_container_id: null,
        to_kind: null,
        to_id: null,
        to_container_id: null,
        correlation_id: null,
        topic: 'agent:spawned',
        type: 'agent:spawned',
        payload: '{}',
        status: 'pending',
        created_at: '2026-01-01T00:00:00.000Z',
        delivered_at: null,
        ttl_seconds: 86400,
        retries: 0,
      }

      const msg = rowToMessage(row)
      expect(msg.to).to.be.null
      expect(msg.topic).to.equal('agent:spawned')
    })
  })

  // ===========================================================================
  // rowToSubscription()
  // ===========================================================================

  describe('rowToSubscription()', () => {
    it('converts a subscription row to a record', () => {
      const row: SubscriptionRow = {
        id: 'SUB-ABCD1234',
        topic: 'agent:spawned',
        subscriber_kind: 'orchestrator',
        subscriber_id: 'orch-1',
        subscriber_container_id: null,
        created_at: '2026-01-01T00:00:00.000Z',
        active: 1,
      }

      const sub = rowToSubscription(row)
      expect(sub.id).to.equal('SUB-ABCD1234')
      expect(sub.topic).to.equal('agent:spawned')
      expect(sub.subscriber.kind).to.equal('orchestrator')
      expect(sub.subscriber.id).to.equal('orch-1')
      expect(sub.active).to.be.true
    })

    it('converts inactive subscription', () => {
      const row: SubscriptionRow = {
        id: 'SUB-XXXX',
        topic: 'test',
        subscriber_kind: 'agent',
        subscriber_id: 'a1',
        subscriber_container_id: null,
        created_at: '2026-01-01T00:00:00.000Z',
        active: 0,
      }

      const sub = rowToSubscription(row)
      expect(sub.active).to.be.false
    })
  })

  // ===========================================================================
  // rowToCursor()
  // ===========================================================================

  describe('rowToCursor()', () => {
    it('converts a cursor row to a record', () => {
      const row: CursorRow = {
        consumer_id: 'agent:MRUN-1234',
        last_rowid: 42,
        updated_at: '2026-01-01T00:00:00.000Z',
      }

      const cursor = rowToCursor(row)
      expect(cursor.consumerId).to.equal('agent:MRUN-1234')
      expect(cursor.lastRowId).to.equal(42)
      expect(cursor.updatedAt).to.equal('2026-01-01T00:00:00.000Z')
    })
  })
})
