/**
 * prlt watch — Minimal poller that watches GitHub/Linear/agents and pokes an orchestrator.
 *
 * Polls external systems on an interval, diffs state, and sends a summary
 * of changes to the target orchestrator agent via `prlt session poke`.
 *
 * The orchestrator (LLM agent) reads the poke and decides what to do —
 * merge, rebase, spawn, ignore, ask human. This command does NO decision-making.
 *
 * PRLT-1321: By default, `prlt watch` spawns as a supervised tmux daemon so it
 * survives terminal close and is visible in `prlt session list`. Use
 * `--foreground` to run in the current terminal (useful for debugging or
 * inside the daemon's own tmux session).
 */

import { Flags } from '@oclif/core'
import { execFileSync } from 'node:child_process'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { SimplePoller } from '../../lib/orchestrate/simple-poller.js'
import {
  getDaemonStatus,
  spawnDaemon,
  watchDaemonSpec,
} from '../../lib/session/daemon-manager.js'

export default class Watch extends PromptCommand {
  static description = 'Poll GitHub/Linear/agents and poke an orchestrator with changes'

  static examples = [
    '<%= config.bin %> watch --target orchestrator',
    '<%= config.bin %> watch --target orchestrator --poll-interval 30',
    '<%= config.bin %> watch --target my-orchestrator --verbose',
    '<%= config.bin %> watch --target orchestrator --once',
    '<%= config.bin %> watch --target orchestrator --foreground',
  ]

  static flags = {
    ...machineOutputFlags,
    target: Flags.string({
      description: 'Orchestrator agent/session name to poke with changes',
      required: true,
      char: 't',
    }),
    'poll-interval': Flags.integer({
      description: 'Poll interval in seconds',
      default: 60,
    }),
    verbose: Flags.boolean({
      description: 'Show detailed output including poll results',
      char: 'v',
      default: false,
    }),
    once: Flags.boolean({
      description: 'Run a single poll cycle and exit (useful for testing)',
      default: false,
    }),
    foreground: Flags.boolean({
      description:
        'Run in the current terminal instead of spawning a tmux daemon (used for debugging)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Watch)
    const jsonMode = shouldOutputJson(flags)
    const verbose = flags.verbose

    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('watch', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    // PRLT-1328: Guard against recursive daemon spawn. If we are already
    // running inside a daemon tmux session (detected by the TMUX env var and
    // our session-name prefix), force foreground mode instead of trying to
    // spawn yet another tmux session. Without this guard, the child process
    // would detect the existing session as "already running" and exit
    // immediately — the poll loop would never fire.
    const insideDaemonSession =
      process.env.TMUX && getDaemonStatus(workspaceInfo.path, 'watch').alive

    // PRLT-1321: Default behavior — spawn as a supervised tmux daemon unless
    // the caller explicitly wants --foreground or --once.
    if (!flags.foreground && !flags.once && !insideDaemonSession) {
      return this.spawnAsDaemon(workspaceInfo.path, flags, jsonMode)
    }

    const db = openWorkspaceDatabase(workspaceInfo.path)

    try {
      const poller = new SimplePoller({
        db,
        log: (msg) => {
          // Always log warnings and repo discovery messages; other messages only in verbose mode
          if (msg.includes('Warning') || msg.includes('Discovered')) {
            this.log(styles.muted(msg))
          } else if (verbose) {
            this.log(styles.muted(msg))
          }
        },
        cwd: workspaceInfo.path,
      })

      // One-shot mode
      if (flags.once) {
        // Run two polls: first to capture baseline, second to detect changes
        // In one-shot mode, we just report current state
        await poller.poll() // baseline
        const result = await poller.poll()

        if (jsonMode) {
          outputSuccessAsJson(
            { mode: 'once', changes: result.changes, message: result.message },
            createMetadata('watch', flags),
          )
          return
        }

        if (result.message) {
          this.log(result.message)
        } else {
          this.log(styles.muted('No changes detected.'))
        }
        return
      }

      // Daemon mode (runs in the current terminal when --foreground is set,
      // which is also how the supervised daemon runs itself inside tmux)

      // Prevent oclif from killing the daemon — oclif's error handler calls
      // process.exit(0) after run() resolves, which terminates the daemon.
      // Override process.exit to ignore clean exits while the daemon is running.
      // (Same workaround as PRLT-1211 in orchestrate command.)
      const originalExit = process.exit
      let daemonRunning = true
      process.exit = ((code?: number) => {
        if (daemonRunning && (code === 0 || code === undefined)) return
        originalExit(code as number)
      }) as never

      if (!jsonMode) {
        this.log('')
        this.log(styles.title('Watch daemon started'))
        this.log(styles.muted(`  Target: ${flags.target}`))
        this.log(styles.muted(`  Poll interval: ${flags['poll-interval']}s`))
        this.log(styles.muted('  Press Ctrl+C to stop'))
        this.log('')
      }

      // Initial baseline poll (captures current state without poking)
      this.log(styles.muted('  Capturing baseline state...'))
      await poller.poll()
      this.log(styles.muted('  Baseline captured. Watching for changes...'))
      this.log('')

      if (jsonMode) {
        // In daemon mode, output JSON status without throwing ExitError.
        // outputSuccessAsJson throws oclif ExitError which would kill the daemon loop.
        console.log(JSON.stringify({
          type: 'success',
          prompt: null,
          success: true,
          result: { status: 'running', mode: 'daemon', target: flags.target, pollInterval: flags['poll-interval'] },
          metadata: createMetadata('watch', flags),
        }, null, 2))
      }

      // Poll loop
      const pollTimer = setInterval(async () => {
        try {
          if (verbose) this.log(styles.muted(`[watch] Polling at ${new Date().toISOString()}...`))

          const result = await poller.poll()

          if (result.message) {
            // Always log changes — this is the core purpose of the watcher
            this.log('')
            this.log(styles.info(`[watch] ${result.changes.length} change(s) detected:`))
            this.log(result.message)
            this.log('')

            // Poke the orchestrator
            this.pokeTarget(flags.target, result.message, verbose)
          } else if (verbose) {
            this.log(styles.muted('[watch] No changes.'))
          }
        } catch (err) {
          this.log(styles.error(`[watch] Poll error: ${err instanceof Error ? err.message : String(err)}`))
        }
      }, flags['poll-interval'] * 1000)

      // Keep alive
      const keepAlive = setInterval(() => {}, 60_000)

      // Graceful shutdown
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          clearInterval(pollTimer)
          clearInterval(keepAlive)
          daemonRunning = false
          process.exit = originalExit
          this.log(styles.muted('\n  Watch daemon stopped'))
          resolve()
        }

        process.on('SIGINT', cleanup)
        process.on('SIGTERM', cleanup)
      })
    } finally {
      db.close()
    }
  }

