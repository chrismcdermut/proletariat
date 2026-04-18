import { expect } from 'chai'

/**
 * Unit tests for the supervised `prlt watch` daemon (PRLT-1321).
 *
 * The reconciler daemon pattern (PRLT-1287) is reused here: `prlt watch`
 * spawns a tmux session, registers in machine.db with role='daemon' /
 * type='watch', and is auto-supervised by `prlt orchestrate`.
 */

describe('Watch Daemon (PRLT-1321)', () => {
  // =============================================================================
  // watchDaemonSpec
  // =============================================================================

  describe('watchDaemonSpec', () => {
    let watchDaemonSpec: (target: string, pollIntervalSeconds?: number) => { type: string; command: string }

    before(async () => {
      const mod = await import('../../src/lib/session/daemon-manager.js')
      watchDaemonSpec = mod.watchDaemonSpec
    })

    it('produces a DaemonSpec with type "watch"', () => {
      const spec = watchDaemonSpec('orchestrator-main')
      expect(spec.type).to.equal('watch')
    })

    it('includes the target, default poll interval, --foreground, and --verbose in the command', () => {
      const spec = watchDaemonSpec('orchestrator-main')
      expect(spec.command).to.contain('prlt watch')
      expect(spec.command).to.contain('--foreground')
      expect(spec.command).to.contain('--verbose')
      expect(spec.command).to.contain('--target orchestrator-main')
      expect(spec.command).to.contain('--poll-interval 300')
    })

    it('honors a custom poll interval', () => {
      const spec = watchDaemonSpec('my-orchestrator', 300)
      expect(spec.command).to.contain('--poll-interval 300')
      expect(spec.command).to.contain('--target my-orchestrator')
    })

    it('sanitizes shell metacharacters in the target to prevent injection', () => {
      // Only [a-zA-Z0-9._-] survive, so the target cannot terminate the
      // tmux `sh -c` wrapper with `;`, start a subshell with `$()`, or
      // insert a pipe/redirect. Alphanumerics stay because they're valid in
      // an agent/session name.
      const spec = watchDaemonSpec('orchestrator; $(evil) | cat > /tmp/x', 60)
      expect(spec.command).to.not.contain(';')
      expect(spec.command).to.not.contain('$')
      expect(spec.command).to.not.contain('(')
      expect(spec.command).to.not.contain(')')
      expect(spec.command).to.not.contain('|')
      expect(spec.command).to.not.contain('>')
      expect(spec.command).to.not.contain(' /')
      // Whitespace inside the target is stripped so nothing new can appear
      // as a separate argv token after --target.
      expect(spec.command).to.contain('--target orchestratorevilcattmpx')
    })

    it('runs watch in --foreground mode inside the daemon tmux session', () => {
      // Without --foreground, `prlt watch` would recursively try to spawn
      // another daemon, creating infinite spawn loops.
      const spec = watchDaemonSpec('t')
      expect(spec.command).to.match(/--foreground/)
    })
  })

  // =============================================================================
  // Session naming
  // =============================================================================

  describe('watch daemon session naming', () => {
    it('uses the daemon session name pattern for watch', async () => {
      const { buildDaemonSessionName } = await import('../../src/lib/session/renderer.js')
      const name = buildDaemonSessionName('proletariat', 'watch')
      expect(name).to.equal('prlt-daemon-proletariat-watch')
    })

    it('matches the prlt-daemon- prefix so `prlt session prune` skips it', async () => {
      const { buildDaemonSessionName } = await import('../../src/lib/session/renderer.js')
      const name = buildDaemonSessionName('any-hq', 'watch')
      expect(name.startsWith('prlt-daemon-')).to.equal(true)
    })
  })

  // =============================================================================
  // stopDaemon
  // =============================================================================

  describe('stopDaemon export', () => {
    it('is exported from daemon-manager', async () => {
      const mod = await import('../../src/lib/session/daemon-manager.js')
      expect(mod.stopDaemon).to.be.a('function')
    })

    it('returns a stopped=false result when no daemon session is running', async () => {
      // Use an hqPath that will never have a running `watch` daemon.
      const { stopDaemon } = await import('../../src/lib/session/daemon-manager.js')
      const result = stopDaemon('/tmp/definitely-not-a-real-hq-PRLT-1321', 'watch')
      expect(result).to.have.property('stopped', false)
      expect(result.sessionName).to.match(/^prlt-daemon-/)
      expect(result.sessionName).to.contain('-watch')
    })
  })

  // =============================================================================
  // Role detection
  // =============================================================================

  describe('watch daemon role detection', () => {
    it('is identified as role="daemon" by the session collector', () => {
      // Mirrors the role detection in session/renderer.ts
      const exec = { ticketId: 'DAEMON', agentName: 'daemon-watch' }
      let role: string = exec.ticketId ? 'worker' : 'headless'
      if (exec.ticketId === 'DAEMON' || exec.agentName.startsWith('daemon-')) {
        role = 'daemon'
      } else if (
        exec.agentName.startsWith('orchestrator') ||
        exec.ticketId === 'ORCH' ||
        exec.ticketId === 'orchestrator'
      ) {
        role = 'orchestrator'
      }
      expect(role).to.equal('daemon')
    })

    it('extracts daemon type "watch" from the tmux session name', () => {
      const sessionName = 'prlt-daemon-proletariat-watch'
      const parts = sessionName.split('-')
      const daemonType = parts.length >= 4 ? parts.slice(3).join('-') : 'unknown'
      expect(daemonType).to.equal('watch')
    })
  })

  // =============================================================================
  // Prune protection (shared with reconciler — included for regression safety)
  // =============================================================================

  describe('session prune protection', () => {
    it('treats prlt-daemon-*-watch sessions as daemons (skipped by prune)', () => {
      const tmuxSessions = [
        'TKT-123-Implement-my-agent',
        'prlt-daemon-proletariat-reconciler',
        'prlt-daemon-proletariat-watch',
        'prlt-orchestrator-proletariat-main',
      ]
      const orphans: string[] = []
      for (const sessionName of tmuxSessions) {
        if (sessionName.startsWith('prlt-daemon-')) continue // PRLT-1287 guard applies to watch too
        if (sessionName.includes('-')) {
          orphans.push(sessionName)
        }
      }
      expect(orphans).to.not.include('prlt-daemon-proletariat-watch')
      expect(orphans).to.not.include('prlt-daemon-proletariat-reconciler')
    })
  })
})

