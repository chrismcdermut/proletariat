import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

/**
 * Tests for the telemetry bridge (PRLT-1070).
 *
 * Verifies that the bridge correctly:
 * - Subscribes to EventBus agent lifecycle events
 * - Maps agent:stopped/agent:error events to PostHog events
 * - Tracks session durations correctly
 * - Enriches sessions with action names
 * - Cleans up on stop
 * - Classifies errors into safe categories (no PII leakage)
 */

let testDir: string
let originalHome: string | undefined
let originalDoNotTrack: string | undefined
let originalPrltTelemetryDisabled: string | undefined

function getQueuePath(): string {
  return path.join(testDir, '.proletariat', 'telemetry-queue.json')
}

function readQueue(): Array<{ name: string; value?: string | number | null; metadata?: Record<string, string> | null; timestamp: string }> {
  const queuePath = getQueuePath()
  if (!fs.existsSync(queuePath)) return []
  try {
    return JSON.parse(fs.readFileSync(queuePath, 'utf-8'))
  } catch {
    return []
  }
}

function clearQueue(): void {
  const queuePath = getQueuePath()
  try { fs.unlinkSync(queuePath) } catch { /* ignore */ }
}

describe('Telemetry Bridge (PRLT-1070)', () => {
  beforeEach(() => {
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-bridge-test-')))
    originalHome = process.env.HOME
    process.env.HOME = testDir

    originalDoNotTrack = process.env.DO_NOT_TRACK
    originalPrltTelemetryDisabled = process.env.PRLT_TELEMETRY_DISABLED
    delete process.env.DO_NOT_TRACK
    delete process.env.PRLT_TELEMETRY_DISABLED

    const configDir = path.join(testDir, '.proletariat')
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, 'telemetry.json'),
      JSON.stringify({
        enabled: true,
        noticeShown: true,
        machineId: 'test-bridge-machine-id',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    )
  })

  afterEach(async () => {
    // Stop the bridge if running
    const { stopTelemetryBridge } = await import('../../src/lib/telemetry/telemetry-bridge.js')
    stopTelemetryBridge()

    // Reset EventBus
    const { resetEventBus } = await import('../../src/lib/events/event-bus.js')
    resetEventBus()

    if (originalHome) {
      process.env.HOME = originalHome
    } else {
      delete process.env.HOME
    }

    if (originalDoNotTrack !== undefined) {
      process.env.DO_NOT_TRACK = originalDoNotTrack
    } else {
      delete process.env.DO_NOT_TRACK
    }

    if (originalPrltTelemetryDisabled !== undefined) {
      process.env.PRLT_TELEMETRY_DISABLED = originalPrltTelemetryDisabled
    } else {
      delete process.env.PRLT_TELEMETRY_DISABLED
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('tracks agent:stopped → agent_completed event via EventBus', async () => {
    const { startTelemetryBridge } = await import('../../src/lib/telemetry/telemetry-bridge.js')
    const { getEventBus } = await import('../../src/lib/events/event-bus.js')

    clearQueue()
    startTelemetryBridge()

    const bus = getEventBus()

    // Simulate agent spawn
    const spawnTime = new Date()
    bus.emit('agent:spawned', {
      sessionId: 'test-session-1',
      runner: 'claude-code',
      task: 'implement feature',
      workdir: '/tmp/test',
      background: false,
      timestamp: spawnTime,
    })

    // Simulate agent stop (50ms later)
    const stopTime = new Date(spawnTime.getTime() + 50)
    bus.emit('agent:stopped', {
      sessionId: 'test-session-1',
      runner: 'claude-code',
      reason: 'completed',
      timestamp: stopTime,
    })

    const events = readQueue()
    const completedEvent = events.find(e => e.name === 'agent_completed')
    expect(completedEvent).to.exist
    expect(completedEvent!.metadata?.exit_reason).to.equal('completed')
    expect(Number(completedEvent!.value)).to.be.at.least(0)
  })

  it('tracks agent:stopped with manual reason as stopped', async () => {
    const { startTelemetryBridge } = await import('../../src/lib/telemetry/telemetry-bridge.js')
    const { getEventBus } = await import('../../src/lib/events/event-bus.js')

    clearQueue()
    startTelemetryBridge()

    const bus = getEventBus()
    const now = new Date()

    bus.emit('agent:spawned', {
      sessionId: 'test-session-2',
      runner: 'claude-code',
      task: 'review code',
      workdir: '/tmp/test',
      background: false,
      timestamp: now,
    })

    bus.emit('agent:stopped', {
      sessionId: 'test-session-2',
      runner: 'claude-code',
      reason: 'manual',
      timestamp: new Date(now.getTime() + 100),
    })

    const events = readQueue()
    const completedEvent = events.find(e => e.name === 'agent_completed')
    expect(completedEvent).to.exist
    expect(completedEvent!.metadata?.exit_reason).to.equal('stopped')
  })

  it('tracks agent:error → agent_errored event via EventBus', async () => {
    const { startTelemetryBridge } = await import('../../src/lib/telemetry/telemetry-bridge.js')
    const { getEventBus } = await import('../../src/lib/events/event-bus.js')

    clearQueue()
    startTelemetryBridge()

    const bus = getEventBus()
    const now = new Date()

    bus.emit('agent:spawned', {
      sessionId: 'test-session-3',
      runner: 'claude-code',
      task: 'implement feature',
      workdir: '/tmp/test',
      background: false,
      timestamp: now,
    })

    bus.emit('agent:error', {
      sessionId: 'test-session-3',
      runner: 'claude-code',
      error: 'Docker container timeout exceeded',
      timestamp: new Date(now.getTime() + 200),
    })

    const events = readQueue()
    const errorEvent = events.find(e => e.name === 'agent_errored')
    expect(errorEvent).to.exist
    expect(errorEvent!.metadata?.exit_reason).to.equal('errored')
    expect(errorEvent!.metadata?.error_type).to.equal('timeout')
  })

  it('classifies error messages into safe categories', async () => {
    const { startTelemetryBridge } = await import('../../src/lib/telemetry/telemetry-bridge.js')
    const { getEventBus } = await import('../../src/lib/events/event-bus.js')

    const bus = getEventBus()
    clearQueue()
    startTelemetryBridge()

    const testCases = [
      { error: 'Docker container failed to start', expected: 'container' },
      { error: 'Permission denied for /home/user/.ssh', expected: 'permission' },
      { error: 'ECONNREFUSED connecting to API', expected: 'network' },
      { error: 'spawn claude-code ENOENT', expected: 'spawn_failure' },
      { error: 'Process exceeded memory limit (OOM)', expected: 'memory' },
      { error: 'Some completely unknown error', expected: 'unknown' },
    ]

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i]
      const sessionId = `classify-test-${i}`
      const now = new Date()

      bus.emit('agent:spawned', {
        sessionId,
        runner: 'test',
        task: 'test',
        workdir: '/tmp',
        background: false,
        timestamp: now,
      })

      bus.emit('agent:error', {
        sessionId,
        runner: 'test',
        error: tc.error,
        timestamp: new Date(now.getTime() + 10),
      })
    }

    const events = readQueue()
    const errorEvents = events.filter(e => e.name === 'agent_errored')
    expect(errorEvents).to.have.length(testCases.length)

    for (let i = 0; i < testCases.length; i++) {
      expect(errorEvents[i].metadata?.error_type).to.equal(
        testCases[i].expected,
        `Expected "${testCases[i].error}" to classify as "${testCases[i].expected}"`
      )
    }
  })

  it('enriches agent session with action name', async () => {
    const { startTelemetryBridge, enrichAgentSession } = await import('../../src/lib/telemetry/telemetry-bridge.js')
    const { getEventBus } = await import('../../src/lib/events/event-bus.js')

    clearQueue()
    startTelemetryBridge()

    const bus = getEventBus()
    const now = new Date()

    bus.emit('agent:spawned', {
      sessionId: 'enrich-test',
      runner: 'claude-code',
      task: 'implement feature',
      workdir: '/tmp/test',
      background: false,
      timestamp: now,
    })

    // Enrich with action name
    enrichAgentSession('enrich-test', 'review')

    bus.emit('agent:stopped', {
      sessionId: 'enrich-test',
      runner: 'claude-code',
      reason: 'completed',
      timestamp: new Date(now.getTime() + 100),
    })

    const events = readQueue()
    const completedEvent = events.find(e => e.name === 'agent_completed')
    expect(completedEvent).to.exist
    expect(completedEvent!.metadata?.action).to.equal('review')
  })

  it('cleans up subscriptions on stop', async () => {
    const { startTelemetryBridge, stopTelemetryBridge } = await import('../../src/lib/telemetry/telemetry-bridge.js')
    const { getEventBus } = await import('../../src/lib/events/event-bus.js')

    clearQueue()
    startTelemetryBridge()
    stopTelemetryBridge()

    const bus = getEventBus()

    // Events after stop should NOT be tracked
    bus.emit('agent:spawned', {
      sessionId: 'after-stop',
      runner: 'claude-code',
      task: 'test',
      workdir: '/tmp',
      background: false,
      timestamp: new Date(),
    })

    bus.emit('agent:stopped', {
      sessionId: 'after-stop',
      runner: 'claude-code',
      reason: 'completed',
      timestamp: new Date(),
    })

    const events = readQueue()
    const completedEvents = events.filter(e => e.name === 'agent_completed')
    expect(completedEvents).to.have.length(0)
  })

  it('is idempotent — calling start multiple times does not double-subscribe', async () => {
    const { startTelemetryBridge, stopTelemetryBridge } = await import('../../src/lib/telemetry/telemetry-bridge.js')
    const { getEventBus } = await import('../../src/lib/events/event-bus.js')

    clearQueue()
    startTelemetryBridge()
    startTelemetryBridge() // Second call should be no-op

    const bus = getEventBus()
    const now = new Date()

    bus.emit('agent:spawned', {
      sessionId: 'idempotent-test',
      runner: 'claude-code',
      task: 'test',
      workdir: '/tmp',
      background: false,
      timestamp: now,
    })

    bus.emit('agent:stopped', {
      sessionId: 'idempotent-test',
      runner: 'claude-code',
      reason: 'completed',
      timestamp: new Date(now.getTime() + 10),
    })

    const events = readQueue()
    const completedEvents = events.filter(e => e.name === 'agent_completed')
    // Should only have 1 event, not 2 (no double-subscribe)
    expect(completedEvents).to.have.length(1)

    stopTelemetryBridge()
  })
})
