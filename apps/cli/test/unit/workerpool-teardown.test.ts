/**
 * Regression tests for PRLT-1247: workerpool uncaught error in mocha parallel mode.
 *
 * Validates the three-layer defense against workerpool teardown errors:
 * 1. .mocharc.json: exit flag forces clean shutdown
 * 2. worker-graceful-exit.ts: root hook plugin handles signals/exceptions in workers
 * 3. run-mocha.sh: safety-net wrapper suppresses workerpool errors in output
 *
 * The workerpool error occurs when mocha parallel workers exit non-gracefully
 * during pool termination. WorkerHandler.js:251 fires when a child process
 * exits with a non-zero code, reporting "Uncaught error outside test suite".
 * See: https://github.com/mochajs/mocha/issues/4720
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_ROOT = path.resolve(__dirname, '../..')

describe('workerpool teardown fix (PRLT-1247)', () => {
  // ──────────────────────────────────────────────
  // Layer 1: .mocharc.json configuration
  // ──────────────────────────────────────────────
  describe('.mocharc.json — mocha exit flag', () => {
    let config: Record<string, unknown>

    before(() => {
      const configPath = path.join(CLI_ROOT, '.mocharc.json')
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    })

    it('should have exit: true to force clean process shutdown', () => {
      expect(config.exit).to.equal(
        true,
        'exit must be true — without it, mocha waits for handles to close, creating a race condition during workerpool teardown'
      )
    })

    it('should require worker-graceful-exit.ts setup file', () => {
      const requireList = config.require as string[]
      expect(requireList).to.be.an('array')
      expect(requireList).to.include(
        'test/setup/worker-graceful-exit.ts',
        'worker-graceful-exit.ts must be in the require list for mocha to load the root hook plugin'
      )
    })

    it('should have parallel: true with jobs configured', () => {
      expect(config.parallel).to.equal(true)
      expect(config.jobs).to.be.a('number').and.to.be.greaterThan(0)
    })
  })

  // ──────────────────────────────────────────────
  // Layer 2: worker-graceful-exit.ts root hook plugin
  // ──────────────────────────────────────────────
  describe('worker-graceful-exit.ts — root hook plugin', () => {
    it('should exist at test/setup/worker-graceful-exit.ts', () => {
      const pluginPath = path.join(CLI_ROOT, 'test/setup/worker-graceful-exit.ts')
      expect(fs.existsSync(pluginPath)).to.be.true
    })

    it('should export mochaHooks with afterAll', async () => {
      const mod = await import('../setup/worker-graceful-exit.js')
      expect(mod.mochaHooks).to.be.an('object')
      expect(mod.mochaHooks.afterAll).to.be.a('function')
    })
  })

  // ──────────────────────────────────────────────
  // Layer 3: run-mocha.sh safety-net wrapper
  // ──────────────────────────────────────────────
  describe('run-mocha.sh — error suppression logic', () => {
    let scriptContent: string

    before(() => {
      const scriptPath = path.join(CLI_ROOT, 'test/run-mocha.sh')
      scriptContent = fs.readFileSync(scriptPath, 'utf-8')
    })

    it('should exist and be executable', () => {
      const scriptPath = path.join(CLI_ROOT, 'test/run-mocha.sh')
      expect(fs.existsSync(scriptPath)).to.be.true
      // Check file has execute permission
      const stat = fs.statSync(scriptPath)
      const isExecutable = (stat.mode & 0o111) !== 0
      expect(isExecutable, 'run-mocha.sh must be executable').to.be.true
    })

    it('should strip ANSI color codes before pattern matching', () => {
      expect(scriptContent).to.include(
        'sed',
        'Must strip ANSI codes — CI and chalk emit color codes that break grep patterns'
      )
      // Should reference ANSI escape sequence stripping
      expect(scriptContent).to.match(
        /\\x1b|\\033|\\e/,
        'Must contain ANSI escape sequence pattern for stripping'
      )
    })

    it('should count workerpool errors separately from total failures', () => {
      // Must grep for workerpool stack traces independently
      expect(scriptContent).to.include(
        'WORKERPOOL_ERRORS',
        'Must count workerpool errors separately to handle multiple worker crashes'
      )
    })

    it('should suppress when ALL failures are workerpool errors (not just exactly 1)', () => {
      // The old logic checked FAILING_COUNT = "1", which broke with 2+ parallel workers.
      // The new logic checks WORKERPOOL_ERRORS >= FAILING_COUNT.
      expect(scriptContent).to.not.match(
        /FAILING_COUNT.*=.*"1"/,
        'Must NOT check for exactly 1 failure — with 2+ parallel workers, multiple workerpool errors can occur'
      )
      expect(scriptContent).to.include(
        'WORKERPOOL_ERRORS',
        'Must compare workerpool error count against total failures'
      )
    })

    // Functional test: verify the suppression logic works with mock output.
    // Uses temp files to avoid shell escaping issues with special characters
    // in the mock mocha output (quotes, parentheses, ANSI codes, etc.).
    describe('suppression logic — functional tests', () => {
      const tmpDir = path.join(os.tmpdir(), `prlt-workerpool-test-${process.pid}`)

      before(() => {
        fs.mkdirSync(tmpDir, { recursive: true })
      })

      after(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      })

      function runSuppressionScript(mochaOutput: string, mochaExitCode: number): { exitCode: number; stdout: string } {
        // Write mock output to a temp file to avoid shell escaping issues
        const outputFile = path.join(tmpDir, `output-${Date.now()}.txt`)
        fs.writeFileSync(outputFile, mochaOutput)

        // Write the suppression logic as a standalone script (mirrors run-mocha.sh logic)
        const scriptFile = path.join(tmpDir, `test-${Date.now()}.sh`)
        fs.writeFileSync(scriptFile, [
          '#!/usr/bin/env bash',
          `OUTPUT=$(cat "${outputFile}")`,
          `EXIT_CODE=${mochaExitCode}`,
          '',
          'if [ "$EXIT_CODE" -ne 0 ]; then',
          '  CLEAN_OUTPUT=$(echo "$OUTPUT" | sed \'s/\\x1b\\[[0-9;]*m//g\' 2>/dev/null || echo "$OUTPUT")',
          '  FAILING_COUNT=$(echo "$CLEAN_OUTPUT" | grep -o \'[0-9][0-9]* failing\' | head -1 | grep -o \'[0-9][0-9]*\' || echo "0")',
          '  WORKERPOOL_ERRORS=$(echo "$CLEAN_OUTPUT" | grep -c "objectToError.*WorkerHandler" || echo "0")',
          '',
          '  if [ "$FAILING_COUNT" -gt 0 ] 2>/dev/null && \\',
          '     [ "$WORKERPOOL_ERRORS" -ge "$FAILING_COUNT" ] 2>/dev/null && \\',
          '     echo "$CLEAN_OUTPUT" | grep -q "Uncaught error outside test suite"; then',
          '    echo "SUPPRESSED"',
          '    exit 0',
          '  fi',
          '  exit "$EXIT_CODE"',
          'fi',
        ].join('\n'))
        fs.chmodSync(scriptFile, 0o755)

        try {
          const stdout = execSync(`bash "${scriptFile}"`, {
            encoding: 'utf-8',
            timeout: 5000,
          })
          return { exitCode: 0, stdout: stdout.trim() }
        } catch (err: unknown) {
          const execErr = err as { status: number; stdout: string }
          return { exitCode: execErr.status, stdout: (execErr.stdout || '').trim() }
        }
      }

      const SINGLE_WORKERPOOL_ERROR = [
        '  120 passing (15s)',
        '  1 failing',
        '',
        '  1) "after all" hook in "{root}":',
        '     Uncaught error outside test suite',
        '',
        '      Error',
        '        at objectToError (node_modules/workerpool/src/WorkerHandler.js:185:14)',
        '        at ChildProcess.<anonymous> (node_modules/workerpool/src/WorkerHandler.js:251:34)',
      ].join('\n')

      const DUAL_WORKERPOOL_ERRORS = [
        '  120 passing (15s)',
        '  2 failing',
        '',
        '  1) "after all" hook in "{root}":',
        '     Uncaught error outside test suite',
        '',
        '      Error',
        '        at objectToError (node_modules/workerpool/src/WorkerHandler.js:185:14)',
        '        at ChildProcess.<anonymous> (node_modules/workerpool/src/WorkerHandler.js:251:34)',
        '',
        '  2) "after all" hook in "{root}":',
        '     Uncaught error outside test suite',
        '',
        '      Error',
        '        at objectToError (node_modules/workerpool/src/WorkerHandler.js:185:14)',
        '        at ChildProcess.<anonymous> (node_modules/workerpool/src/WorkerHandler.js:251:34)',
      ].join('\n')

      const MIXED_REAL_AND_WORKERPOOL = [
        '  119 passing (15s)',
        '  2 failing',
        '',
        '  1) MyTest should work:',
        '     AssertionError: expected true to equal false',
        '',
        '  2) "after all" hook in "{root}":',
        '     Uncaught error outside test suite',
        '',
        '      Error',
        '        at objectToError (node_modules/workerpool/src/WorkerHandler.js:185:14)',
        '        at ChildProcess.<anonymous> (node_modules/workerpool/src/WorkerHandler.js:251:34)',
      ].join('\n')

      const ANSI_COLORED_OUTPUT = [
        '  \x1b[92m120 passing\x1b[0m (15s)',
        '  \x1b[31m1 failing\x1b[0m',
        '',
        '  1) "after all" hook in "{root}":',
        '     \x1b[31mUncaught error outside test suite\x1b[0m',
        '',
        '      \x1b[31mError\x1b[0m',
        '        at objectToError (node_modules/workerpool/src/WorkerHandler.js:185:14)',
        '        at ChildProcess.<anonymous> (node_modules/workerpool/src/WorkerHandler.js:251:34)',
      ].join('\n')

      it('should suppress 1 workerpool error', () => {
        const result = runSuppressionScript(SINGLE_WORKERPOOL_ERROR, 1)
        expect(result.exitCode).to.equal(0, 'Single workerpool error should be suppressed')
        expect(result.stdout).to.include('SUPPRESSED')
      })

      it('should suppress 2 workerpool errors (both workers crash)', () => {
        const result = runSuppressionScript(DUAL_WORKERPOOL_ERRORS, 1)
        expect(result.exitCode).to.equal(0, 'Multiple workerpool errors should be suppressed when ALL failures are workerpool')
        expect(result.stdout).to.include('SUPPRESSED')
      })

      it('should NOT suppress mixed real + workerpool failures', () => {
        const result = runSuppressionScript(MIXED_REAL_AND_WORKERPOOL, 1)
        expect(result.exitCode).to.not.equal(0, 'Must NOT suppress when there are real test failures alongside workerpool errors')
      })

      it('should handle ANSI color codes in output', () => {
        const result = runSuppressionScript(ANSI_COLORED_OUTPUT, 1)
        expect(result.exitCode).to.equal(0, 'ANSI color codes should be stripped before pattern matching')
        expect(result.stdout).to.include('SUPPRESSED')
      })

      it('should pass through clean runs (exit code 0)', () => {
        const result = runSuppressionScript('  120 passing (15s)', 0)
        expect(result.exitCode).to.equal(0)
      })
    })
  })

  // ──────────────────────────────────────────────
  // Integration: all test scripts use run-mocha.sh
  // ──────────────────────────────────────────────
  describe('package.json — test scripts use run-mocha.sh wrapper', () => {
    let packageJson: Record<string, unknown>

    before(() => {
      packageJson = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf-8'))
    })

    it('test script should use run-mocha.sh', () => {
      const scripts = packageJson.scripts as Record<string, string>
      expect(scripts.test).to.include('run-mocha.sh')
    })

    it('test:unit script should use run-mocha.sh', () => {
      const scripts = packageJson.scripts as Record<string, string>
      expect(scripts['test:unit']).to.include('run-mocha.sh')
    })

    it('test:e2e script should use run-mocha.sh', () => {
      const scripts = packageJson.scripts as Record<string, string>
      expect(scripts['test:e2e']).to.include('run-mocha.sh')
    })
  })
})
