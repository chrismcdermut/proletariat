import { expect } from 'chai'
import { fork } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Regression tests for PRLT-1305: prlt watch dies immediately.
 *
 * Same root cause as PRLT-1202 / PRLT-1211: oclif calls process.exit(0)
 * after run() resolves, killing the daemon before the first poll fires.
 *
 * Fix: override process.exit to ignore code-0 exits while the watch daemon
 * is running, and restore on cleanup (SIGINT/SIGTERM).
 */

describe('watch daemon keepalive (PRLT-1305)', () => {
  let tmpDir: string

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'prlt-watch-keepalive-test-'))
  })

  it('watch daemon survives process.exit(0) with the PRLT-1211 workaround', async () => {
    // Simulates the watch daemon pattern: keepalive + exit override + poll timer
    const script = join(tmpDir, 'watch-daemon.mjs')
    writeFileSync(script, `
      // PRLT-1211 workaround: override process.exit
      const originalExit = process.exit
      let daemonRunning = true
      process.exit = ((code) => {
        if (daemonRunning && (code === 0 || code === undefined)) return
        originalExit(code)
      })

      // Keepalive timer (same as watch command)
      const keepAlive = setInterval(() => {}, 60000)

      // Poll timer (simulates the watch poll loop)
      let pollCount = 0
      const pollTimer = setInterval(() => {
        pollCount++
        // Signal we completed a poll by writing to stdout
        process.stdout.write('poll:' + pollCount + '\\n')
      }, 100)

      // Simulate oclif calling process.exit(0) after run() completes
      setTimeout(() => { process.exit(0) }, 200)

      // Graceful shutdown
      await new Promise((resolve) => {
        const cleanup = () => {
          clearInterval(pollTimer)
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
    expect(exitCode).to.equal('timeout', 'Watch daemon should stay alive despite process.exit(0)')
  })

  it('watch daemon without exit override dies on process.exit(0)', async () => {
    // Demonstrates the bug: without the override, oclif's process.exit(0) kills the daemon
    const script = join(tmpDir, 'watch-no-override.mjs')
    writeFileSync(script, `
      const keepAlive = setInterval(() => {}, 60000)

      // No exit override — oclif's process.exit(0) will kill us
      setTimeout(() => { process.exit(0) }, 200)

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
    expect(exitCode).to.not.equal('timeout', 'Without exit override, process.exit(0) should kill the daemon')
    expect(exitCode).to.equal('0')
  })

  it('watch daemon completes poll cycles before being killed by process.exit(0)', async () => {
    // Verifies the daemon actually polls (doesn't just stay alive doing nothing)
    const script = join(tmpDir, 'watch-polls.mjs')
    writeFileSync(script, `
      const originalExit = process.exit
      let daemonRunning = true
      process.exit = ((code) => {
        if (daemonRunning && (code === 0 || code === undefined)) return
        originalExit(code)
      })

      const keepAlive = setInterval(() => {}, 60000)

      let pollCount = 0
      const pollTimer = setInterval(() => {
        pollCount++
        process.stdout.write('poll:' + pollCount + '\\n')
        if (pollCount >= 3) {
          // After 3 polls, clean exit
          clearInterval(pollTimer)
          clearInterval(keepAlive)
          daemonRunning = false
          process.exit = originalExit
          process.exit(0)
        }
      }, 100)

      // Simulate oclif calling process.exit(0) — should be intercepted
      setTimeout(() => { process.exit(0) }, 50)
    `)

    const { exitCode, stdout } = await runWithOutput(script, 3000)
    const polls = stdout.trim().split('\n').filter((l) => l.startsWith('poll:'))
    expect(polls.length).to.be.greaterThanOrEqual(3, 'Should complete at least 3 poll cycles')
    expect(exitCode).to.equal('0', 'Should exit cleanly after polls complete')
  })

  it('watch daemon exits on non-zero exit code even with override', async () => {
    const script = join(tmpDir, 'watch-nonzero.mjs')
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

  it('watch daemon exits cleanly on SIGTERM', async () => {
    const script = join(tmpDir, 'watch-sigterm.mjs')
    writeFileSync(script, `
      const originalExit = process.exit
      let daemonRunning = true
      process.exit = ((code) => {
        if (daemonRunning && (code === 0 || code === undefined)) return
        originalExit(code)
      })

      const keepAlive = setInterval(() => {}, 60000)

      // Simulate oclif calling process.exit(0)
      setTimeout(() => { process.exit(0) }, 100)

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

  it('watch daemon exits cleanly on SIGINT', async () => {
    const script = join(tmpDir, 'watch-sigint.mjs')
    writeFileSync(script, `
      const originalExit = process.exit
      let daemonRunning = true
      process.exit = ((code) => {
        if (daemonRunning && (code === 0 || code === undefined)) return
        originalExit(code)
      })

      const keepAlive = setInterval(() => {}, 60000)

      // Simulate oclif calling process.exit(0)
      setTimeout(() => { process.exit(0) }, 100)

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
      setTimeout(() => { child.kill('SIGINT') }, 500)
      child.on('exit', (code) => resolve(code))
      setTimeout(() => {
        child.kill('SIGKILL')
        resolve(null)
      }, 5000)
    })

    expect(exitCode).to.equal(0, 'Process should exit cleanly after SIGINT')
  })

  // PRLT-1328: Regression — daemon poll produces visible output
  it('daemon poll loop produces output visible in tmux pane (verbose mode)', async () => {
    // In daemon mode, --verbose is always included so users can verify polls
    // are firing by looking at the tmux pane output. Without --verbose, polls
    // that find no changes produce zero output, making the daemon appear dead.
    const script = join(tmpDir, 'watch-verbose-polls.mjs')
    writeFileSync(script, `
      const originalExit = process.exit
      let daemonRunning = true
      process.exit = ((code) => {
        if (daemonRunning && (code === 0 || code === undefined)) return
        originalExit(code)
      })

      const keepAlive = setInterval(() => {}, 60000)

      // Simulate verbose poll loop (as daemon would run with --verbose)
      const verbose = true // PRLT-1328: daemon always includes --verbose
      let pollCount = 0
      const pollTimer = setInterval(() => {
        pollCount++
        // In verbose mode, every poll produces output — even when no changes
        if (verbose) {
          process.stdout.write('verbose:poll:' + pollCount + '\\n')
        }
        if (pollCount >= 3) {
          clearInterval(pollTimer)
          clearInterval(keepAlive)
          daemonRunning = false
          process.exit = originalExit
          process.exit(0)
        }
      }, 100)

      // Simulate oclif calling process.exit(0)
      setTimeout(() => { process.exit(0) }, 50)
    `)

    const { exitCode, stdout } = await runWithOutput(script, 3000)
    const verboseLines = stdout.trim().split('\n').filter((l) => l.startsWith('verbose:poll:'))
    expect(verboseLines.length).to.be.greaterThanOrEqual(3, 'Verbose mode should produce output for every poll')
    expect(exitCode).to.equal('0')
  })

  after(() => {
    const files = [
      'watch-daemon.mjs', 'watch-no-override.mjs', 'watch-polls.mjs',
      'watch-nonzero.mjs', 'watch-sigterm.mjs', 'watch-sigint.mjs',
      'watch-verbose-polls.mjs',
    ]
    for (const f of files) {
      try { unlinkSync(join(tmpDir, f)) } catch {}
    }
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

function runWithOutput(scriptPath: string, timeoutMs: number): Promise<{ exitCode: string; stdout: string }> {
  return new Promise((resolve) => {
    const child = fork(scriptPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
    let settled = false
    let stdout = ''

    child.stdout?.on('data', (data) => { stdout += data.toString() })

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill('SIGKILL')
        resolve({ exitCode: 'timeout', stdout })
      }
    }, timeoutMs)

    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ exitCode: String(code), stdout })
      }
    })
  })
}
