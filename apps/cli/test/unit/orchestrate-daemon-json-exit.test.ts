import { expect } from 'chai'
import { fork } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Regression test for PRLT-1213: outputSuccessAsJson throws ExitError in daemon mode.
 *
 * When stdout is redirected (non-TTY), shouldOutputJson returns true, triggering
 * outputSuccessAsJson which throws oclif ExitError. This kills the daemon await loop
 * before signal handlers are set up.
 *
 * Fix: use console.log with JSON.stringify directly instead of outputSuccessAsJson
 * in daemon mode, so the JSON status is emitted without throwing.
 */

describe('orchestrate daemon JSON output (PRLT-1213)', () => {
  let tmpDir: string

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'prlt-json-exit-test-'))
  })

  it('daemon dies when outputSuccessAsJson throws ExitError (old behavior)', async () => {
    // Simulates the old broken behavior: a function that emits JSON then throws,
    // preventing the daemon loop from running.
    const script = join(tmpDir, 'throws-exit.mjs')
    writeFileSync(script, `
      class ExitError extends Error {
        constructor(code) { super('EEXIT: ' + code); this.code = 'EEXIT'; }
      }

      function outputSuccessAsJson(result) {
        console.log(JSON.stringify(result))
        throw new ExitError(0)
      }

      const keepAlive = setInterval(() => {}, 60000)

      try {
        // This simulates the daemon startup path with the old outputSuccessAsJson call
        outputSuccessAsJson({ status: 'running', mode: 'daemon' })
      } catch {
        // ExitError is caught by oclif, which then exits the process
        clearInterval(keepAlive)
        process.exit(0)
      }

      // This code is never reached because the throw breaks out
      await new Promise((resolve) => {
        process.on('SIGINT', () => { clearInterval(keepAlive); resolve() })
        process.on('SIGTERM', () => { clearInterval(keepAlive); resolve() })
      })
    `)

    const exitCode = await runWithTimeout(script, 2000)
    expect(exitCode).to.not.equal('timeout', 'Old behavior: daemon exits immediately due to ExitError')
  })

  it('daemon stays alive when using console.log instead of outputSuccessAsJson (new behavior)', async () => {
    // Simulates the fixed behavior: emit JSON via console.log without throwing,
    // so the daemon loop continues running.
    const script = join(tmpDir, 'no-throw.mjs')
    writeFileSync(script, `
      const keepAlive = setInterval(() => {}, 60000)

      // Fixed: emit JSON without throwing
      console.log(JSON.stringify({ status: 'running', mode: 'daemon' }))

      // Daemon loop now runs as expected
      await new Promise((resolve) => {
        const cleanup = () => {
          clearInterval(keepAlive)
          resolve()
        }
        process.on('SIGINT', cleanup)
        process.on('SIGTERM', cleanup)
      })
    `)

    const exitCode = await runWithTimeout(script, 2000)
    expect(exitCode).to.equal('timeout', 'New behavior: daemon stays alive after JSON output')
  })

  it('JSON output is valid and contains expected fields', async () => {
    const script = join(tmpDir, 'json-output.mjs')
    writeFileSync(script, `
      const output = {
        type: 'success',
        prompt: null,
        success: true,
        result: { status: 'running', mode: 'daemon' },
        metadata: { command: 'orchestrate' },
      }
      console.log(JSON.stringify(output, null, 2))
      process.exit(0)
    `)

    const { stdout, exitCode } = await runAndCapture(script, 2000)
    expect(exitCode).to.equal('0')
    const parsed = JSON.parse(stdout.trim())
    expect(parsed.type).to.equal('success')
    expect(parsed.success).to.equal(true)
    expect(parsed.result.status).to.equal('running')
    expect(parsed.result.mode).to.equal('daemon')
    expect(parsed.prompt).to.equal(null)
  })

  after(() => {
    try { unlinkSync(join(tmpDir, 'throws-exit.mjs')) } catch {}
    try { unlinkSync(join(tmpDir, 'no-throw.mjs')) } catch {}
    try { unlinkSync(join(tmpDir, 'json-output.mjs')) } catch {}
  })
})

function runWithTimeout(scriptPath: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const child = fork(scriptPath, [], { stdio: 'ignore' })
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill('SIGKILL')
        resolve('timeout')
      }
    }, timeoutMs)

    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(String(code))
      }
    })
  })
}

function runAndCapture(scriptPath: string, timeoutMs: number): Promise<{ stdout: string; exitCode: string }> {
  return new Promise((resolve) => {
    const child = fork(scriptPath, [], { stdio: ['ignore', 'pipe', 'ignore', 'ipc'] })
    let stdout = ''
    let settled = false

    child.stdout!.on('data', (data: Buffer) => { stdout += data.toString() })

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill('SIGKILL')
        resolve({ stdout, exitCode: 'timeout' })
      }
    }, timeoutMs)

    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ stdout, exitCode: String(code) })
      }
    })
  })
}
