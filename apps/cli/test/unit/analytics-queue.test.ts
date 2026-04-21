import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'

/**
 * Tests for the analytics write-ahead log (WAL) queue.
 *
 * Design: events are written synchronously to a disk queue via trackEvent().
 * On shutdown, the PostHog init promise is awaited (with timeout) so queued
 * events from previous runs get flushed. If PostHog doesn't initialize in
 * time, events persist on disk for the next run.
 *
 * Tests use a mock posthog-node to make PostHog initialization
 * deterministic (no network dependency).
 */
describe('Analytics queue persistence', () => {
  let testDir: string
  // Absolute path to the source analytics module (not dist/ — tests must not depend on build artifacts)
  // Uses .js extension for Node16 module resolution (ts-node/esm resolves .js → .ts)
  const analyticsPath = path.resolve(process.cwd(), 'src/lib/telemetry/analytics.js')
  // Convert to file:// URL for ESM imports in child scripts
  const analyticsUrl = `file://${analyticsPath}`

  beforeEach(() => {
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-queue-test-')))
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  /**
   * Create mock posthog-node files in the test directory.
   * Uses Node.js module resolution hooks to intercept the imports.
   *
   * @param opts.initDelay - ms to delay PostHog constructor (default: 0)
   * @param opts.initThrows - if true, PostHog constructor throws
   * @returns path to the file where mock writes logged events on shutdown
   */
  function createMockPostHog(opts?: { initDelay?: number; initThrows?: boolean }): string {
    const mockDir = path.join(testDir, 'mock')
    fs.mkdirSync(mockDir, { recursive: true })

    const posthogEventsPath = path.join(testDir, 'posthog-events.json')
    const initThrows = opts?.initThrows ?? false

    // Mock posthog-node module
    fs.writeFileSync(path.join(mockDir, 'posthog-mock.mjs'), `
import * as fs from 'node:fs';
const EVENTS_FILE = ${JSON.stringify(posthogEventsPath)};
export class PostHog {
  constructor(apiKey, options) {
    ${initThrows ? `throw new Error('mock init failure');` : ''}
    this._events = [];
  }
  capture(message) {
    this._events.push(message);
  }
  shutdown() {
    try {
      fs.writeFileSync(EVENTS_FILE, JSON.stringify(this._events), 'utf-8');
    } catch {}
  }
}
`, 'utf-8')

    // Loader hook — resolves posthog-node to our mock
    fs.writeFileSync(path.join(mockDir, 'mock-loader.mjs'), `
const POSTHOG_MOCK_URL = new URL('./posthog-mock.mjs', import.meta.url).href;
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'posthog-node') {
    return { url: POSTHOG_MOCK_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`, 'utf-8')

    // Register script — used with --import to install the loader
    fs.writeFileSync(path.join(mockDir, 'register-mock.mjs'), `
import { register } from 'node:module';
register('./mock-loader.mjs', import.meta.url);
`, 'utf-8')

    return posthogEventsPath
  }

  /**
   * Helper to run an ESM script in a child process with isolated HOME.
   *
   * @param script - The test script body (analytics module is pre-imported)
   * @param opts.useMock - Use mock PostHog (default: false)
   * @param opts.mockOpts - Options for the mock PostHog
   */
  function runAnalyticsScript(
    script: string,
    opts?: { useMock?: boolean; mockOpts?: { initDelay?: number; initThrows?: boolean } },
  ): { queue: unknown[] | null; stdout: string; stderr: string; posthogEvents: unknown[] | null } {
    const configDir = path.join(testDir, '.proletariat')
    fs.mkdirSync(configDir, { recursive: true })

    // Create telemetry config so isTelemetryEnabled() returns true
    fs.writeFileSync(
      path.join(configDir, 'telemetry.json'),
      JSON.stringify({
        enabled: true,
        noticeShown: true,
        machineId: '00000000-0000-0000-0000-000000000000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    )

    let posthogEventsPath: string | null = null
    if (opts?.useMock) {
      posthogEventsPath = createMockPostHog(opts.mockOpts)
    }

    // Prefix the script with the absolute import
    const fullScript = `
const ANALYTICS_URL = ${JSON.stringify(analyticsUrl)};
const analytics = await import(ANALYTICS_URL);
const { initAnalytics, trackCommandRun, trackEvent, shutdownAnalytics, flushQueuedEvents } = analytics;
${script}
`

    const scriptPath = path.join(testDir, 'test-script.mjs')
    fs.writeFileSync(scriptPath, fullScript, 'utf-8')

    const nodeArgs: string[] = ['--loader', 'ts-node/esm']
    if (opts?.useMock) {
      const registerPath = path.join(testDir, 'mock', 'register-mock.mjs')
      nodeArgs.push('--import', registerPath)
    }
    nodeArgs.push(scriptPath)

    let stdout = ''
    let stderr = ''
    try {
      stdout = execFileSync('node', nodeArgs, {
        env: {
          ...process.env,
          HOME: testDir,
          CI: '',
          DO_NOT_TRACK: '',
          PRLT_TELEMETRY_DISABLED: '',
        },
        timeout: 15000,
      }).toString()
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer; stderr?: Buffer }
      stdout = e.stdout?.toString() ?? ''
      stderr = e.stderr?.toString() ?? ''
    }

    const queuePath = path.join(configDir, 'telemetry-queue.json')
    let queue: unknown[] | null = null
    if (fs.existsSync(queuePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(queuePath, 'utf-8'))
        queue = Array.isArray(parsed) ? parsed : null
      } catch {
        queue = null
      }
    }

    let posthogEvents: unknown[] | null = null
    if (posthogEventsPath && fs.existsSync(posthogEventsPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(posthogEventsPath, 'utf-8'))
        posthogEvents = Array.isArray(parsed) ? parsed : null
      } catch {
        posthogEvents = null
      }
    }

    return { queue, stdout, stderr, posthogEvents }
  }

  // ── Queue write mechanics (no PostHog init) ────────────────────────────

  it('trackEvent writes events to disk queue synchronously', () => {
    const { queue, stderr } = runAnalyticsScript(`
      trackEvent('event_one', 1, { key: 'val1' });
      trackEvent('event_two', 2, { key: 'val2' });
      trackEvent('event_three', 3, { key: 'val3' });
    `)

    expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
    expect(queue).to.have.length(3)
    expect((queue![0] as Record<string, unknown>).name).to.equal('event_one')
    expect((queue![1] as Record<string, unknown>).name).to.equal('event_two')
    expect((queue![2] as Record<string, unknown>).name).to.equal('event_three')
  })

  it('trackCommandRun writes a command_run event to queue', () => {
    const { queue, stderr } = runAnalyticsScript(`
      trackCommandRun({ command: 'test:cmd', durationMs: 42, success: true, flags: ['--json'] });
    `)

    expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
    expect(queue).to.have.length(1)
    const event = queue![0] as Record<string, unknown>
    expect(event.name).to.equal('command_run')
    expect((event.metadata as Record<string, string>).command).to.equal('test:cmd')
  })

  // ── Flush behavior with mock PostHog ───────────────────────────────────

  it('shutdownAnalytics drains previous-run events from queue (PRLT-1013 regression)', () => {
    const configDir = path.join(testDir, '.proletariat')
    fs.mkdirSync(configDir, { recursive: true })

    // Pre-populate queue with events from a "previous run"
    const previousEvents = [
      { name: 'command_run', value: 50, metadata: { command: 'old:cmd' }, timestamp: new Date().toISOString() },
      { name: 'agent_spawned', value: null, metadata: { executor: 'claude' }, timestamp: new Date().toISOString() },
    ]
    fs.writeFileSync(
      path.join(configDir, 'telemetry-queue.json'),
      JSON.stringify(previousEvents),
    )

    // Simulate a fast command: init → immediate shutdown (no explicit wait)
    const { queue, posthogEvents, stderr } = runAnalyticsScript(`
      initAnalytics('0.0.0-test');
      await shutdownAnalytics();
    `, { useMock: true })

    // After fix: shutdownAnalytics awaits the init promise, which calls
    // flushQueuedEvents(). Previous-run events should be drained from disk
    // and delivered to PostHog.
    const hasOldEvent = queue?.some(
      (e: unknown) => ((e as Record<string, unknown>).metadata as Record<string, string>)?.command === 'old:cmd',
    ) ?? false
    expect(hasOldEvent, `previous-run events should be flushed from queue, stderr: ${stderr}`).to.be.false

    // Verify events were actually sent to PostHog (via mock)
    expect(posthogEvents, `posthog should have received events, stderr: ${stderr}`).to.not.be.null
    expect(posthogEvents!.length).to.equal(2)
    expect((posthogEvents![0] as Record<string, unknown>).event).to.equal('command_run')
    expect((posthogEvents![1] as Record<string, unknown>).event).to.equal('agent_spawned')
  })

  it('current-run events written after init are flushed via PostHog on shutdown', () => {
    const { queue, posthogEvents, stderr } = runAnalyticsScript(`
      initAnalytics('0.0.0-test');
      trackEvent('event_a', 1, { key: 'val1' });
      trackEvent('event_b', 2, { key: 'val2' });
      await shutdownAnalytics();
    `, { useMock: true })

    // Events written during this run should be flushed to PostHog during
    // shutdown (since the mock PostHog initializes instantly, the shutdown
    // flush picks them up)
    expect(posthogEvents, `posthog should have received events, stderr: ${stderr}`).to.not.be.null
    expect(posthogEvents!.length).to.equal(2)
    expect((posthogEvents![0] as Record<string, unknown>).event).to.equal('event_a')
    expect((posthogEvents![1] as Record<string, unknown>).event).to.equal('event_b')

    // Queue on disk should be empty (events were flushed)
    expect(queue).to.be.null
  })

  it('events persist on disk when PostHog fails to initialize', () => {
    const { queue, posthogEvents, stderr } = runAnalyticsScript(`
      initAnalytics('0.0.0-test');
      trackEvent('resilient_event', null, { source: 'test' });
      trackCommandRun({ command: 'test:fail', durationMs: 10, success: true, flags: [] });
      await shutdownAnalytics();
    `, { useMock: true, mockOpts: { initThrows: true } })

    // PostHog failed to init — events should persist on disk for the next run
    expect(queue, `queue should persist when PostHog fails, stderr: ${stderr}`).to.not.be.null
    expect(queue!.length).to.equal(2)

    // PostHog mock didn't get any events (init failed)
    expect(posthogEvents).to.be.null
  })

  it('previous-run events flushed while current-run event also flushed on shutdown', () => {
    const configDir = path.join(testDir, '.proletariat')
    fs.mkdirSync(configDir, { recursive: true })

    // Pre-populate queue with events from "previous run"
    const previousEvents = [
      { name: 'command_run', value: 50, metadata: { command: 'old:cmd' }, timestamp: new Date().toISOString() },
    ]
    fs.writeFileSync(
      path.join(configDir, 'telemetry-queue.json'),
      JSON.stringify(previousEvents),
    )

    const { queue, posthogEvents, stderr } = runAnalyticsScript(`
      initAnalytics('0.0.0-test');
      // Wait briefly for mock PostHog to initialize
      await new Promise(r => setTimeout(r, 50));
      // Track current command (simulates postrun hook)
      trackCommandRun({ command: 'new:cmd', durationMs: 25, success: true, flags: [] });
      await shutdownAnalytics();
    `, { useMock: true })

    // PostHog should have received both old and new events
    expect(posthogEvents, `posthog should have received events, stderr: ${stderr}`).to.not.be.null
    const oldEventSent = posthogEvents!.some(
      (e: unknown) => ((e as Record<string, unknown>).properties as Record<string, string>)?.command === 'old:cmd',
    )
    const newEventSent = posthogEvents!.some(
      (e: unknown) => ((e as Record<string, unknown>).properties as Record<string, string>)?.command === 'new:cmd',
    )
    expect(oldEventSent, 'old events should be sent to PostHog').to.be.true
    expect(newEventSent, 'new events should be sent to PostHog').to.be.true

    // Queue on disk should be empty (all events flushed)
    expect(queue).to.be.null
  })

  it('async PostHog init does not interfere after shutdown completes', () => {
    const { queue, stderr } = runAnalyticsScript(`
      // Write event before init
      trackEvent('pre_init_event', null, { source: 'previous-run' });

      // Init starts async PostHog init
      initAnalytics('0.0.0-test');

      // Shut down — awaits init promise (mock resolves instantly)
      await shutdownAnalytics();

      // Write another event after shutdown (simulates buggy late write)
      trackEvent('post_shutdown_event', null, { source: 'late' });

      // Wait to ensure no late async activity clears the post-shutdown event
      await new Promise(r => setTimeout(r, 500));
    `, { useMock: true })

    // The post-shutdown event should persist on disk (shutdown already ran,
    // so it won't be flushed until the next command run)
    expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
    const hasPostShutdownEvent = queue!.some(
      (e: unknown) => ((e as Record<string, unknown>).metadata as Record<string, string>)?.source === 'late',
    )
    expect(hasPostShutdownEvent, 'post-shutdown events should persist on disk').to.be.true

    // The pre-init event should NOT be on disk (it was flushed during shutdown)
    const hasPreInitEvent = queue!.some(
      (e: unknown) => ((e as Record<string, unknown>).metadata as Record<string, string>)?.source === 'previous-run',
    )
    expect(hasPreInitEvent, 'pre-init events should be flushed').to.be.false
  })
})
