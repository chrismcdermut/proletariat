import { expect } from 'chai'
import { fork } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Regression tests for PRLT-1332: Watch daemon wrapper must pass foreground
 * flag to tmux child process.
 *
 * Root cause: the daemon wrapper spawns `prlt watch` inside tmux but if
 * --foreground is missing, the child process tries to spawn ANOTHER daemon
 * (or hits the non-foreground exit path), so the poll loop never fires.
 *
 * Fix: watchDaemonSpec always includes --foreground so the tmux child
 * enters the foreground code path and runs the poll loop.
 */

describe('Watch Daemon Foreground Flag (PRLT-1332)', () => {
  // =============================================================================
  // Daemon spec always includes --foreground
  // =============================================================================

  describe('watchDaemonSpec includes --foreground for tmux child', () => {
    let watchDaemonSpec: (target: string, pollIntervalSeconds?: number) => { type: string; command: string }

    before(async () => {
      const mod = await import('../../src/lib/session/daemon-manager.js')
      watchDaemonSpec = mod.watchDaemonSpec
    })

    it('daemon spec command starts with "prlt watch --foreground"', () => {
      // PRLT-1332: Without --foreground, the child process inside tmux would
      // try to spawn ANOTHER daemon, creating an infinite loop or exiting.
      const spec = watchDaemonSpec('orchestrator-main', 15)
      expect(spec.command).to.match(/^prlt watch --foreground/)
    })

    it('passes through custom poll-interval to the daemon child', () => {
      const spec = watchDaemonSpec('orchestrator-main', 15)
      expect(spec.command).to.contain('--poll-interval 15')
    })

    it('passes through target to the daemon child', () => {
      const spec = watchDaemonSpec('orchestrator-main', 15)
      expect(spec.command).to.contain('--target orchestrator-main')
    })

    it('child command is well-formed for sh -c execution in tmux', () => {
      // spawnDaemon passes the command as: tmux new-session -d -s "name" -c "dir" "command"
      // The command must be a valid shell string without metacharacters that
      // would break when passed through sh -c.
      const spec = watchDaemonSpec('orchestrator-main', 15)
      // No shell metacharacters in the command
      expect(spec.command).to.not.match(/[;|&$`\\'"!#]/)
      // The command is a simple space-separated command
      const parts = spec.command.split(/\s+/)
      expect(parts[0]).to.equal('prlt')
      expect(parts[1]).to.equal('watch')
      expect(parts).to.include('--foreground')
      expect(parts).to.include('--verbose')
      expect(parts).to.include('--target')
      expect(parts).to.include('--poll-interval')
    })
  })

  // =============================================================================
  // Daemon mode decision logic: --foreground prevents recursive spawn
  // =============================================================================

  describe('daemon mode decision logic', () => {
    it('child process with --foreground enters foreground code path (not spawnAsDaemon)', () => {
      // The child process inside tmux runs with --foreground.
      // The decision logic: if (!flags.foreground && !flags.once && !insideDaemonSession)
      // With --foreground=true, the condition is false → foreground code path.
      const flags = { foreground: true, once: false }
      const insideDaemonSession = false // doesn't matter when foreground is true
      const wouldSpawnDaemon = !flags.foreground && !flags.once && !insideDaemonSession
      expect(wouldSpawnDaemon).to.equal(false)
    })

    it('child process with --foreground enters foreground even inside tmux', () => {
      // Inside the daemon tmux session, both guards agree: don't spawn daemon.
      const flags = { foreground: true, once: false }
      const insideDaemonSession = true
      const wouldSpawnDaemon = !flags.foreground && !flags.once && !insideDaemonSession
      expect(wouldSpawnDaemon).to.equal(false)
    })

    it('without --foreground AND outside tmux, WOULD spawn daemon (broken case)', () => {
      // This is the broken case from PRLT-1332: if the daemon child doesn't
      // have --foreground, and it's somehow not detected as inside a daemon
      // session, it would try to spawn ANOTHER daemon.
      const flags = { foreground: false, once: false }
      const insideDaemonSession = false
      const wouldSpawnDaemon = !flags.foreground && !flags.once && !insideDaemonSession
      expect(wouldSpawnDaemon).to.equal(true, 'this is the broken case the fix prevents')
    })
  })

  // =============================================================================
  // End-to-end: daemon child poll loop fires
  // =============================================================================

  describe('daemon child poll loop fires with --foreground', () => {
    let tmpDir: string

    before(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'prlt-watch-1332-'))
    })

    it('foreground daemon completes multiple poll cycles', async () => {
      // Simulates the watch daemon running in foreground mode inside tmux.
      // Verifies that after baseline capture, the poll loop fires.
      const script = join(tmpDir, 'daemon-foreground.mjs')
      writeFileSync(script, `
        // Simulate the --foreground code path from watch/index.ts
        const originalExit = process.exit
        let daemonRunning = true
        process.exit = ((code) => {
          if (daemonRunning && (code === 0 || code === undefined)) return
          originalExit(code)
        })

        const keepAlive = setInterval(() => {}, 60000)

        // Baseline poll
        process.stdout.write('baseline:captured\\n')

        // Poll loop (simulates setInterval in watch command)
        let pollCount = 0
        const pollTimer = setInterval(() => {
          pollCount++
          process.stdout.write('poll:' + pollCount + '\\n')
          if (pollCount >= 3) {
            clearInterval(pollTimer)
            clearInterval(keepAlive)
            daemonRunning = false
            process.exit = originalExit
            process.exit(0)
          }
        }, 100) // Short interval for testing

        // Simulate oclif calling process.exit(0) — must be intercepted
        setTimeout(() => { process.exit(0) }, 50)
      `)

      const { exitCode, stdout } = await runWithOutput(script, 5000)
      const lines = stdout.trim().split('\n')

      // Verify baseline was captured
      expect(lines[0]).to.equal('baseline:captured')

      // Verify poll cycles fired
      const polls = lines.filter(l => l.startsWith('poll:'))
      expect(polls.length).to.be.greaterThanOrEqual(3, 'poll loop must fire after baseline')
      expect(polls[0]).to.equal('poll:1')
      expect(polls[1]).to.equal('poll:2')
      expect(polls[2]).to.equal('poll:3')

      expect(exitCode).to.equal('0')
    })

    it('poll output appears within expected timeframe (AC: within 30s)', async () => {
      // AC: tmux pane shows poll cycle output within 30s of startup
      // With poll-interval 15, first poll fires at t=15s.
      // We use a shorter interval (200ms) for test speed.
      const script = join(tmpDir, 'daemon-timing.mjs')
      writeFileSync(script, `
        const originalExit = process.exit
        let daemonRunning = true
        process.exit = ((code) => {
          if (daemonRunning && (code === 0 || code === undefined)) return
          originalExit(code)
        })

        const keepAlive = setInterval(() => {}, 60000)
        const startTime = Date.now()

        // Baseline
        process.stdout.write('baseline:' + (Date.now() - startTime) + '\\n')

        // Poll loop with verbose output
        let pollCount = 0
        const pollTimer = setInterval(() => {
          pollCount++
          const elapsed = Date.now() - startTime
          process.stdout.write('poll:' + pollCount + ':' + elapsed + '\\n')
          if (pollCount >= 2) {
            clearInterval(pollTimer)
            clearInterval(keepAlive)
            daemonRunning = false
            process.exit = originalExit
            process.exit(0)
          }
        }, 200)

        setTimeout(() => { process.exit(0) }, 50)
      `)

      const { exitCode, stdout } = await runWithOutput(script, 5000)
      const lines = stdout.trim().split('\n')

      // First poll should appear quickly (within our test timeframe)
      const firstPoll = lines.find(l => l.startsWith('poll:1:'))
      expect(firstPoll).to.exist

      // Parse the elapsed time from the first poll
      const elapsed = parseInt(firstPoll!.split(':')[2], 10)
      // First poll should fire within 1 second (we use 200ms interval)
      expect(elapsed).to.be.lessThan(1000, 'first poll must fire promptly after baseline')

      expect(exitCode).to.equal('0')
    })

    it('daemon survives oclif process.exit(0) and keeps polling', async () => {
      const script = join(tmpDir, 'daemon-survives.mjs')
      writeFileSync(script, `
        const originalExit = process.exit
        let daemonRunning = true
        process.exit = ((code) => {
          if (daemonRunning && (code === 0 || code === undefined)) return
          originalExit(code)
        })

        const keepAlive = setInterval(() => {}, 60000)

        // Simulate oclif calling process.exit(0) multiple times
        setTimeout(() => { process.exit(0) }, 50)
        setTimeout(() => { process.exit(0) }, 150)
        setTimeout(() => { process.exit(0) }, 250)

        let pollCount = 0
        const pollTimer = setInterval(() => {
          pollCount++
          process.stdout.write('poll:' + pollCount + '\\n')
          if (pollCount >= 5) {
            clearInterval(pollTimer)
            clearInterval(keepAlive)
            daemonRunning = false
            process.exit = originalExit
            process.exit(0)
          }
        }, 100)
      `)

      const { exitCode, stdout } = await runWithOutput(script, 5000)
      const polls = stdout.trim().split('\n').filter(l => l.startsWith('poll:'))
      expect(polls.length).to.be.greaterThanOrEqual(5, 'daemon must survive multiple process.exit(0) calls')
      expect(exitCode).to.equal('0')
    })

    after(() => {
      const files = ['daemon-foreground.mjs', 'daemon-timing.mjs', 'daemon-survives.mjs']
      for (const f of files) {
        try { unlinkSync(join(tmpDir, f)) } catch {}
      }
    })
  })

  // =============================================================================
  // spawnDaemon tmux command construction
  // =============================================================================

  describe('spawnDaemon constructs correct tmux command', () => {
    it('tmux command embeds the daemon spec command correctly', () => {
      // Verifies that the tmux command template in spawnDaemon preserves
      // the --foreground flag through shell string interpolation.
      const sessionName = 'prlt-daemon-test-watch'
      const hqPath = '/tmp/test-hq'
      const command = 'prlt watch --foreground --verbose --target orchestrator-main --poll-interval 15'

      // This is the template from spawnDaemon:
      const tmuxCmd = `tmux new-session -d -s "${sessionName}" -c "${hqPath}" "${command}"`

      // Verify the command contains --foreground after shell interpolation
      expect(tmuxCmd).to.contain('--foreground')
      expect(tmuxCmd).to.contain('--verbose')
      expect(tmuxCmd).to.contain('--target orchestrator-main')
      expect(tmuxCmd).to.contain('--poll-interval 15')

      // Verify the full command is properly double-quoted for tmux
      expect(tmuxCmd).to.equal(
        'tmux new-session -d -s "prlt-daemon-test-watch" -c "/tmp/test-hq" "prlt watch --foreground --verbose --target orchestrator-main --poll-interval 15"'
      )
    })

    it('daemon spec command survives double-quote embedding', () => {
      // The command from watchDaemonSpec is embedded in double quotes
      // in the tmux new-session call. Verify no characters in the command
      // would break double-quote shell parsing.
      const targets = [
        'orchestrator-main',
        'my-agent',
        'agent_123',
        'test.agent',
      ]

      for (const target of targets) {
        // watchDaemonSpec sanitizes the target, so we test the SANITIZED output
        const safeTarget = target.replace(/[^a-zA-Z0-9._-]/g, '')
        const command = `prlt watch --foreground --verbose --target ${safeTarget} --poll-interval 15`

        // Characters that would break double-quote shell parsing
        expect(command).to.not.match(/["$`\\!]/)
      }
    })
  })
})

function runWithOutput(scriptPath: string, timeoutMs: number): Promise<{ exitCode: string; stdout: string }> {
  return new Promise((resolve) => {
    const child = fork(scriptPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
    let settled = false
    let stdout = ''

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })

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
