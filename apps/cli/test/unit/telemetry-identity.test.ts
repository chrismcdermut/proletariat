import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'

/**
 * Tests for telemetry identity unification (PRLT-1111).
 *
 * Verifies:
 * - Host machine ID is inherited via PRLT_TELEMETRY_MACHINE_ID env var
 * - Events include telemetry_source, environment, and agent_name context
 * - Docker container creation passes PRLT_TELEMETRY_MACHINE_ID
 */

describe('Telemetry Identity (PRLT-1111)', () => {
  let testDir: string
  // Use source path (not dist/) — tests must not depend on build artifacts
  // .js extension for Node16 module resolution (ts-node/esm resolves .js → .ts)
  const analyticsPath = path.resolve(process.cwd(), 'src/lib/telemetry/analytics.js')
  const analyticsUrl = `file://${analyticsPath}`

  beforeEach(() => {
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-identity-test-')))
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  /**
   * Run an ESM script in a child process with isolated HOME and optional env vars.
   */
  function runAnalyticsScript(
    script: string,
    extraEnv?: Record<string, string>,
  ): { queue: Array<{ name: string; value?: unknown; metadata?: Record<string, string> | null; timestamp: string }> | null; telemetryConfig: Record<string, unknown> | null; stdout: string; stderr: string } {
    const configDir = path.join(testDir, '.proletariat')
    fs.mkdirSync(configDir, { recursive: true })

    const fullScript = `
const ANALYTICS_URL = ${JSON.stringify(analyticsUrl)};
const analytics = await import(ANALYTICS_URL);
const { initAnalytics, trackEvent, trackCommandRun, getMachineId, shutdownAnalytics } = analytics;
${script}
`

    const scriptPath = path.join(testDir, 'test-script.mjs')
    fs.writeFileSync(scriptPath, fullScript, 'utf-8')

    let stdout = ''
    let stderr = ''
    try {
      stdout = execFileSync('node', ['--loader', 'ts-node/esm', scriptPath], {
        env: {
          ...process.env,
          HOME: testDir,
          CI: '',
          DO_NOT_TRACK: '',
          PRLT_TELEMETRY_DISABLED: '',
          // Clear agent-related env vars by default
          PRLT_AGENT_NAME: '',
          PRLT_TELEMETRY_MACHINE_ID: '',
          ...extraEnv,
        },
        timeout: 15000,
      }).toString()
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer; stderr?: Buffer }
      stdout = e.stdout?.toString() ?? ''
      stderr = e.stderr?.toString() ?? ''
    }

    const queuePath = path.join(configDir, 'telemetry-queue.json')
    let queue: Array<{ name: string; value?: unknown; metadata?: Record<string, string> | null; timestamp: string }> | null = null
    if (fs.existsSync(queuePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(queuePath, 'utf-8'))
        queue = Array.isArray(parsed) ? parsed : null
      } catch {
        queue = null
      }
    }

    const telemetryConfigPath = path.join(configDir, 'telemetry.json')
    let telemetryConfig: Record<string, unknown> | null = null
    if (fs.existsSync(telemetryConfigPath)) {
      try {
        telemetryConfig = JSON.parse(fs.readFileSync(telemetryConfigPath, 'utf-8'))
      } catch {
        telemetryConfig = null
      }
    }

    return { queue, telemetryConfig, stdout, stderr }
  }

  // ── Machine ID Inheritance ─────────────────────────────────────────────

  describe('Machine ID inheritance from PRLT_TELEMETRY_MACHINE_ID', () => {
    it('uses inherited machine ID when PRLT_TELEMETRY_MACHINE_ID is set', () => {
      const hostMachineId = 'host-uuid-1234-5678-abcd'

      const { telemetryConfig, stderr } = runAnalyticsScript(`
        // Force telemetry config creation by calling getMachineId
        const id = getMachineId();
        // Write the ID to stdout for verification
        process.stdout.write('machineId:' + id);
      `, { PRLT_TELEMETRY_MACHINE_ID: hostMachineId })

      expect(telemetryConfig, `telemetry config should exist, stderr: ${stderr}`).to.not.be.null
      expect(telemetryConfig!.machineId).to.equal(hostMachineId)
      expect(stderr).to.equal('')
    })

    it('generates a new UUID when PRLT_TELEMETRY_MACHINE_ID is not set', () => {
      const { telemetryConfig, stderr } = runAnalyticsScript(`
        const id = getMachineId();
      `)

      expect(telemetryConfig, `telemetry config should exist, stderr: ${stderr}`).to.not.be.null
      // Should be a valid UUID v4 (not the inherited one)
      expect(telemetryConfig!.machineId).to.be.a('string')
      expect(telemetryConfig!.machineId as string).to.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
    })

    it('preserves existing machine ID when config already exists', () => {
      const existingId = 'existing-machine-id-9999'
      const configDir = path.join(testDir, '.proletariat')
      fs.mkdirSync(configDir, { recursive: true })
      fs.writeFileSync(
        path.join(configDir, 'telemetry.json'),
        JSON.stringify({
          enabled: true,
          noticeShown: true,
          machineId: existingId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      )

      const { telemetryConfig, stderr } = runAnalyticsScript(`
        const id = getMachineId();
        process.stdout.write('machineId:' + id);
      `)

      expect(telemetryConfig, `telemetry config should exist, stderr: ${stderr}`).to.not.be.null
      // Should use the existing ID, not generate a new one
      expect(telemetryConfig!.machineId).to.equal(existingId)
    })

    it('PRLT_TELEMETRY_MACHINE_ID only applies when no config exists (first run in container)', () => {
      // Pre-create config with a different ID
      const existingId = 'existing-container-id'
      const hostId = 'host-uuid-override'
      const configDir = path.join(testDir, '.proletariat')
      fs.mkdirSync(configDir, { recursive: true })
      fs.writeFileSync(
        path.join(configDir, 'telemetry.json'),
        JSON.stringify({
          enabled: true,
          noticeShown: true,
          machineId: existingId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      )

      const { telemetryConfig } = runAnalyticsScript(`
        const id = getMachineId();
      `, { PRLT_TELEMETRY_MACHINE_ID: hostId })

      // Existing config takes precedence — env var is only for first-time creation
      expect(telemetryConfig!.machineId).to.equal(existingId)
    })
  })

  // ── Source Context Properties ──────────────────────────────────────────

  describe('Telemetry source context in events', () => {
    it('tags events with telemetry_source=host when not in agent container', () => {
      const { queue, stderr } = runAnalyticsScript(`
        trackEvent('test_event', null, { custom: 'value' });
      `)

      expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
      expect(queue).to.have.length(1)
      const event = queue![0]
      expect(event.metadata?.telemetry_source).to.equal('host')
      expect(event.metadata?.runtime_environment).to.equal('host')
      expect(event.metadata).to.not.have.property('agent_name')
    })

    it('tags events with telemetry_source=agent when PRLT_AGENT_NAME is set', () => {
      const { queue, stderr } = runAnalyticsScript(`
        trackEvent('test_event', null, { custom: 'value' });
      `, { PRLT_AGENT_NAME: 'test-agent-alpha' })

      expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
      expect(queue).to.have.length(1)
      const event = queue![0]
      expect(event.metadata?.telemetry_source).to.equal('agent')
      expect(event.metadata?.runtime_environment).to.equal('docker')
      expect(event.metadata?.agent_name).to.equal('test-agent-alpha')
    })

    it('includes source context in trackCommandRun events', () => {
      const { queue, stderr } = runAnalyticsScript(`
        trackCommandRun({ command: 'work:start', durationMs: 100, success: true, flags: [] });
      `, { PRLT_AGENT_NAME: 'my-agent' })

      expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
      const event = queue![0]
      expect(event.metadata?.telemetry_source).to.equal('agent')
      expect(event.metadata?.runtime_environment).to.equal('docker')
      expect(event.metadata?.agent_name).to.equal('my-agent')
      // Original metadata should still be present
      expect(event.metadata?.command).to.equal('work:start')
    })

    it('includes source context even when no metadata is provided', () => {
      const { queue, stderr } = runAnalyticsScript(`
        trackEvent('simple_event');
      `)

      expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
      const event = queue![0]
      expect(event.metadata?.telemetry_source).to.equal('host')
      expect(event.metadata?.runtime_environment).to.equal('host')
    })
  })

  // ── Docker env var passthrough ─────────────────────────────────────────

  describe('Docker container PRLT_TELEMETRY_MACHINE_ID passthrough', () => {
    it('createDockerContainer imports getMachineId from analytics', async () => {
      // Verify the import relationship exists by checking the source
      const dockerMgmtPath = path.resolve(process.cwd(), 'src/lib/execution/runners/docker-management.ts')
      const content = fs.readFileSync(dockerMgmtPath, 'utf-8')
      expect(content).to.include('getMachineId')
      expect(content).to.include('PRLT_TELEMETRY_MACHINE_ID')
    })
  })
})
