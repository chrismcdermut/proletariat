import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'

/**
 * Tests for telemetry identity unification (PRLT-1111, PRLT-1355).
 *
 * Verifies:
 * - Host machine ID is inherited via PRLT_TELEMETRY_MACHINE_ID env var
 * - Stable fingerprint fallback (hostname + username hash) instead of random UUID
 * - Events include telemetry_source, environment, agent_name, and agent context
 * - Docker container creation passes PRLT_TELEMETRY_MACHINE_ID
 * - Orchestrator container passes PRLT_TELEMETRY_MACHINE_ID
 */

describe('Telemetry Identity (PRLT-1111, PRLT-1355)', () => {
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
const { initAnalytics, trackEvent, trackCommandRun, getMachineId, generateStableFingerprint, shutdownAnalytics } = analytics;
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

    it('generates a stable fingerprint when PRLT_TELEMETRY_MACHINE_ID is not set', () => {
      const { telemetryConfig, stderr } = runAnalyticsScript(`
        const id = getMachineId();
      `)

      expect(telemetryConfig, `telemetry config should exist, stderr: ${stderr}`).to.not.be.null
      // Should be a UUID-shaped hex string (stable fingerprint, not random)
      expect(telemetryConfig!.machineId).to.be.a('string')
      expect(telemetryConfig!.machineId as string).to.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
    })

    it('produces the same fingerprint across multiple runs (deterministic)', () => {
      // Run 1: generate the machine ID
      const { telemetryConfig: config1, stderr: stderr1 } = runAnalyticsScript(`
        const id = getMachineId();
        process.stdout.write('machineId:' + id);
      `)
      expect(config1, `run 1 config should exist, stderr: ${stderr1}`).to.not.be.null

      // Run 2: generate again (fresh process, no existing config)
      const { telemetryConfig: config2, stderr: stderr2 } = runAnalyticsScript(`
        const id = getMachineId();
        process.stdout.write('machineId:' + id);
      `)
      expect(config2, `run 2 config should exist, stderr: ${stderr2}`).to.not.be.null

      // Same host + username → same fingerprint
      expect(config1!.machineId).to.equal(config2!.machineId)
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
    it('tags events with telemetry_source=host and agent=false when not in agent container', () => {
      const { queue, stderr } = runAnalyticsScript(`
        trackEvent('test_event', null, { custom: 'value' });
      `)

      expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
      expect(queue).to.have.length(1)
      const event = queue![0]
      expect(event.metadata?.telemetry_source).to.equal('host')
      expect(event.metadata?.runtime_environment).to.equal('host')
      expect(event.metadata?.agent).to.equal('false')
      expect(event.metadata).to.not.have.property('agent_name')
    })

    it('tags events with telemetry_source=agent and agent=true when PRLT_AGENT_NAME is set', () => {
      const { queue, stderr } = runAnalyticsScript(`
        trackEvent('test_event', null, { custom: 'value' });
      `, { PRLT_AGENT_NAME: 'test-agent-alpha' })

      expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
      expect(queue).to.have.length(1)
      const event = queue![0]
      expect(event.metadata?.telemetry_source).to.equal('agent')
      expect(event.metadata?.runtime_environment).to.equal('docker')
      expect(event.metadata?.agent).to.equal('true')
      expect(event.metadata?.agent_name).to.equal('test-agent-alpha')
    })

    it('includes source context with agent=true in trackCommandRun events', () => {
      const { queue, stderr } = runAnalyticsScript(`
        trackCommandRun({ command: 'work:start', durationMs: 100, success: true, flags: [] });
      `, { PRLT_AGENT_NAME: 'my-agent' })

      expect(queue, `queue should exist, stderr: ${stderr}`).to.not.be.null
      const event = queue![0]
      expect(event.metadata?.telemetry_source).to.equal('agent')
      expect(event.metadata?.runtime_environment).to.equal('docker')
      expect(event.metadata?.agent).to.equal('true')
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

  // ── Stable fingerprint ─────────────────────────────────────────────────

  describe('Stable fingerprint (PRLT-1355)', () => {
    it('generateStableFingerprint returns a UUID-shaped deterministic string', () => {
      const { stdout, stderr } = runAnalyticsScript(`
        const fp = generateStableFingerprint();
        process.stdout.write('fp:' + fp);
      `)

      expect(stderr).to.equal('')
      const fp = stdout.split('fp:')[1]
      expect(fp).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('generateStableFingerprint is deterministic across calls', () => {
      const { stdout: stdout1 } = runAnalyticsScript(`
        const fp = generateStableFingerprint();
        process.stdout.write('fp:' + fp);
      `)
      const { stdout: stdout2 } = runAnalyticsScript(`
        const fp = generateStableFingerprint();
        process.stdout.write('fp:' + fp);
      `)

      const fp1 = stdout1.split('fp:')[1]
      const fp2 = stdout2.split('fp:')[1]
      expect(fp1).to.equal(fp2)
    })

    it('fallback uses stable fingerprint instead of random UUID when no env var set', () => {
      // Run twice without PRLT_TELEMETRY_MACHINE_ID — both should produce the same machine ID
      const { telemetryConfig: config1 } = runAnalyticsScript(`
        getMachineId();
      `)
      const { telemetryConfig: config2 } = runAnalyticsScript(`
        getMachineId();
      `)

      expect(config1!.machineId).to.equal(config2!.machineId)
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

  // ── Orchestrator env var passthrough (PRLT-1355) ──────────────────────

  describe('Orchestrator container PRLT_TELEMETRY_MACHINE_ID passthrough (PRLT-1355)', () => {
    it('orchestrator runner imports getMachineId and passes PRLT_TELEMETRY_MACHINE_ID', () => {
      const orchestratorPath = path.resolve(process.cwd(), 'src/lib/execution/runners/orchestrator.ts')
      const content = fs.readFileSync(orchestratorPath, 'utf-8')
      expect(content).to.include('getMachineId')
      expect(content).to.include('PRLT_TELEMETRY_MACHINE_ID')
    })
  })
})
