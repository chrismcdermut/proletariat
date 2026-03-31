import { expect } from 'chai'
import { EventBus, resetEventBus, getEventBus } from '../../src/lib/events/index.js'
import { EventEmittingRunner } from '../../src/lib/events/emitting-runner.js'
import type { AgentRunner, AgentSession, SpawnConfig } from '../../src/lib/runners/agent-runner.js'
import type { AgentStoppedEvent } from '../../src/lib/events/events.js'

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
  statusResult: 'running' | 'done' | 'error' = 'running'

  async spawn(_config: SpawnConfig): Promise<AgentSession> {
    return createMockSession()
  }

  async getStatus(_session: AgentSession): Promise<'running' | 'done' | 'error'> {
    return this.statusResult
  }

  async peek(_session: AgentSession, _lines?: number): Promise<string> {
    return 'output'
  }

  async poke(_session: AgentSession, _message: string): Promise<void> {
    // no-op
  }

  async stop(_session: AgentSession): Promise<void> {
    // no-op
  }
}

// =============================================================================
// Tests
// =============================================================================

/**
 * Tests for agent:stopped event emission from EventEmittingRunner.
 *
 * Verifies Tier 1 event emission: the EventEmittingRunner must emit
 * agent:stopped when:
 *   1. stop() is called (reason: 'manual')
 *   2. getStatus() transitions to 'done' (reason: 'completed')
 *   3. getStatus() transitions to 'error' (reason: 'error')
 *
 * It must NOT emit duplicate stopped events for repeated terminal status checks.
 */
describe('@smoke GC Event Emission', () => {
  let bus: EventBus
  let inner: MockRunner
  let runner: EventEmittingRunner

  beforeEach(() => {
    resetEventBus()
    bus = getEventBus()
    inner = new MockRunner()
    runner = new EventEmittingRunner(inner, bus)
  })

  afterEach(() => {
    resetEventBus()
  })

  // ---------------------------------------------------------------------------
  // stop() emits agent:stopped with reason: 'manual'
  // ---------------------------------------------------------------------------
  describe('stop() emission', () => {
    it('should emit agent:stopped with reason "manual" when stop() is called', async () => {
      const events: AgentStoppedEvent[] = []
      bus.on('agent:stopped', (event) => {
        events.push(event as unknown as AgentStoppedEvent)
      })

      const session = createMockSession()
      await runner.stop(session)

      expect(events).to.have.length(1)
      expect(events[0].sessionId).to.equal('test-session-1')
      expect(events[0].runner).to.equal('mock')
      expect(events[0].reason).to.equal('manual')
      expect(events[0].timestamp).to.be.instanceOf(Date)
    })
  })

  // ---------------------------------------------------------------------------
  // getStatus() transitions to 'done' emits agent:stopped
  // ---------------------------------------------------------------------------
  describe('getStatus() done transition', () => {
    it('should emit agent:stopped with reason "completed" when status becomes done', async () => {
      const events: AgentStoppedEvent[] = []
      bus.on('agent:stopped', (event) => {
        events.push(event as unknown as AgentStoppedEvent)
      })

      const session = createMockSession({ status: 'running' })
      inner.statusResult = 'done'
      await runner.getStatus(session)

      expect(events).to.have.length(1)
      expect(events[0].reason).to.equal('completed')
      expect(events[0].sessionId).to.equal('test-session-1')
    })
  })

  // ---------------------------------------------------------------------------
  // getStatus() transitions to 'error' emits agent:stopped
  // ---------------------------------------------------------------------------
  describe('getStatus() error transition', () => {
    it('should emit agent:stopped with reason "error" when status becomes error', async () => {
      const events: AgentStoppedEvent[] = []
      bus.on('agent:stopped', (event) => {
        events.push(event as unknown as AgentStoppedEvent)
      })

      const session = createMockSession({ status: 'running' })
      inner.statusResult = 'error'
      await runner.getStatus(session)

      expect(events).to.have.length(1)
      expect(events[0].reason).to.equal('error')
    })
  })

  // ---------------------------------------------------------------------------
  // No duplicate emission for repeated terminal checks
  // ---------------------------------------------------------------------------
  describe('deduplication', () => {
    it('should NOT emit agent:stopped when status stays "done"', async () => {
      const events: AgentStoppedEvent[] = []
      bus.on('agent:stopped', (event) => {
        events.push(event as unknown as AgentStoppedEvent)
      })

      // First check: running -> done (should emit)
      const session = createMockSession({ status: 'running' })
      inner.statusResult = 'done'
      await runner.getStatus(session)
      expect(events).to.have.length(1)

      // Second check: done -> done (should NOT emit)
      session.status = 'done'
      await runner.getStatus(session)
      expect(events).to.have.length(1) // still 1, no duplicate
    })

    it('should NOT emit agent:stopped when status stays "error"', async () => {
      const events: AgentStoppedEvent[] = []
      bus.on('agent:stopped', (event) => {
        events.push(event as unknown as AgentStoppedEvent)
      })

      const session = createMockSession({ status: 'running' })
      inner.statusResult = 'error'
      await runner.getStatus(session)
      expect(events).to.have.length(1)

      // Check again with same terminal status
      session.status = 'error'
      await runner.getStatus(session)
      expect(events).to.have.length(1) // no duplicate
    })
  })

  // ---------------------------------------------------------------------------
  // No emission when status stays 'running'
  // ---------------------------------------------------------------------------
  describe('no emission for running', () => {
    it('should NOT emit agent:stopped when status remains running', async () => {
      const events: AgentStoppedEvent[] = []
      bus.on('agent:stopped', (event) => {
        events.push(event as unknown as AgentStoppedEvent)
      })

      const session = createMockSession({ status: 'running' })
      inner.statusResult = 'running'
      await runner.getStatus(session)

      expect(events).to.have.length(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Both stop() and getStatus() can emit independently
  // ---------------------------------------------------------------------------
  describe('stop and status emit independently', () => {
    it('should emit from both stop() and getStatus() as independent events', async () => {
      const events: AgentStoppedEvent[] = []
      bus.on('agent:stopped', (event) => {
        events.push(event as unknown as AgentStoppedEvent)
      })

      const session = createMockSession({ status: 'running' })

      // Transition to done via getStatus
      inner.statusResult = 'done'
      await runner.getStatus(session)
      expect(events).to.have.length(1)
      expect(events[0].reason).to.equal('completed')

      // Manual stop
      await runner.stop(session)
      expect(events).to.have.length(2)
      expect(events[1].reason).to.equal('manual')
    })
  })
})