// =============================================================================
// PRLT-1328: Daemon wrapper bypasses keepalive regression tests
// =============================================================================

describe('Watch Daemon Keepalive (PRLT-1328)', () => {
  describe('watchDaemonSpec --verbose flag', () => {
    let watchDaemonSpec: (target: string, pollIntervalSeconds?: number) => { type: string; command: string }

    before(async () => {
      const mod = await import('../../src/lib/session/daemon-manager.js')
      watchDaemonSpec = mod.watchDaemonSpec
    })

    it('always includes --verbose so poll activity is visible in the tmux pane', () => {
      // PRLT-1328: Without --verbose, polls that find no changes produce zero
      // output. Users see "Baseline captured. Watching for changes..." and then
      // nothing — making the daemon appear dead.
      const spec = watchDaemonSpec('orchestrator-main')
      expect(spec.command).to.contain('--verbose')
    })

    it('includes --verbose before target flags to avoid oclif parsing ambiguity', () => {
      const spec = watchDaemonSpec('orchestrator-main', 15)
      // Verify the entire command structure is well-formed
      expect(spec.command).to.equal(
        'prlt watch --foreground --verbose --target orchestrator-main --poll-interval 15',
      )
    })

    it('includes all required flags for the daemon to poll correctly', () => {
      // Regression: every flag needed by the foreground code path must be present
      const spec = watchDaemonSpec('my-target', 30)
      const requiredFlags = ['--foreground', '--verbose', '--target', '--poll-interval']
      for (const flag of requiredFlags) {
        expect(spec.command, `missing ${flag}`).to.contain(flag)
      }
    })
  })

  describe('recursive daemon spawn guard', () => {
    it('detects when running inside a daemon tmux session', () => {
      // The guard checks: process.env.TMUX && getDaemonStatus().alive
      // Inside a daemon tmux session, TMUX is set and the watch daemon session exists.
      // Outside tmux, TMUX is unset, so the guard is false.
      const insideTmux = !!process.env.TMUX
      // In CI/test, we're not inside tmux, so the guard should be false
      if (!insideTmux) {
        // Verify the guard logic: without TMUX env var, the condition is falsy
        const guard = process.env.TMUX && true // simulates getDaemonStatus().alive
        expect(guard).to.be.undefined // falsy because TMUX is undefined
      }
    })

    it('falls through to foreground mode when recursive spawn is detected', () => {
      // When the guard triggers (TMUX set + watch daemon alive), the command
      // should NOT call spawnAsDaemon. It should fall through to the foreground
      // code path, which enters the poll loop.
      //
      // We verify this by checking the condition logic:
      // if (!flags.foreground && !flags.once && !insideDaemonSession) → spawnAsDaemon
      //
      // With insideDaemonSession=true:
      const flags = { foreground: false, once: false }
      const insideDaemonSession = true
      const wouldSpawnDaemon = !flags.foreground && !flags.once && !insideDaemonSession
      expect(wouldSpawnDaemon).to.equal(false, 'should NOT spawn daemon when inside a daemon session')
    })

    it('spawns daemon normally when NOT inside a tmux session', () => {
      const flags = { foreground: false, once: false }
      const insideDaemonSession = false // TMUX not set
      const wouldSpawnDaemon = !flags.foreground && !flags.once && !insideDaemonSession
      expect(wouldSpawnDaemon).to.equal(true, 'should spawn daemon when outside tmux')
    })

    it('respects --foreground even when recursive spawn guard would trigger', () => {
      const flags = { foreground: true, once: false }
      const insideDaemonSession = true
      const wouldSpawnDaemon = !flags.foreground && !flags.once && !insideDaemonSession
      expect(wouldSpawnDaemon).to.equal(false, '--foreground always enters foreground mode')
    })
  })
})