  /**
   * PRLT-1321: Spawn the watch poller as a supervised tmux daemon.
   *
   * Creates a detached tmux session running `prlt watch --foreground ...`,
   * registers it in machine.db with `ticketId='DAEMON'` / `agentName='daemon-watch'`,
   * and returns immediately. Attach with `tmux attach -t <session>` or stop
   * with `prlt watch stop`.
   */
  private spawnAsDaemon(
    hqPath: string,
    flags: {
      target: string
      'poll-interval': number
      verbose: boolean
    } & Record<string, unknown>,
    jsonMode: boolean,
  ): void {
    const status = getDaemonStatus(hqPath, 'watch')
    if (status.alive) {
      if (jsonMode) {
        outputSuccessAsJson(
          {
            status: 'already_running',
            sessionName: status.sessionName,
            target: flags.target,
            pollInterval: flags['poll-interval'],
            message: `Watch daemon is already running (session: ${status.sessionName})`,
          },
          createMetadata('watch', flags),
        )
        return
      }
      this.log(styles.success(`Watch daemon is already running (session: ${status.sessionName})`))
      this.log(styles.muted(`  Target: ${flags.target}`))
      this.log(styles.muted(`  Attach with: tmux attach -t ${status.sessionName}`))
      this.log(styles.muted(`  Stop with: prlt watch stop`))
      return
    }

    const spec = watchDaemonSpec(flags.target, flags['poll-interval'])
    const sessionName = spawnDaemon(hqPath, spec)

    if (!sessionName) {
      const msg = 'Failed to spawn watch daemon (tmux session could not be started).'
      if (jsonMode) {
        outputErrorAsJson('DAEMON_SPAWN_FAILED', msg, createMetadata('watch', flags))
        return
      }
      this.log(styles.error(msg))
      return
    }

    if (jsonMode) {
      outputSuccessAsJson(
        {
          status: 'started',
          sessionName,
          target: flags.target,
          pollInterval: flags['poll-interval'],
        },
        createMetadata('watch', flags),
      )
      return
    }

    this.log(styles.success(`Watch daemon started (session: ${sessionName})`))
    this.log(styles.muted(`  Target: ${flags.target}`))
    this.log(styles.muted(`  Poll interval: ${flags['poll-interval']}s`))
    this.log(styles.muted(`  Attach with: tmux attach -t ${sessionName}`))
    this.log(styles.muted(`  Stop with:   prlt watch stop`))
  }

  /**
   * Poke the target orchestrator agent with a message.
   * Uses `prlt session poke` to send the message to the agent's tmux session.
   *
   * Uses execFileSync (no shell) with stdin piping so messages containing
   * newlines, #, parentheses, quotes, and other shell metacharacters are
   * delivered intact (PRLT-1314).
   */
  private pokeTarget(target: string, message: string, verbose: boolean): void {
    try {
      execFileSync('prlt', ['session', 'poke', target, '-'], {
        input: message,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
      })

      if (verbose) {
        this.log(styles.success(`  Poked ${target} with ${message.split('\n').length} lines`))
      }
    } catch (err: unknown) {
      // execFileSync errors include stderr — surface the actual failure reason
      const stderr = (err as { stderr?: string | Buffer })?.stderr
      const detail = stderr ? String(stderr).trim() : (err instanceof Error ? err.message : String(err))
      this.log(styles.error(`[watch] Failed to poke ${target}: ${detail}`))
    }
  }
}
