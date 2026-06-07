import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SwitchboardDB } from '../../../src/lib/switchboard/db.js'
import { SwitchboardGC } from '../../../src/lib/switchboard/gc.js'
import type { SwitchboardAddress } from '../../../src/lib/switchboard/types.js'

describe('SwitchboardGC', () => {
  let db: SwitchboardDB
  let gc: SwitchboardGC
  let tmpDir: string

  const cliAddr: SwitchboardAddress = { kind: 'cli', id: 'user-1' }
  const agentAddr: SwitchboardAddress = { kind: 'agent', id: 'MRUN-ABCD1234' }

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-switchboard-gc-test-')))
    const dbPath = path.join(tmpDir, 'switchboard.db')
    db = new SwitchboardDB(dbPath)
    gc = new SwitchboardGC({
      db,
      intervalMs: 100,
      deliveredRetentionHours: 0, // Immediate purge for testing
      failedRetentionDays: 0,
      subscriptionRetentionDays: 0,
    })
  })

  afterEach(() => {
    gc.stop()
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ===========================================================================
  // runCycle()
  // ===========================================================================

  describe('runCycle()', () => {
    it('purges delivered messages', () => {
      const msg = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'test', payload: {} })
      db.markDelivered(msg.id)

      const result = gc.runCycle()
      expect(result.deliveredPurged).to.equal(1)
      expect(db.getMessage(msg.id)).to.be.null
    })

    it('purges failed messages', () => {
      const msg = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'test', payload: {} })
      db.markFailed(msg.id)

      const result = gc.runCycle()
      expect(result.failedPurged).to.equal(1)
    })

    it('purges inactive subscriptions', () => {
      db.subscribe('test-topic', agentAddr)
      db.unsubscribe('test-topic', agentAddr)

      const result = gc.runCycle()
      expect(result.subscriptionsPurged).to.equal(1)
    })

    it('handles empty database', () => {
      const result = gc.runCycle()
      expect(result.deliveredPurged).to.equal(0)
      expect(result.failedPurged).to.equal(0)
      expect(result.subscriptionsPurged).to.equal(0)
    })

    it('returns combined results', () => {
      const msg1 = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'test1', payload: {} })
      db.markDelivered(msg1.id)

      const msg2 = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'test2', payload: {} })
      db.markFailed(msg2.id)

      db.subscribe('test-topic', agentAddr)
      db.unsubscribe('test-topic', agentAddr)

      const result = gc.runCycle()
      expect(result.deliveredPurged).to.equal(1)
      expect(result.failedPurged).to.equal(1)
      expect(result.subscriptionsPurged).to.equal(1)
    })
  })

  // ===========================================================================
  // start() / stop()
  // ===========================================================================

  describe('start() and stop()', () => {
    it('starts the GC timer', async () => {
      const msg = db.enqueue({ pattern: 'cast', from: cliAddr, to: agentAddr, type: 'test', payload: {} })
      db.markDelivered(msg.id)

      gc.start()

      // Wait for a cycle to run
      await sleep(200)

      // Message should have been purged
      expect(db.getMessage(msg.id)).to.be.null

      gc.stop()
    })

    it('stop is idempotent', () => {
      gc.start()
      gc.stop()
      gc.stop() // Should not throw
    })

    it('start is idempotent', () => {
      gc.start()
      gc.start() // Should not throw or create duplicate timers
      gc.stop()
    })
  })
})

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
