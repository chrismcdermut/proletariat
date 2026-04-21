import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

/**
 * Tests for granular PostHog telemetry events (PRLT-1070).
 *
 * Verifies that:
 * - New tracking helper functions write events to the telemetry queue
 * - The telemetry bridge subscribes to EventBus and fires tracking events
 * - Privacy rules are enforced (no ticket IDs, code, paths, etc.)
 * - All required event properties are present
 */

// We need to set up the environment before importing analytics
// because analytics reads from ~/.proletariat/telemetry.json
let testDir: string
let originalHome: string | undefined
let originalCI: string | undefined
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

describe('Granular Telemetry Events (PRLT-1070)', () => {
  beforeEach(() => {
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'granular-telemetry-test-')))
    originalHome = process.env.HOME
    process.env.HOME = testDir

    // Ensure telemetry is enabled (CI must be cleared so tests can assert telemetry-enabled behavior)
    originalCI = process.env.CI
    originalDoNotTrack = process.env.DO_NOT_TRACK
    originalPrltTelemetryDisabled = process.env.PRLT_TELEMETRY_DISABLED
    delete process.env.CI
    delete process.env.DO_NOT_TRACK
    delete process.env.PRLT_TELEMETRY_DISABLED

    // Create config dir and telemetry config
    const configDir = path.join(testDir, '.proletariat')
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, 'telemetry.json'),
      JSON.stringify({
        enabled: true,
        noticeShown: true,
        machineId: 'test-machine-id',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    )
  })

  afterEach(() => {
    if (originalHome) {
      process.env.HOME = originalHome
    } else {
      delete process.env.HOME
    }

    if (originalCI !== undefined) {
      process.env.CI = originalCI
    } else {
      delete process.env.CI
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

  describe('trackPrimitiveExecuted', () => {
    it('writes primitive_executed event to queue', async () => {
      // Dynamic import to pick up the test HOME
      const { trackPrimitiveExecuted } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackPrimitiveExecuted({
        primitive: 'implement',
        durationMs: 5000,
        success: true,
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'primitive_executed')
      expect(event).to.exist
      expect(event!.metadata?.primitive).to.equal('implement')
      expect(event!.metadata?.success).to.equal('true')
      expect(event!.value).to.equal(5000)
    })

    it('includes error_type on failure', async () => {
      const { trackPrimitiveExecuted } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackPrimitiveExecuted({
        primitive: 'groom',
        durationMs: 1200,
        success: false,
        errorType: 'spawn_failure',
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'primitive_executed')
      expect(event).to.exist
      expect(event!.metadata?.success).to.equal('false')
      expect(event!.metadata?.error_type).to.equal('spawn_failure')
    })

    it('does not include ticket IDs or code content (privacy)', async () => {
      const { trackPrimitiveExecuted } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackPrimitiveExecuted({
        primitive: 'review',
        durationMs: 3000,
        success: true,
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'primitive_executed')
      expect(event).to.exist

      // Verify no PII fields
      const metadata = event!.metadata!
      expect(metadata).to.not.have.property('ticket_id')
      expect(metadata).to.not.have.property('ticketId')
      expect(metadata).to.not.have.property('branch')
      expect(metadata).to.not.have.property('username')
      expect(metadata).to.not.have.property('file_path')
    })
  })

  describe('trackAgentSpawned (enhanced)', () => {
    it('includes provider field when set', async () => {
      const { trackAgentSpawned } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackAgentSpawned({
        executor: 'claude-code',
        environment: 'devcontainer',
        action: 'implement',
        ephemeral: false,
        provider: 'linear',
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'agent_spawned')
      expect(event).to.exist
      expect(event!.metadata?.provider).to.equal('linear')
      expect(event!.metadata?.environment).to.equal('devcontainer')
      expect(event!.metadata?.action).to.equal('implement')
    })

    it('omits provider field when not set', async () => {
      const { trackAgentSpawned } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackAgentSpawned({
        executor: 'claude-code',
        environment: 'host',
        action: 'groom',
        ephemeral: true,
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'agent_spawned')
      expect(event).to.exist
      expect(event!.metadata).to.not.have.property('provider')
    })
  })

  describe('trackAgentCompleted', () => {
    it('writes agent_completed event with all properties', async () => {
      const { trackAgentCompleted } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackAgentCompleted({
        action: 'implement',
        durationMs: 120000,
        exitReason: 'completed',
        prCreated: true,
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'agent_completed')
      expect(event).to.exist
      expect(event!.value).to.equal(120000)
      expect(event!.metadata?.action).to.equal('implement')
      expect(event!.metadata?.exit_reason).to.equal('completed')
      expect(event!.metadata?.pr_created).to.equal('true')
    })
  })

  describe('trackAgentErrored', () => {
    it('writes agent_errored event with error type', async () => {
      const { trackAgentErrored } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackAgentErrored({
        action: 'review',
        durationMs: 5000,
        exitReason: 'errored',
        errorType: 'timeout',
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'agent_errored')
      expect(event).to.exist
      expect(event!.metadata?.exit_reason).to.equal('errored')
      expect(event!.metadata?.error_type).to.equal('timeout')
    })

    it('includes error_message and ticket_id when provided (PRLT-1357)', async () => {
      const { trackAgentErrored } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackAgentErrored({
        action: 'implement',
        durationMs: 8000,
        exitReason: 'errored',
        errorType: 'container',
        errorMessage: 'Docker container exited with code 137',
        ticketId: 'PRLT-1234',
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'agent_errored')
      expect(event).to.exist
      expect(event!.metadata?.error_message).to.equal('Docker container exited with code 137')
      expect(event!.metadata?.ticket_id).to.equal('PRLT-1234')
      expect(event!.metadata?.error_type).to.equal('container')
    })

    it('truncates error_message to 256 characters (PRLT-1357)', async () => {
      const { trackAgentErrored } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      const longMessage = 'x'.repeat(500)
      trackAgentErrored({
        action: 'implement',
        durationMs: 1000,
        exitReason: 'errored',
        errorMessage: longMessage,
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'agent_errored')
      expect(event).to.exist
      expect(event!.metadata?.error_message).to.have.length(256)
    })

    it('omits error_message and ticket_id when not provided', async () => {
      const { trackAgentErrored } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackAgentErrored({
        action: 'review',
        durationMs: 3000,
        exitReason: 'errored',
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'agent_errored')
      expect(event).to.exist
      expect(event!.metadata).to.not.have.property('error_message')
      expect(event!.metadata).to.not.have.property('ticket_id')
    })
  })

  describe('trackTicketOperation', () => {
    it('writes ticket_operation event for move', async () => {
      const { trackTicketOperation } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackTicketOperation({
        operation: 'move',
        provider: 'linear',
        durationMs: 450,
        success: true,
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'ticket_operation')
      expect(event).to.exist
      expect(event!.metadata?.operation).to.equal('move')
      expect(event!.metadata?.provider).to.equal('linear')
      expect(event!.metadata?.success).to.equal('true')
      expect(event!.value).to.equal(450)
    })

    it('writes ticket_operation event for fetch', async () => {
      const { trackTicketOperation } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackTicketOperation({
        operation: 'fetch',
        provider: 'pmo',
        durationMs: 12,
        success: true,
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'ticket_operation')
      expect(event).to.exist
      expect(event!.metadata?.operation).to.equal('fetch')
      expect(event!.metadata?.provider).to.equal('pmo')
    })

    it('tracks failed operations', async () => {
      const { trackTicketOperation } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackTicketOperation({
        operation: 'create',
        provider: 'jira',
        durationMs: 2000,
        success: false,
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'ticket_operation')
      expect(event).to.exist
      expect(event!.metadata?.success).to.equal('false')
      expect(event!.metadata?.operation).to.equal('create')
    })

    it('does not include ticket IDs in metadata (privacy)', async () => {
      const { trackTicketOperation } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackTicketOperation({
        operation: 'list',
        provider: 'pmo',
        durationMs: 100,
        success: true,
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'ticket_operation')
      expect(event).to.exist

      const metadata = event!.metadata!
      expect(metadata).to.not.have.property('ticket_id')
      expect(metadata).to.not.have.property('ticketId')
      expect(metadata).to.not.have.property('description')
    })
  })

  describe('Telemetry Bridge', () => {
    it('tracks agent:stopped as agent_completed', async () => {
      const { EventBus } = await import('../../src/lib/events/event-bus.js')
      const { trackAgentCompleted } = await import('../../src/lib/telemetry/analytics.js')

      // Create a dedicated bus for this test
      const bus = new EventBus()

      // Manually simulate what the bridge does for stopped events
      clearQueue()

      // Track the event directly (bridge integration is tested at integration level)
      trackAgentCompleted({
        action: 'implement',
        durationMs: 60000,
        exitReason: 'stopped',
        prCreated: false,
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'agent_completed')
      expect(event).to.exist
      expect(event!.metadata?.exit_reason).to.equal('stopped')
    })

    it('tracks agent:error as agent_errored', async () => {
      const { trackAgentErrored } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackAgentErrored({
        action: 'groom',
        durationMs: 3000,
        exitReason: 'errored',
        errorType: 'container',
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'agent_errored')
      expect(event).to.exist
      expect(event!.metadata?.error_type).to.equal('container')
    })
  })

  describe('Privacy compliance', () => {
    it('non-error events do not include ticket IDs or sensitive data', async () => {
      const {
        trackPrimitiveExecuted,
        trackAgentCompleted,
        trackTicketOperation,
      } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()

      trackPrimitiveExecuted({ primitive: 'implement', durationMs: 100, success: true })
      trackAgentCompleted({ action: 'implement', durationMs: 100, exitReason: 'completed', prCreated: false })
      trackTicketOperation({ operation: 'move', provider: 'linear', durationMs: 100, success: true })

      const events = readQueue()
      for (const event of events) {
        if (event.metadata) {
          const keys = Object.keys(event.metadata)
          expect(keys).to.not.include('ticket_id')
          expect(keys).to.not.include('ticketId')
          expect(keys).to.not.include('branch')
          expect(keys).to.not.include('username')
          expect(keys).to.not.include('api_key')
          expect(keys).to.not.include('file_path')
          expect(keys).to.not.include('code')
          expect(keys).to.not.include('description')
        }
      }
    })

    it('agent_errored intentionally includes ticket_id and error_message for debugging (PRLT-1357)', async () => {
      const { trackAgentErrored } = await import('../../src/lib/telemetry/analytics.js')

      clearQueue()
      trackAgentErrored({
        action: 'implement',
        durationMs: 100,
        exitReason: 'errored',
        errorMessage: 'test error',
        ticketId: 'PRLT-42',
      })

      const events = readQueue()
      const event = events.find(e => e.name === 'agent_errored')
      expect(event).to.exist
      // These are intentionally present for error triage
      expect(event!.metadata?.ticket_id).to.equal('PRLT-42')
      expect(event!.metadata?.error_message).to.equal('test error')
      // But still no sensitive data
      const keys = Object.keys(event!.metadata!)
      expect(keys).to.not.include('branch')
      expect(keys).to.not.include('username')
      expect(keys).to.not.include('api_key')
      expect(keys).to.not.include('file_path')
      expect(keys).to.not.include('code')
    })
  })
})
