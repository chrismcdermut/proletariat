import { expect } from 'chai'
import { fork } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Regression tests for PRLT-1202 and PRLT-1211: orchestrate daemon exits.
 *
 * PRLT-1202: signal listeners alone don't keep the Node.js event loop alive.
 * Fix: keepalive setInterval keeps the event loop running.
 *
 * PRLT-1211: oclif's error handler calls process.exit(0) after run() resolves,
 * killing the daemon even with the keepalive timer.
 * Fix: override process.exit to ignore code-0 exits while daemon is running.
 */

describe('orchestrate daemon keepalive (PRLT-1202, PRLT-1211)', () => {
  let tmpDir: string

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'prlt-keepalive-test-'))
  })

  it('process exits immediately when only signal listeners keep the loop (old behavior)', async () => {
    const script = join(tmpDir, 'no-keepalive.mjs')
    writeFileSync(script, `
      await new Promise((resolve) => {
        process.on('SIGINT', () => { resolve(); })
        process.on('SIGTERM', () => { resolve(); })
      })
    `)

    const exitCode = await runWithTimeout(script, 2000)
    expect(exitCode).to.not.equal('timeout', 'Without keepalive, process should exit immediately')
  })

  it('process stays alive with keepalive timer (new behavior)', async () => {
    const script = join(tmpDir, 'with-keepalive.mjs')
    writeFileSync(script, `
      const keepAlive = setInterval(() => {}, 60000)

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
    expect(exitCode).to.equal('timeout', 'With keepalive, process should stay alive until signaled')
  })

  it('process survives process.exit(0) when exit is overridden (PRLT-1211)', async () => {
    // Reproduces the oclif bug: after run() resolves, oclif calls process.exit(0)
    const script = join(tmpDir, 'exit-override.mjs')
    writeFileSync(script, `
      const originalExit = process.exit
      let daemonRunning = true
      process.exit = ((code) => {
        if (daemonRunning && (code === 0 || code === undefined)) return
        originalExit(code)
      })

      const keepAlive = setInterval(() => {}, 60000)

      // Simulate oclif calling process.exit(0) after run() completes
      setTimeout(() => { process.exit(0) }, 200)

      await new Promise((resolve) => {
        const cleanup = () => {
          clearInterval(keepAlive)
          daemonRunning = false
          process.exit = originalExit
          resolve()
        }
        process.on('SIGINT', cleanup)
        process.on('SIGTERM', cleanup)
      })
    `)

    const exitCode = await runWithTimeout(script, 2000)
    expect(exitCode).to.equal('timeout', 'With exit override, process.exit(0) should be intercepted')
  })

  it('process exits on non-zero exit code even with override', async () => {
    const script = join(tmpDir, 'exit-nonzero.mjs')
    writeFileSync(script, `
      const originalExit = process.exit
      let daemonRunning = true
      process.exit = ((code) => {
        if (daemonRunning && (code === 0 || code === undefined)) return
        originalExit(code)
      })

      const keepAlive = setInterval(() => {}, 60000)

      // Non-zero exits should still terminate
      setTimeout(() => { process.exit(1) }, 200)

      await new Promise((resolve) => {
        const cleanup = () => {
          clearInterval(keepAlive)
          daemonRunning = false
          process.exit = originalExit
          resolve()
        }
        process.on('SIGINT', cleanup)
        process.on('SIGTERM', cleanup)
      })
    `)

    const exitCode = await runWithTimeout(script, 2000)
    expect(exitCode).to.not.equal('timeout', 'Non-zero exit should still terminate')
    expect(exitCode).to.equal('1', 'Should exit with code 1')
  })

  it('process exits cleanly on SIGTERM with keepalive timer', async () => {
    const script = join(tmpDir, 'sigterm-cleanup.mjs')
    writeFileSync(script, `
      const originalExit = process.exit
      let daemonRunning = true
      process.exit = ((code) => {
        if (daemonRunning && (code === 0 || code === undefined)) return
        originalExit(code)
      })

      const keepAlive = setInterval(() => {}, 60000)

      await new Promise((resolve) => {
        const cleanup = () => {
          clearInterval(keepAlive)
          daemonRunning = false
          process.exit = originalExit
          resolve()
        }
        process.on('SIGINT', cleanup)
        process.on('SIGTERM', cleanup)
      })
      process.exit(0)
    `)

    const exitCode = await new Promise<number | null>((resolve) => {
      const child = fork(script, [], { stdio: 'ignore' })
      setTimeout(() => { child.kill('SIGTERM') }, 500)
      child.on('exit', (code) => resolve(code))
      setTimeout(() => {
        child.kill('SIGKILL')
        resolve(null)
      }, 5000)
    })

    expect(exitCode).to.equal(0, 'Process should exit cleanly after SIGTERM')
  })

  after(() => {
    try { unlinkSync(join(tmpDir, 'no-keepalive.mjs')) } catch {}
    try { unlinkSync(join(tmpDir, 'with-keepalive.mjs')) } catch {}
    try { unlinkSync(join(tmpDir, 'exit-override.mjs')) } catch {}
    try { unlinkSync(join(tmpDir, 'exit-nonzero.mjs')) } catch {}
    try { unlinkSync(join(tmpDir, 'sigterm-cleanup.mjs')) } catch {}
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
