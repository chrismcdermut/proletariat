import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'

/**
 * Tests for the analytics write-ahead log (WAL) queue.
 *
 * The key invariant: events written by trackCommandRun() in the postrun hook
 * MUST persist on disk after shutdownAnalytics() completes. Events are flushed
 * to Statsig on the NEXT command run, not during the current run's shutdown.
 *
 * This prevents the race condition where shutdownAnalytics() would immediately
 * clear the queue (via flushQueuedEvents), deleting events from disk before
 * they could be confirmed as sent to Statsig.
 */
describe('Analytics queue persistence', () => {
  let testDir: string
  // Absolute path to the built analytics module
  // Tests run from apps/cli/ so dist/ is directly under cwd
  const analyticsPath = path.resolve(process.cwd(), 'dist/lib/telemetry/analytics.js')
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
   * Helper to run an ESM script in a child process with isolated HOME.
   * The script receives analyticsUrl as a global so it can import the module.
   */
  function runAnalyticsScript(script: string): { queue: unknown[] | null; stdout: string; stderr: string } {
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

    // Prefix the script with the absolute import
    const fullScript = `
const ANALYTICS_URL = ${JSON.stringify(analyticsUrl)};
const analytics = await import(ANALYTICS_URL);
const { initAnalytics, trackCommandRun, trackEvent, shutdownAnalytics, flushQueuedEvents } = analytics;
${script}
`

    const scriptPath = path.join(testDir, 'test-script.mjs')
    fs.writeFileSync(scriptPath, fullScript, 'utf-8')

    let stdout = ''
    let stderr = ''
    try {
      stdout = execFileSync('node', [scriptPath], {
        env: {
          ...process.env,
          HOME: testDir,
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

    return { queue, stdout, stderr }
  }

  it('events persist on disk after trackCommandRun + shutdownAnalytics', () => {
    const { queue, stderr } = runAnalyticsScript(`
      initAnalytics('0.0.0-test');
      await new Promise(r => setTimeout(r, 200));
      trackCommandRun({ command: 'test:persist', durationMs: 100, success: true, flags: ['--json'] });
      await shutdownAnalytics();
    `)

    expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
    expect(queue).to.have.length(1)
    const event = queue![0] as Record<string, unknown>
    expect(event.name).to.equal('command_run')
    expect((event.metadata as Record<string, string>).command).to.equal('test:persist')
  })

  it('events persist even when Statsig client may have initialized', () => {
    const { queue, stderr } = runAnalyticsScript(`
      initAnalytics('0.0.0-test');
      // Wait longer to give Statsig time to initialize
      await new Promise(r => setTimeout(r, 3000));
      trackCommandRun({ command: 'test:with-statsig', durationMs: 50, success: true, flags: [] });
      await shutdownAnalytics();
    `)

    expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
    expect(queue).to.have.length.greaterThanOrEqual(1)
    const lastEvent = queue![queue!.length - 1] as Record<string, unknown>
    expect(lastEvent.name).to.equal('command_run')
    expect((lastEvent.metadata as Record<string, string>).command).to.equal('test:with-statsig')
  })

  it('multiple trackEvent calls accumulate in queue', () => {
    const { queue, stderr } = runAnalyticsScript(`
      initAnalytics('0.0.0-test');
      trackEvent('event_one', 1, { key: 'val1' });
      trackEvent('event_two', 2, { key: 'val2' });
      trackEvent('event_three', 3, { key: 'val3' });
      await shutdownAnalytics();
    `)

    expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
    expect(queue).to.have.length(3)
    expect((queue![0] as Record<string, unknown>).name).to.equal('event_one')
    expect((queue![1] as Record<string, unknown>).name).to.equal('event_two')
    expect((queue![2] as Record<string, unknown>).name).to.equal('event_three')
  })

  it('async Statsig init does not clear queue after shutdown', () => {
    const { queue, stderr } = runAnalyticsScript(`
      // Write event before init
      trackEvent('pre_init_event', null, { source: 'previous-run' });

      // Init starts async Statsig init
      initAnalytics('0.0.0-test');

      // Immediately shut down before Statsig can finish
      await shutdownAnalytics();

      // Wait to see if the async init completes and tries to flush
      await new Promise(r => setTimeout(r, 3000));
    `)

    // Events should still be on disk
    expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
    expect(queue!.length).to.be.greaterThanOrEqual(1)
  })

  it('previous run events can be flushed by next initAnalytics call', () => {
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

    const { queue, stderr } = runAnalyticsScript(`
      initAnalytics('0.0.0-test');
      // Wait for Statsig init + potential flush of previous events
      await new Promise(r => setTimeout(r, 3000));

      // Track current command
      trackCommandRun({ command: 'new:cmd', durationMs: 25, success: true, flags: [] });
      await shutdownAnalytics();
    `)

    // The current run's event should be on disk
    expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
    expect(queue!.length).to.be.greaterThanOrEqual(1)
    const hasNewEvent = queue!.some(
      (e: unknown) => (e as Record<string, unknown>).name === 'command_run' &&
        ((e as Record<string, unknown>).metadata as Record<string, string>).command === 'new:cmd',
    )
    expect(hasNewEvent).to.be.true
  })
})
