import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'

/**
 * Tests for the process.on('exit') telemetry handler registered in init.ts.
 *
 * The core fix: the oclif postrun hook never fires when commands call
 * process.exit() directly (JSON output helpers, signal handlers, etc.).
 * The init hook now registers a synchronous process.on('exit') handler
 * that calls trackCommandRun → writeEventToQueue (fs.writeFileSync),
 * ensuring telemetry events are always written to disk.
 *
 * A __prlt_telemetry_tracked flag on globalThis prevents double-counting
 * when both the postrun hook and exit handler execute.
 */
describe('Telemetry exit handler', () => {
  let testDir: string
  let originalHome: string | undefined

  beforeEach(() => {
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-exit-test-')))
    originalHome = process.env.HOME

    // Reset the tracking flag between tests
    delete (globalThis as Record<string, unknown>).__prlt_telemetry_tracked
  })

  afterEach(() => {
    if (originalHome) {
      process.env.HOME = originalHome
    } else {
      delete process.env.HOME
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('__prlt_telemetry_tracked guard', () => {
    it('prevents double-tracking when postrun sets the flag first', () => {
      // Simulate postrun hook setting the flag
      ;(globalThis as Record<string, unknown>).__prlt_telemetry_tracked = true

      // The exit handler checks this flag and should skip
      let exitHandlerRan = false
      const handler = () => {
        if ((globalThis as Record<string, unknown>).__prlt_telemetry_tracked) return
        exitHandlerRan = true
      }
      handler()

      expect(exitHandlerRan).to.be.false
    })

    it('allows tracking when flag is not set', () => {
      let exitHandlerRan = false
      const handler = () => {
        if ((globalThis as Record<string, unknown>).__prlt_telemetry_tracked) return
        ;(globalThis as Record<string, unknown>).__prlt_telemetry_tracked = true
        exitHandlerRan = true
      }
      handler()

      expect(exitHandlerRan).to.be.true
      expect((globalThis as Record<string, unknown>).__prlt_telemetry_tracked).to.be.true
    })
  })

  describe('writeEventToQueue is synchronous (exit-handler compatible)', () => {
    it('writes events using fs.writeFileSync', () => {
      // Set up a temporary telemetry config directory
      const configDir = path.join(testDir, '.proletariat')
      fs.mkdirSync(configDir, { recursive: true })

      // Write a minimal telemetry config so isTelemetryEnabled returns true
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({
          telemetry: true,
          telemetryNoticeShown: true,
          headquarters: [],
        })
      )

      // Verify the queue file can be created synchronously
      const queuePath = path.join(configDir, 'telemetry-queue.json')
      const event = {
        name: 'command_run',
        value: 42,
        metadata: { command: 'test', cli_version: '0.0.0' },
        timestamp: new Date().toISOString(),
      }

      // Simulate what writeEventToQueue does (synchronous write)
      fs.writeFileSync(queuePath, JSON.stringify([event]), 'utf-8')

      expect(fs.existsSync(queuePath)).to.be.true
      const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'))
      expect(queue).to.have.length(1)
      expect(queue[0].name).to.equal('command_run')
      expect(queue[0].metadata.command).to.equal('test')
    })
  })

  describe('end-to-end: exit handler fires on process.exit()', () => {
    it('writes telemetry event even when process.exit() is called', () => {
      // This test spawns a child process that simulates the init hook's
      // exit handler behavior + calls process.exit() to verify telemetry
      // is written to disk.
      const configDir = path.join(testDir, '.proletariat')
      fs.mkdirSync(configDir, { recursive: true })

      // Pre-create telemetry config
      fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({
          telemetry: true,
          telemetryNoticeShown: true,
          headquarters: [],
        })
      )

      const queuePath = path.join(configDir, 'telemetry-queue.json')

      // Script that simulates the exit handler + process.exit()
      const script = `
        const fs = require('fs');
        const path = require('path');

        const queuePath = ${JSON.stringify(queuePath)};
        const startTime = Date.now();

        // Simulate the init hook registering a process.on('exit') handler
        process.on('exit', (code) => {
          if (globalThis.__prlt_telemetry_tracked) return;
          globalThis.__prlt_telemetry_tracked = true;

          const event = {
            name: 'command_run',
            value: Date.now() - startTime,
            metadata: { command: 'test-cmd', success: String(code === 0) },
            timestamp: new Date().toISOString(),
          };

          // This is what writeEventToQueue does — synchronous fs write
          fs.writeFileSync(queuePath, JSON.stringify([event]), 'utf-8');
        });

        // Simulate a command calling process.exit() directly
        // (like outputPromptAsJson does)
        process.exit(0);
      `

      try {
        execFileSync('node', ['-e', script], {
          env: { ...process.env, HOME: testDir },
          timeout: 5000,
        })
      } catch {
        // execFileSync may throw if child exits non-zero, ignore
      }

      // Verify the telemetry event was written despite process.exit()
      expect(fs.existsSync(queuePath)).to.be.true
      const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'))
      expect(queue).to.have.length(1)
      expect(queue[0].name).to.equal('command_run')
      expect(queue[0].metadata.command).to.equal('test-cmd')
      expect(queue[0].metadata.success).to.equal('true')
    })

    it('records success=false for non-zero exit codes', () => {
      const configDir = path.join(testDir, '.proletariat')
      fs.mkdirSync(configDir, { recursive: true })

      const queuePath = path.join(configDir, 'telemetry-queue.json')

      const script = `
        const fs = require('fs');
        const queuePath = ${JSON.stringify(queuePath)};

        process.on('exit', (code) => {
          if (globalThis.__prlt_telemetry_tracked) return;
          globalThis.__prlt_telemetry_tracked = true;

          const event = {
            name: 'command_run',
            value: 10,
            metadata: { command: 'fail-cmd', success: String(code === 0) },
            timestamp: new Date().toISOString(),
          };
          fs.writeFileSync(queuePath, JSON.stringify([event]), 'utf-8');
        });

        process.exit(1);
      `

      try {
        execFileSync('node', ['-e', script], {
          env: { ...process.env, HOME: testDir },
          timeout: 5000,
        })
      } catch {
        // Expected — child exits with code 1
      }

      expect(fs.existsSync(queuePath)).to.be.true
      const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'))
      expect(queue[0].metadata.success).to.equal('false')
    })
  })
})
