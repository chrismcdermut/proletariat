import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { MachineDB } from '../../src/lib/machine-db.js'

/**
 * PRLT-1255 — Coverage for the messaging_channels and messaging_routes
 * tables added to machine.db. The gateway daemon's persistence layer
 * must survive process restarts, so every CRUD path is exercised against
 * a real sqlite file.
 */
describe('MachineDB — messaging gateway storage (PRLT-1255)', () => {
  let db: MachineDB
  let dbPath: string
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-gateway-storage-test-')))
    dbPath = path.join(tmpDir, 'machine.db')
    db = new MachineDB(dbPath)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('messaging_channels', () => {
    it('upserts a new channel and reads it back', () => {
      db.upsertMessagingChannel({
        name: 'telegram',
        type: 'telegram',
        configJson: JSON.stringify({ token: 'T', allowlist: ['1'] }),
      })

      const got = db.getMessagingChannel('telegram')
      expect(got).to.not.be.null
      expect(got!.name).to.equal('telegram')
      expect(got!.type).to.equal('telegram')
      expect(got!.active).to.equal(true)
      expect(got!.lastMessageAt).to.be.undefined
      expect(JSON.parse(got!.configJson)).to.deep.equal({ token: 'T', allowlist: ['1'] })
    })

    it('upserts an existing channel in place (idempotent connect)', () => {
      db.upsertMessagingChannel({
        name: 'telegram',
        type: 'telegram',
        configJson: JSON.stringify({ token: 'old', allowlist: ['1'] }),
      })
      db.upsertMessagingChannel({
        name: 'telegram',
        type: 'telegram',
        configJson: JSON.stringify({ token: 'new', allowlist: ['1', '2'] }),
      })

      const got = db.getMessagingChannel('telegram')
      expect(JSON.parse(got!.configJson)).to.deep.equal({ token: 'new', allowlist: ['1', '2'] })

      // Still exactly one row — not a duplicate.
      const all = db.listMessagingChannels({ onlyActive: false })
      expect(all).to.have.lengthOf(1)
    })

    it('respects the onlyActive filter in listMessagingChannels', () => {
      db.upsertMessagingChannel({ name: 'a', type: 'telegram', configJson: '{}', active: true })
      db.upsertMessagingChannel({ name: 'b', type: 'telegram', configJson: '{}', active: false })

      const active = db.listMessagingChannels({ onlyActive: true })
      expect(active.map(c => c.name)).to.deep.equal(['a'])

      const everything = db.listMessagingChannels({ onlyActive: false })
      expect(everything.map(c => c.name)).to.deep.equal(['a', 'b'])
    })

    it('defaults to onlyActive = true when options omitted', () => {
      db.upsertMessagingChannel({ name: 'on', type: 'telegram', configJson: '{}', active: true })
      db.upsertMessagingChannel({ name: 'off', type: 'telegram', configJson: '{}', active: false })

      const channels = db.listMessagingChannels()
      expect(channels.map(c => c.name)).to.deep.equal(['on'])
    })

    it('setMessagingChannelActive toggles the flag without deleting config', () => {
      db.upsertMessagingChannel({
        name: 'telegram',
        type: 'telegram',
        configJson: JSON.stringify({ token: 'T', allowlist: ['1'] }),
      })

      db.setMessagingChannelActive('telegram', false)
      const inactive = db.getMessagingChannel('telegram')
      expect(inactive!.active).to.equal(false)
      expect(JSON.parse(inactive!.configJson)).to.deep.equal({ token: 'T', allowlist: ['1'] })

      db.setMessagingChannelActive('telegram', true)
      expect(db.getMessagingChannel('telegram')!.active).to.equal(true)
    })

    it('deleteMessagingChannel removes the row', () => {
      db.upsertMessagingChannel({ name: 'telegram', type: 'telegram', configJson: '{}' })
      db.deleteMessagingChannel('telegram')
      expect(db.getMessagingChannel('telegram')).to.be.null
    })

    it('touchMessagingChannel stamps last_message_at', () => {
      db.upsertMessagingChannel({ name: 'telegram', type: 'telegram', configJson: '{}' })
      const t = 1_700_000_000_000
      db.touchMessagingChannel('telegram', t)

      const got = db.getMessagingChannel('telegram')
      expect(got!.lastMessageAt).to.be.instanceOf(Date)
      expect(got!.lastMessageAt!.getTime()).to.equal(t)
    })
  })

  describe('messaging_routes', () => {
    it('returns null for an unknown (channel, user) pair', () => {
      expect(db.getMessagingRoute('telegram', 'ghost')).to.be.null
    })

    it('upsertMessagingRoute creates a new route with a created_at stamp', () => {
      const before = Date.now()
      const route = db.upsertMessagingRoute({
        channel: 'telegram',
        userId: '111',
        agentSessionId: 'altman',
      })
      const after = Date.now()

      expect(route.channel).to.equal('telegram')
      expect(route.userId).to.equal('111')
      expect(route.agentSessionId).to.equal('altman')
      expect(route.createdAt).to.be.instanceOf(Date)
      expect(route.createdAt.getTime()).to.be.at.least(before)
      expect(route.createdAt.getTime()).to.be.at.most(after)
      expect(route.lastUsedAt).to.be.undefined
    })

    it('upsertMessagingRoute rebinds an existing user to a new agent', () => {
      db.upsertMessagingRoute({ channel: 'telegram', userId: '111', agentSessionId: 'alice' })
      db.upsertMessagingRoute({ channel: 'telegram', userId: '111', agentSessionId: 'bob' })

      const route = db.getMessagingRoute('telegram', '111')
      expect(route!.agentSessionId).to.equal('bob')

      // Exactly one route exists for this user.
      expect(db.listMessagingRoutes('telegram')).to.have.lengthOf(1)
    })

    it('primary key scopes uniqueness to (channel, user) pairs', () => {
      db.upsertMessagingRoute({ channel: 'telegram', userId: '111', agentSessionId: 'alice' })
      db.upsertMessagingRoute({ channel: 'slack', userId: '111', agentSessionId: 'bob' })

      expect(db.getMessagingRoute('telegram', '111')!.agentSessionId).to.equal('alice')
      expect(db.getMessagingRoute('slack', '111')!.agentSessionId).to.equal('bob')
    })

    it('touchMessagingRoute stamps last_used_at to the provided timestamp', () => {
      db.upsertMessagingRoute({ channel: 'telegram', userId: '111', agentSessionId: 'alice' })
      db.touchMessagingRoute('telegram', '111', 1_700_000_000_000)

      const route = db.getMessagingRoute('telegram', '111')
      expect(route!.lastUsedAt).to.be.instanceOf(Date)
      expect(route!.lastUsedAt!.getTime()).to.equal(1_700_000_000_000)
    })

    it('listMessagingRoutes optionally filters by channel', () => {
      db.upsertMessagingRoute({ channel: 'telegram', userId: '1', agentSessionId: 'a' })
      db.upsertMessagingRoute({ channel: 'telegram', userId: '2', agentSessionId: 'b' })
      db.upsertMessagingRoute({ channel: 'slack', userId: '3', agentSessionId: 'c' })

      expect(db.listMessagingRoutes('telegram')).to.have.lengthOf(2)
      expect(db.listMessagingRoutes('slack')).to.have.lengthOf(1)
      expect(db.listMessagingRoutes()).to.have.lengthOf(3)
    })

    it('countMessagingRoutesForChannel counts per-channel routes', () => {
      db.upsertMessagingRoute({ channel: 'telegram', userId: '1', agentSessionId: 'a' })
      db.upsertMessagingRoute({ channel: 'telegram', userId: '2', agentSessionId: 'b' })
      db.upsertMessagingRoute({ channel: 'slack', userId: '3', agentSessionId: 'c' })

      expect(db.countMessagingRoutesForChannel('telegram')).to.equal(2)
      expect(db.countMessagingRoutesForChannel('slack')).to.equal(1)
      expect(db.countMessagingRoutesForChannel('discord')).to.equal(0)
    })
  })

  describe('persistence', () => {
    it('survives process restarts (re-opening the same file)', () => {
      db.upsertMessagingChannel({
        name: 'telegram',
        type: 'telegram',
        configJson: JSON.stringify({ token: 'T', allowlist: ['1'] }),
      })
      db.upsertMessagingRoute({ channel: 'telegram', userId: '1', agentSessionId: 'altman' })
      db.close()

      const reopened = new MachineDB(dbPath)
      try {
        expect(reopened.getMessagingChannel('telegram')).to.not.be.null
        expect(reopened.getMessagingRoute('telegram', '1')).to.not.be.null
      } finally {
        reopened.close()
      }

      // Reassign for afterEach teardown.
      db = new MachineDB(dbPath)
    })
  })
})
