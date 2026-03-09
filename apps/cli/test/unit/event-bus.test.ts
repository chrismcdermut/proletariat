import { expect } from 'chai'
import { EventBus, resetEventBus, getEventBus } from '../../src/lib/events/index.js'
import { EventEmittingRunner } from '../../src/lib/events/emitting-runner.js'
import type { AgentRunner, AgentSession, SpawnConfig } from '../../src/lib/runners/agent-runner.js'
import type { AgentSpawnedEvent, AgentStoppedEvent, AgentStatusChangeEvent, AgentPokedEvent, AgentOutputEvent, AgentErrorEvent } from '../../src/lib/events/events.js'

// =============================================================================
// Mock Runner
// =============================================================================

function createMockSession(overrides?: Partial<AgentSession>): AgentSession {
  return {
    id: 'test-session-1',
    runner: 'mock',
    sessionName: 'mock-session',
    task: 'test task',
    workdir: '/tmp/test',
    startedAt: new Date(),
    status: 'running',
    ...overrides,
  }
}

class MockRunner implements AgentRunner {
  readonly name = 'mock'
  spawnResult: AgentSession = createMockSession()
  statusResult: 'running' | 'done' | 'error' = 'running'
  peekResult = 'some output'
  spawnShouldThrow = false

  async spawn(_config: SpawnConfig): Promise<AgentSession> {
    if (this.spawnShouldThrow) {
      throw new Error('spawn failed')
    }
    return this.spawnResult
  }

  async getStatus(_session: AgentSession): Promise<'running' | 'done' | 'error'> {
    return this.statusResult
  }

  async peek(_session: AgentSession, _lines?: number): Promise<string> {
    return this.peekResult
  }

  async poke(_session: AgentSession, _message: string): Promise<void> {
    // no-op
  }

  async stop(_session: AgentSession): Promise<void> {
    // no-op
  }
}

