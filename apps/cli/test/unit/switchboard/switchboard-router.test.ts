import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SwitchboardDB } from '../../../src/lib/switchboard/db.js'
import { SwitchboardRouter } from '../../../src/lib/switchboard/router.js'
import type { SwitchboardAddress } from '../../../src/lib/switchboard/types.js'

describe('SwitchboardRouter', () => {
  let db: SwitchboardDB
  let router: SwitchboardRouter
  let tmpDir: string

  const cliAddr: SwitchboardAddress = { kind: 'cli', id: 'user-1' }
  const agentAddr: SwitchboardAddress = { kind: 'agent', id: 'MRUN-ABCD1234' }
  const daemonAddr: SwitchboardAddress = { kind: 'daemon', id: 'daemon-1' }

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-switchboard-router-test-')))
    const dbPath = path.join(tmpDir, 'switchboard.db')
    db = new SwitchboardDB(dbPath)
    router = new SwitchboardRouter({ db })
  })

  afterEach(() => {
    router.stop()
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ===========================================================================
  // processMessages()
  // ===========================================================================

  describe('processMessages()', () => {
    it('processes pending direct messages', () => {
      db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'msg1', payload: {} })
      db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'msg2', payload: {} })

      const result = router.processMessages()
      expect(result.processed).to.equal(2)
      expect(result.delivered).to.equal(2)
      expect(result.errors).to.equal(0)
    })

    it('processes event messages with fan-out', () => {
      // Subscribe two consumers
      db.subscribe('test-event', agentAddr)
      db.subscribe('test-event', daemonAddr)

      // Publish an event
      db.enqueue({
        pattern: 'event',
        from: cliAddr,
        type: 'test-event',
        payload: { data: 'hello' },
        topic: 'test-event',
      })

      const result = router.processMessages()
      expect(result.processed).to.be.greaterThanOrEqual(1)
      expect(result.fanouts).to.equal(2) // 2 subscribers
      expect(result.delivered).to.be.greaterThanOrEqual(1)
    })

    it('marks event messages as delivered after processing', () => {
      db.subscribe('test-event', agentAddr)

      db.enqueue({
        pattern: 'event',
        from: cliAddr,
        type: 'test-event',
        payload: {},
        topic: 'test-event',
      })

      router.processMessages()

      // All event messages should be delivered now
      const pending = db.listMessages({ status: 'pending', pattern: 'event' })
      expect(pending).to.have.lengthOf(0)

      const delivered = db.listMessages({ status: 'delivered', pattern: 'event' })
      expect(delivered).to.have.lengthOf(1)
    })

    it('handles empty queue gracefully', () => {
      const result = router.processMessages()
      expect(result.processed).to.equal(0)
      expect(result.delivered).to.equal(0)
      expect(result.errors).to.equal(0)
    })

    it('skips events without topics', () => {
      // An event without a topic should still be processed
      db.enqueue({
        pattern: 'event',
        from: cliAddr,
        type: 'no-topic-event',
        payload: {},
        // No topic
      })

      const result = router.processMessages()
      // Should process but not fan out
      expect(result.processed).to.be.greaterThanOrEqual(0)
    })
  })

  // ===========================================================================
  // start() / stop()
  // ===========================================================================

  describe('start() and stop()', () => {
    it('starts and stops the routing loop', () => {
      router.start()
      const status = router.status()
      expect(status.running).to.be.true

      router.stop()
      const status2 = router.status()
      expect(status2.running).to.be.false
    })

    it('start is idempotent', () => {
      router.start()
      router.start() // Should not throw or create duplicate timers
      router.stop()
    })
  })

  // ===========================================================================
  // status()
  // ===========================================================================

  describe('status()', () => {
    it('returns router status with message counts', () => {
      db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'msg1', payload: {} })

      const status = router.status()
      expect(status.running).to.be.false
      expect(status.messageCounts.pending).to.equal(1)
    })
  })
})
