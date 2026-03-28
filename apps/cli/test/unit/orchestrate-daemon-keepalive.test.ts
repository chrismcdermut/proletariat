import { expect } from 'chai'
import { fork } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Regression test for PRLT-1202: orchestrate daemon exits immediately.
 *
 * The bug: process.on('SIGINT'/'SIGTERM') signal listeners alone don't keep
 * the Node.js event loop alive. Without an active handle (like setInterval),
 * Node exits immediately after printing "Engine started."
 *
 * The fix: a keepalive setInterval that keeps the event loop alive until
 * cleanup is called via SIGINT/SIGTERM.
 */

describe('orchestrate daemon keepalive (PRLT-1202)', () => {
  let tmpDir: string

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'prlt-keepalive-test-'))
  })

  it('process exits immediately when only signal listeners keep the loop (old behavior)', async () => {
    // This script reproduces the bug: signal listeners alone don't keep Node alive
    const script = join(tmpDir, 'no-keepalive.mjs')
    writeFileSync(script, `
      await new Promise((resolve) => {
        process.on('SIGINT', () => { resolve(); })
        process.on('SIGTERM', () => { resolve(); })
      })
    `)

    const exitCode = await runWithTimeout(script, 2000)
    // Node exits immediately (code 0) because nothing keeps the event loop alive
    expect(exitCode).to.not.equal('timeout', 'Without keepalive, process should exit immediately')
  })

  it('process stays alive with keepalive timer (new behavior)', async () => {
    // This script uses the fix: a setInterval keeps the event loop alive
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
    // Process should still be running after 2s (we killed it via timeout)
    expect(exitCode).to.equal('timeout', 'With keepalive, process should stay alive until signaled')
  })

  it('process exits cleanly on SIGTERM with keepalive timer', async () => {
    const script = join(tmpDir, 'sigterm-cleanup.mjs')
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
      process.exit(0)
    `)

    const exitCode = await new Promise<number | null>((resolve) => {
      const child = fork(script, [], { stdio: 'ignore' })
      // Send SIGTERM after 500ms
      setTimeout(() => {
        child.kill('SIGTERM')
      }, 500)
      child.on('exit', (code) => resolve(code))
      // Safety timeout
      setTimeout(() => {
        child.kill('SIGKILL')
        resolve(null)
      }, 5000)
    })

    expect(exitCode).to.equal(0, 'Process should exit cleanly after SIGTERM')
  })

  after(() => {
    // Clean up temp files
    try { unlinkSync(join(tmpDir, 'no-keepalive.mjs')) } catch {}
    try { unlinkSync(join(tmpDir, 'with-keepalive.mjs')) } catch {}
    try { unlinkSync(join(tmpDir, 'sigterm-cleanup.mjs')) } catch {}
    try { unlinkSync(join(tmpDir, 'exit-override.mjs')) } catch {}
    try { unlinkSync(join(tmpDir, 'exit-override-nonzero.mjs')) } catch {}
    try { unlinkSync(join(tmpDir, 'exit-override-restore.mjs')) } catch {}
  })
})

/**
 * Regression test for PRLT-1211: oclif force-calls process.exit(0) despite keepalive timer.
 *
 * The bug: after the orchestrate command's run() method returns, oclif's error
 * handler calls process.exit(0) via @oclif/core/lib/errors/handle.js, which
 * kills the daemon even though it has an active keepalive timer.
 *
 * The fix: override process.exit in daemon mode so exit(0) is a no-op.
 * Non-zero exits still terminate immediately. The original is restored during
 * cleanup so the process can exit after shutdown.
 */
describe('orchestrate process.exit override (PRLT-1211)', () => {
  let tmpDir: string

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'prlt-exit-override-test-'))
  })

  it('process stays alive when process.exit(0) is called with override active', async () => {
    // Simulates oclif calling process.exit(0) after run() returns.
    // With the override, exit(0) is swallowed and the daemon stays alive.
    const script = join(tmpDir, 'exit-override.mjs')
    writeFileSync(script, `
      const keepAlive = setInterval(() => {}, 60000)

      // Override process.exit — same pattern as the orchestrate command fix
      const originalExit = process.exit
      process.exit = ((code) => {
        if (code === 0) return
        originalExit(code)
      })

      // Simulate oclif calling process.exit(0) after command completes
      setTimeout(() => { process.exit(0) }, 200)

      await new Promise((resolve) => {
        const cleanup = () => {
          clearInterval(keepAlive)
          process.exit = originalExit
          resolve()
        }
        process.on('SIGINT', cleanup)
        process.on('SIGTERM', cleanup)
      })
    `)

    const exitCode = await runWithTimeout(script, 2000)
    expect(exitCode).to.equal('timeout', 'process.exit(0) should be swallowed — daemon stays alive')
  })

  it('process still exits on non-zero exit code', async () => {
    // Non-zero exit codes must still terminate the process
    const script = join(tmpDir, 'exit-override-nonzero.mjs')
    writeFileSync(script, `
      const keepAlive = setInterval(() => {}, 60000)

      const originalExit = process.exit
      process.exit = ((code) => {
        if (code === 0) return
        originalExit(code)
      })

      // Non-zero exit should still work
      setTimeout(() => { process.exit(1) }, 200)

      await new Promise((resolve) => {
        process.on('SIGINT', () => { clearInterval(keepAlive); resolve() })
        process.on('SIGTERM', () => { clearInterval(keepAlive); resolve() })
      })
    `)

    const exitCode = await runWithTimeout(script, 2000)
    expect(exitCode).to.equal('1', 'Non-zero exit codes should still terminate the process')
  })

  it('process exits normally after cleanup restores original process.exit', async () => {
    // After SIGTERM, cleanup restores original process.exit, so exit(0) works
    const script = join(tmpDir, 'exit-override-restore.mjs')
    writeFileSync(script, `
      const keepAlive = setInterval(() => {}, 60000)

      const originalExit = process.exit
      process.exit = ((code) => {
        if (code === 0) return
        originalExit(code)
      })

      await new Promise((resolve) => {
        const cleanup = () => {
          clearInterval(keepAlive)
          process.exit = originalExit
          resolve()
        }
        process.on('SIGINT', cleanup)
        process.on('SIGTERM', cleanup)
      })
      // After cleanup restores process.exit, exit(0) terminates as expected
      process.exit(0)
    `)

    const exitCode = await new Promise((resolve) => {
      const child = fork(script, [], { stdio: 'ignore' })
      setTimeout(() => { child.kill('SIGTERM') }, 500)
      child.on('exit', (code) => resolve(code))
      setTimeout(() => { child.kill('SIGKILL'); resolve(null) }, 5000)
    })

    expect(exitCode).to.equal(0, 'After cleanup, process.exit(0) should terminate normally')
  })

  after(() => {
    try { unlinkSync(join(tmpDir, 'exit-override.mjs')) } catch {}
    try { unlinkSync(join(tmpDir, 'exit-override-nonzero.mjs')) } catch {}
    try { unlinkSync(join(tmpDir, 'exit-override-restore.mjs')) } catch {}
  })
})

/**
 * Run a script with a timeout. Returns 'timeout' if the process doesn't exit
 * within the timeout, or the exit code as a string.
 */
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