// =============================================================================
// EventBus Tests
// =============================================================================

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  describe('on() and emit()', () => {
    it('delivers events to subscribed listeners', () => {
      const received: AgentSpawnedEvent[] = []
      bus.on('agent:spawned', (event) => received.push(event))

      const payload: AgentSpawnedEvent = {
        sessionId: 's1',
        runner: 'claude-code',
        task: 'implement feature',
        workdir: '/repo',
        background: false,
        timestamp: new Date(),
      }
      bus.emit('agent:spawned', payload)

      expect(received).to.have.lengthOf(1)
      expect(received[0].sessionId).to.equal('s1')
      expect(received[0].runner).to.equal('claude-code')
    })

    it('delivers events to multiple listeners', () => {
      let count = 0
      bus.on('agent:stopped', () => { count++ })
      bus.on('agent:stopped', () => { count++ })

      bus.emit('agent:stopped', {
        sessionId: 's1',
        runner: 'mock',
        reason: 'manual',
        timestamp: new Date(),
      })

      expect(count).to.equal(2)
    })

    it('does not deliver events to listeners of different event types', () => {
      let called = false
      bus.on('agent:stopped', () => { called = true })

      bus.emit('agent:spawned', {
        sessionId: 's1',
        runner: 'mock',
        task: 'test',
        workdir: '/tmp',
        background: false,
        timestamp: new Date(),
      })

      expect(called).to.be.false
    })

    it('handles emit with no listeners gracefully', () => {
      // Should not throw
      bus.emit('agent:spawned', {
        sessionId: 's1',
        runner: 'mock',
        task: 'test',
        workdir: '/tmp',
        background: false,
        timestamp: new Date(),
      })
    })

    it('catches and suppresses listener errors', () => {
      let secondCalled = false
      bus.on('agent:spawned', () => { throw new Error('listener error') })
      bus.on('agent:spawned', () => { secondCalled = true })

      bus.emit('agent:spawned', {
        sessionId: 's1',
        runner: 'mock',
        task: 'test',
        workdir: '/tmp',
        background: false,
        timestamp: new Date(),
      })

      // Second listener should still be called despite first throwing
      expect(secondCalled).to.be.true
    })
  })

  describe('unsubscribe', () => {
    it('stops receiving events after unsubscribing', () => {
      let count = 0
      const unsub = bus.on('agent:spawned', () => { count++ })

      bus.emit('agent:spawned', {
        sessionId: 's1',
        runner: 'mock',
        task: 'test',
        workdir: '/tmp',
        background: false,
        timestamp: new Date(),
      })
      expect(count).to.equal(1)

      unsub()

      bus.emit('agent:spawned', {
        sessionId: 's2',
        runner: 'mock',
        task: 'test2',
        workdir: '/tmp',
        background: false,
        timestamp: new Date(),
      })
      expect(count).to.equal(1) // Not incremented
    })
  })

  describe('once()', () => {
    it('fires listener only once', () => {
      let count = 0
      bus.once('agent:stopped', () => { count++ })

      const payload: AgentStoppedEvent = {
        sessionId: 's1',
        runner: 'mock',
        reason: 'manual',
        timestamp: new Date(),
      }

      bus.emit('agent:stopped', payload)
      bus.emit('agent:stopped', payload)

      expect(count).to.equal(1)
    })

    it('returns an unsubscribe function that cancels early', () => {
      let called = false
      const unsub = bus.once('agent:stopped', () => { called = true })

      unsub() // Cancel before any emission

      bus.emit('agent:stopped', {
        sessionId: 's1',
        runner: 'mock',
        reason: 'manual',
        timestamp: new Date(),
      })

      expect(called).to.be.false
    })
  })

  describe('removeAllListeners()', () => {
    it('removes listeners for a specific event', () => {
      let spawnCalled = false
      let stopCalled = false
      bus.on('agent:spawned', () => { spawnCalled = true })
      bus.on('agent:stopped', () => { stopCalled = true })

      bus.removeAllListeners('agent:spawned')

      bus.emit('agent:spawned', {
        sessionId: 's1',
        runner: 'mock',
        task: 'test',
        workdir: '/tmp',
        background: false,
        timestamp: new Date(),
      })
      bus.emit('agent:stopped', {
        sessionId: 's1',
        runner: 'mock',
        reason: 'manual',
        timestamp: new Date(),
      })

      expect(spawnCalled).to.be.false
      expect(stopCalled).to.be.true
    })

    it('removes all listeners when called without arguments', () => {
      let count = 0
      bus.on('agent:spawned', () => { count++ })
      bus.on('agent:stopped', () => { count++ })

      bus.removeAllListeners()

      bus.emit('agent:spawned', {
        sessionId: 's1',
        runner: 'mock',
        task: 'test',
        workdir: '/tmp',
        background: false,
        timestamp: new Date(),
      })
      bus.emit('agent:stopped', {
        sessionId: 's1',
        runner: 'mock',
        reason: 'manual',
        timestamp: new Date(),
      })

      expect(count).to.equal(0)
    })
  })

  describe('listenerCount()', () => {
    it('returns the number of listeners for an event', () => {
      expect(bus.listenerCount('agent:spawned')).to.equal(0)

      const unsub1 = bus.on('agent:spawned', () => {})
      expect(bus.listenerCount('agent:spawned')).to.equal(1)

      bus.on('agent:spawned', () => {})
      expect(bus.listenerCount('agent:spawned')).to.equal(2)

      unsub1()
      expect(bus.listenerCount('agent:spawned')).to.equal(1)
    })
  })
})

// =============================================================================
// Singleton Tests
// =============================================================================

describe('getEventBus / resetEventBus', () => {
  afterEach(() => {
    resetEventBus()
  })

  it('returns the same instance on subsequent calls', () => {
    const bus1 = getEventBus()
    const bus2 = getEventBus()
    expect(bus1).to.equal(bus2)
  })

  it('returns a fresh instance after reset', () => {
    const bus1 = getEventBus()
    resetEventBus()
    const bus2 = getEventBus()
    expect(bus1).to.not.equal(bus2)
  })
})

// =============================================================================
// EventEmittingRunner Tests
// =============================================================================

