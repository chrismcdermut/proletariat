import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { EventBus } from '../../../src/lib/events/event-bus.js'
import { SwitchboardClient } from '../../../src/lib/switchboard/client.js'
import { SwitchboardDB } from '../../../src/lib/switchboard/db.js'
import { SwitchboardBridge } from '../../../src/lib/switchboard/bridge.js'
import type { SwitchboardAddress } from '../../../src/lib/switchboard/types.js'

describe('SwitchboardBridge', () => {
  let tmpDir: string
  let dbPath: string
  let client: SwitchboardClient
  let eventBus: EventBus
  let bridge: SwitchboardBridge

  const daemonAddr: SwitchboardAddress = { kind: 'daemon', id: 'daemon-1' }

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-switchboard-bridge-test-')))
    dbPath = path.join(tmpDir, 'switchboard.db')
    const socketPath = path.join(tmpDir, 'switchboard.sock')

    client = new SwitchboardClient({
      address: daemonAddr,
      dbPath,
      socketPath,
    })

    eventBus = new EventBus()
  })

  afterEach(() => {
    if (bridge) bridge.stop()
    client.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ===========================================================================
  // start() / stop()
  // ===========================================================================

  describe('start() and stop()', () => {
    it('starts bridging and marks active', () => {
      bridge = new SwitchboardBridge({ client, eventBus })
      expect(bridge.isActive).to.be.false

      bridge.start()
      expect(bridge.isActive).to.be.true
    })

    it('stops bridging and marks inactive', () => {
      bridge = new SwitchboardBridge({ client, eventBus })
      bridge.start()
      bridge.stop()
      expect(bridge.isActive).to.be.false
    })

    it('start is idempotent', () => {
      bridge = new SwitchboardBridge({ client, eventBus })
      bridge.start()
      bridge.start() // Should not throw or double-subscribe
      expect(bridge.isActive).to.be.true
    })
  })

  // ===========================================================================
  // Event bridging
  // ===========================================================================

  describe('event bridging', () => {
    it('publishes EventBus events to switchboard', () => {
      bridge = new SwitchboardBridge({
        client,
        eventBus,
        events: ['agent:spawned'],
      })
      bridge.start()

      eventBus.emit('agent:spawned', {
        sessionId: 'sess-1',
        runner: 'claude-code',
        task: 'implement feature',
        workdir: '/repo',
        background: false,
        timestamp: new Date(),
      })

      // Check that a message was enqueued in the switchboard
      const db = new SwitchboardDB(dbPath)
      const messages = db.listMessages({ pattern: 'event' })
      expect(messages).to.have.lengthOf(1)
      expect(messages[0].topic).to.equal('agent:spawned')
      expect(messages[0].type).to.equal('agent:spawned')
      db.close()
    })

    it('does not bridge events after stop', () => {
      bridge = new SwitchboardBridge({
        client,
        eventBus,
        events: ['agent:spawned'],
      })
      bridge.start()
      bridge.stop()

      eventBus.emit('agent:spawned', {
        sessionId: 'sess-1',
        runner: 'claude-code',
        task: 'test',
        workdir: '/repo',
        background: false,
        timestamp: new Date(),
      })

      const db = new SwitchboardDB(dbPath)
      const messages = db.listMessages({ pattern: 'event' })
      expect(messages).to.have.lengthOf(0)
      db.close()
    })

    it('bridges only configured events', () => {
      bridge = new SwitchboardBridge({
        client,
        eventBus,
        events: ['agent:spawned'],
      })
      bridge.start()

      // Emit an event that's not in the bridge list
      eventBus.emit('agent:stopped', {
        sessionId: 'sess-1',
        runner: 'claude-code',
        reason: 'manual' as const,
        timestamp: new Date(),
      })

      const db = new SwitchboardDB(dbPath)
      const messages = db.listMessages({ pattern: 'event' })
      expect(messages).to.have.lengthOf(0)
      db.close()
    })
  })

  // ===========================================================================
  // bridgedEvents
  // ===========================================================================

  describe('bridgedEvents', () => {
    it('returns the list of events being bridged', () => {
      bridge = new SwitchboardBridge({
        client,
        eventBus,
        events: ['agent:spawned', 'agent:stopped'],
      })

      expect(bridge.bridgedEvents).to.deep.equal(['agent:spawned', 'agent:stopped'])
    })

    it('uses default events when none specified', () => {
      bridge = new SwitchboardBridge({ client, eventBus })
      expect(bridge.bridgedEvents.length).to.be.greaterThan(0)
      expect(bridge.bridgedEvents).to.include('agent:spawned')
    })
  })
})