describe('EventEmittingRunner', () => {
  let mockRunner: MockRunner
  let bus: EventBus
  let emitting: EventEmittingRunner

  beforeEach(() => {
    mockRunner = new MockRunner()
    bus = new EventBus()
    emitting = new EventEmittingRunner(mockRunner, bus)
  })

  it('has the same name as the wrapped runner', () => {
    expect(emitting.name).to.equal('mock')
  })

  describe('spawn()', () => {
    it('emits agent:spawned on successful spawn', async () => {
      const events: AgentSpawnedEvent[] = []
      bus.on('agent:spawned', (e) => events.push(e))

      const session = await emitting.spawn({
        task: 'implement auth',
        workdir: '/repo',
        background: true,
      })

      expect(session.id).to.equal('test-session-1')
      expect(events).to.have.lengthOf(1)
      expect(events[0].sessionId).to.equal('test-session-1')
      expect(events[0].runner).to.equal('mock')
      expect(events[0].task).to.equal('implement auth')
      expect(events[0].workdir).to.equal('/repo')
      expect(events[0].background).to.be.true
    })

    it('emits agent:error and re-throws on spawn failure', async () => {
      mockRunner.spawnShouldThrow = true
      const errors: AgentErrorEvent[] = []
      bus.on('agent:error', (e) => errors.push(e))

      try {
        await emitting.spawn({ task: 'fail', workdir: '/tmp' })
        expect.fail('should have thrown')
      } catch (err) {
        expect((err as Error).message).to.equal('spawn failed')
      }

      expect(errors).to.have.lengthOf(1)
      expect(errors[0].error).to.equal('spawn failed')
      expect(errors[0].runner).to.equal('mock')
    })
  })

  describe('getStatus()', () => {
    it('emits agent:status_change when status differs from session', async () => {
      const changes: AgentStatusChangeEvent[] = []
      bus.on('agent:status_change', (e) => changes.push(e))

      const session = createMockSession({ status: 'running' })
      mockRunner.statusResult = 'done'

      const status = await emitting.getStatus(session)

      expect(status).to.equal('done')
      expect(changes).to.have.lengthOf(1)
      expect(changes[0].previousStatus).to.equal('running')
      expect(changes[0].newStatus).to.equal('done')
    })

    it('does not emit when status is unchanged', async () => {
      const changes: AgentStatusChangeEvent[] = []
      bus.on('agent:status_change', (e) => changes.push(e))

      const session = createMockSession({ status: 'running' })
      mockRunner.statusResult = 'running'

      await emitting.getStatus(session)

      expect(changes).to.have.lengthOf(0)
    })
  })

  describe('peek()', () => {
    it('emits agent:output with captured output', async () => {
      const outputs: AgentOutputEvent[] = []
      bus.on('agent:output', (e) => outputs.push(e))

      const session = createMockSession()
      mockRunner.peekResult = 'hello world'

      const result = await emitting.peek(session, 100)

      expect(result).to.equal('hello world')
      expect(outputs).to.have.lengthOf(1)
      expect(outputs[0].output).to.equal('hello world')
      expect(outputs[0].lines).to.equal(100)
    })
  })

  describe('poke()', () => {
    it('emits agent:poked with the message', async () => {
      const pokes: AgentPokedEvent[] = []
      bus.on('agent:poked', (e) => pokes.push(e))

      const session = createMockSession()
      await emitting.poke(session, 'fix the tests')

      expect(pokes).to.have.lengthOf(1)
      expect(pokes[0].message).to.equal('fix the tests')
      expect(pokes[0].sessionId).to.equal('test-session-1')
    })
  })

  describe('stop()', () => {
    it('emits agent:stopped with manual reason', async () => {
      const stops: AgentStoppedEvent[] = []
      bus.on('agent:stopped', (e) => stops.push(e))

      const session = createMockSession()
      await emitting.stop(session)

      expect(stops).to.have.lengthOf(1)
      expect(stops[0].reason).to.equal('manual')
      expect(stops[0].sessionId).to.equal('test-session-1')
    })
  })
})
